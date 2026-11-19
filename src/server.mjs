/**
 * Local Execution Sandbox & Dynamic API Server (src/server.mjs)
 * Phục vụ giao diện White Tone UI tại http://localhost:3000 và các REST API dữ liệu động.
 */

import crypto from 'node:crypto';
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  ESCROW_AGENTS_MATRIX,
  runScopeDecomposerAgent,
  runAutonomousVerificationAndAssessor,
  runFactFindingBailiffAgent,
  runScopeDecomposerAgentLive,
  runAutonomousVerificationAndAssessorLive,
  runFactFindingBailiffAgentLive,
  fetchAvalancheContext
} from './agents.js';
import { createInitialEscrowState, triggerTimelockAutoRelease, releasePartialMilestone, resolveDisputeByArbiter, submitDeliverable, requestContractRevision, createEscrowContract, openDisputeWithEvidence } from './app.js';
import { assertMultiSig2Of3 } from './engine/multiSigGuard.mjs';
import { createBaseline, loadBaseline } from './engine/baselineManager.mjs';
import { evaluateSubmission } from './engine/ruleEngine.mjs';
import { refineVagueCriteria, loadHistoricalBaselines } from './engine/criteriaRefiner.mjs';
import { executeWithFallback } from './engine/resilienceGuard.mjs';
import { calculateFrozenFundSplit } from './engine/settlementCalculator.mjs';
import { parseGitHubUrl, validateStrictGitHubVerifyInput, fetchGitHubCommitDetails, runSandboxTests } from './tools/githubVerifier.mjs';
import { AGENT_VERIFICATION_TOOLS, executeAgentTool } from './tools/agentTools.mjs';
import { anchorProofOnFuji } from './blockchain/fujiBridge.mjs';
import { createRateLimiter, normalizeGitHubVerifyPayload } from './middleware/apiSecurity.mjs';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const ROOT_DIR = path.resolve(__dirname, '..');

function loadEnvFile() {
  const envPath = path.join(ROOT_DIR, '.env');
  if (!fs.existsSync(envPath)) return;
  for (const rawLine of fs.readFileSync(envPath, 'utf8').split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line || line.startsWith('#')) continue;
    const eqIndex = line.indexOf('=');
    if (eqIndex <= 0) continue;
    const key = line.slice(0, eqIndex).trim();
    const val = line.slice(eqIndex + 1).trim().replace(/^(['"])(.*)\1$/, '$2');
    if (key && !(key in process.env)) {
      process.env[key] = val;
    }
  }
}

loadEnvFile();

// Respect the host/port supplied by preview tools; local start.bat still uses 3000.
const cliOption = (name) => {
  const index = process.argv.indexOf(name);
  return index >= 0 ? process.argv[index + 1] : undefined;
};
const PORT = Number(process.env.PORT || cliOption('--port') || 3000);
const HOST = cliOption('--host') || '127.0.0.1';
const MAX_REQUEST_BODY_BYTES = 1024 * 1024; // 1MB

const MIME_TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'application/javascript; charset=utf-8',
  '.mjs': 'application/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.png': 'image/png',
  '.webp': 'image/webp'
};

// Dữ liệu động trên bộ nhớ Server (In-memory Dynamic Store)
let serverEscrowState = createInitialEscrowState();
const latestEvaluationReports = new Map();

function persistEscrowStateToDisk(state) {
  try {
    const dbPath = path.join(ROOT_DIR, 'data', 'db.json');
    fs.mkdirSync(path.dirname(dbPath), { recursive: true });
    fs.writeFileSync(dbPath, JSON.stringify(state, null, 2), 'utf8');
  } catch {
    // Bỏ qua nếu môi trường chỉ đọc
  }
}

function readJsonBody(req, maxBytes = MAX_REQUEST_BODY_BYTES) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    let totalBytes = 0;
    let settled = false;

    req.on('data', (chunk) => {
      if (settled) return;
      totalBytes += chunk.length;
      if (totalBytes > maxBytes) {
        settled = true;
        const err = new Error('Payload Too Large: vượt quá giới hạn tối đa 1MB.');
        err.statusCode = 413;
        req.destroy();
        reject(err);
        return;
      }
      chunks.push(chunk);
    });
    req.on('end', () => {
      if (settled) return;
      settled = true;
      const body = Buffer.concat(chunks).toString('utf8');
      if (!body) {
        resolve({});
        return;
      }
      try {
        resolve(JSON.parse(body));
      } catch (err) {
        reject(err);
      }
    });
    req.on('error', (err) => {
      if (settled) return;
      settled = true;
      reject(err);
    });
  });
}

function timingSafeMatch(input, expected) {
  const a = Buffer.from(String(input || ''), 'utf8');
  const b = Buffer.from(String(expected || ''), 'utf8');
  if (a.length === 0 || a.length !== b.length) return false;
  return crypto.timingSafeEqual(a, b);
}

function filterStateByRole(state, role) {
  const normalizedRole = String(role || 'client').toLowerCase();
  const cloned = JSON.parse(JSON.stringify(state));
  if (normalizedRole === 'client') {
    delete cloned.freelancerBalance;
    delete cloned.platformFeesCollected;
  } else if (normalizedRole === 'freelancer') {
    delete cloned.clientBalance;
    delete cloned.platformFeesCollected;
  } else if (normalizedRole === 'arbiter') {
    delete cloned.clientBalance;
    delete cloned.freelancerBalance;
  }
  return cloned;
}

/**
 * Worker tự động giải ngân khi hợp đồng ở trạng thái SUBMITTED_PASSED và quá thời gian kiểm tra (inspectionWindowMs).
 */
export function processAutoReleaseContracts(state, nowMs = Date.now()) {
  if (!state || !Array.isArray(state.contracts) || state.vaultPaused) return [];
  const releasedIds = [];
  for (const contract of state.contracts) {
    if (contract.status !== 'SUBMITTED_PASSED' || contract.vaultFrozen || contract.isFrozen || contract.timelockPaused) continue;
    const submittedAt = Number(contract.submittedAt);
    const inspectionWindowMs = Number(
      contract.inspectionWindowMs ?? contract.inspectionMs ?? (Number(contract.inspectionDays) || 3) * 86400000
    );
    if (!Number.isFinite(submittedAt) || nowMs <= submittedAt + inspectionWindowMs) continue;

    const res = triggerTimelockAutoRelease(state, contract.id, { nowMs, triggeredBy: 'SERVER_WORKER' });
    if (res.ok) {
      contract.status = 'AUTO_RELEASED';
      releasedIds.push(contract.id);
    }
  }
  return releasedIds;
}

const SECURITY_HEADERS = {
  'X-Content-Type-Options': 'nosniff',
  'X-Frame-Options': 'DENY',
  'Referrer-Policy': 'no-referrer'
};

function sendJson(res, statusCode, data) {
  res.writeHead(statusCode, {
    'Content-Type': 'application/json; charset=utf-8',
    'Cache-Control': 'no-store',
    ...SECURITY_HEADERS
  });
  res.end(JSON.stringify(data));
}

function verifyWriteAuthorization(req) {
  const claimedRole = String(req.headers['x-user-role'] || '').toLowerCase();
  const bearer = String(req.headers['authorization'] || '').replace(/^Bearer\s+/i, '').trim();
  const token = String(req.headers['x-arbiter-token'] || bearer || '').trim();
  if (claimedRole === 'arbiter' || token) {
    const expectedToken = process.env.ARBITER_AUTH_TOKEN || 'naruto';
    if (!timingSafeMatch(token, expectedToken)) {
      return { authorized: false, error: 'Unauthorized: Token Trọng tài không hợp lệ.' };
    }
  }
  return { authorized: true };
}

export function createPreviewServer() {
  const checkRateLimit = createRateLimiter();

  return http.createServer(async (req, res) => {
    const urlPath = (req.url || '/').split('?')[0];

    if (urlPath.startsWith('/api/')) {
      const rate = checkRateLimit(req, urlPath);
      if (!rate.allowed) {
        sendJson(res, 429, {
          ok: false,
          error: rate.error || `Bạn thao tác quá nhanh, vui lòng thử lại sau ${rate.retryAfterSeconds || 60} giây.`,
          retryAfterSeconds: rate.retryAfterSeconds || 60,
          limit: rate.limit
        });
        return;
      }
      if (req.method === 'POST' && urlPath !== '/api/auth/arbiter') {
        const auth = verifyWriteAuthorization(req);
        if (!auth.authorized) {
          sendJson(res, 401, { ok: false, error: auth.error });
          return;
        }
      }
    }

    if (urlPath === '/api/health') {
      sendJson(res, 200, {
        status: 'ok',
        engine: 'Google Antigravity + PowerBatch + Vercel',
        uiTheme: 'Pure White (#FFFFFF)',
        dynamicApi: true,
        geminiConfigured: Boolean(process.env.GEMINI_API_KEY),
        geminiModel: process.env.GEMINI_MODEL || 'gemini-flash-latest',
        githubConfigured: Boolean(process.env.GITHUB_TOKEN),
        avalancheConfigured: Boolean(process.env.AVALANCHE_API_KEY),
        avalancheChainId: process.env.AVALANCHE_CHAIN_ID || '43114',
        llmEngine: process.env.GEMINI_API_KEY ? 'LLM_ONLINE (Gemini)' : 'RULE_FALLBACK_ACTIVE',
        sandboxRunner: 'Ready (30s/45s Isolated)',
        timelockMonitor: 'Active (15s Worker)'
      });
      return;
    }

    // API sinh mã lệnh nạp tiền duy nhất bằng crypto.randomUUID().slice(0, 8)
    if (urlPath === '/api/topups/id' && req.method === 'POST') {
      const topupId = `TOPUP-${crypto.randomUUID().slice(0, 8).toUpperCase()}`;
      sendJson(res, 200, { ok: true, topupId, memo: `NAP ESCROW ${topupId}` });
      return;
    }

    // API xác thực Trọng tài qua Header Token (x-arbiter-token hoặc Authorization: Bearer ...)
    if (urlPath === '/api/auth/arbiter' && req.method === 'POST') {
      const bearer = String(req.headers['authorization'] || '').replace(/^Bearer\s+/i, '').trim();
      const headerToken = String(req.headers['x-arbiter-token'] || bearer || '').trim();
      const expectedToken = process.env.ARBITER_AUTH_TOKEN || 'naruto';
      if (!timingSafeMatch(headerToken, expectedToken)) {
        sendJson(res, 401, { ok: false, error: 'Token Trọng tài không hợp lệ.' });
        return;
      }
      sendJson(res, 200, { ok: true, role: 'arbiter' });
      return;
    }

    // API lấy dữ liệu Escrow đã lọc ẩn số dư vai trò khác; chặn POST /api/state ghi đè toàn bộ state
    if (urlPath === '/api/state') {
      if (req.method === 'GET') {
        const reqUrl = new URL(req.url || '/', 'http://127.0.0.1');
        const role = reqUrl.searchParams.get('role') || req.headers['x-user-role'] || 'client';
        sendJson(res, 200, filterStateByRole(serverEscrowState, role));
        return;
      }
      sendJson(res, 405, { ok: false, error: 'Method Not Allowed: POST /api/state đã bị vô hiệu hóa để bảo vệ toàn vẹn state.' });
      return;
    }

    // API danh sách 4 Tầng AI Agents (hiển thị khi bấm vào nút AI Agents trên thanh bar)
    if (urlPath === '/api/agents/matrix' && req.method === 'GET') {
      sendJson(res, 200, {
        agents: ESCROW_AGENTS_MATRIX,
        sampleTier1: runScopeDecomposerAgent('Làm web bán hàng đẹp, mượt, thanh toán QR nhanh'),
        sampleTier23Pass: runAutonomousVerificationAndAssessor(
          { deliverableUrl: 'https://github.com/vibecode/app/pull/42', commitHash: 'commit#9f8c2a1' },
          'PASS_100'
        ),
        sampleTier23Fail: runAutonomousVerificationAndAssessor(
          { deliverableUrl: 'https://github.com/vibecode/app/pull/42', commitHash: 'commit#9f8c2a1' },
          'FAIL_PAYMENT_500'
        ),
        sampleTier4: runFactFindingBailiffAgent(serverEscrowState.contracts.find((c) => c.status === 'DISPUTED'))
      });
      return;
    }

    // API Tầng 1: Scope Decomposer Agent
    if ((urlPath === '/api/scope-decompose' || urlPath === '/api/agents/scope-decompose') && req.method === 'POST') {
      try {
        const { brief } = await readJsonBody(req);
        const result = await runScopeDecomposerAgentLive(brief);
        sendJson(res, 200, result);
      } catch (err) {
        sendJson(res, err.statusCode || 400, { error: err.message });
      }
      return;
    }

    // API Tầng 2 & 3: Autonomous Verification & Technical Assessor Agent
    if ((urlPath === '/api/verify-assess' || urlPath === '/api/agents/verify-assess') && req.method === 'POST') {
      try {
        const { submission, scenario } = await readJsonBody(req);
        const result = await runAutonomousVerificationAndAssessorLive(submission, scenario);
        sendJson(res, 200, result);
      } catch (err) {
        sendJson(res, err.statusCode || 400, { error: err.message });
      }
      return;
    }

    // API Tầng 4: Autonomous Fact-finding Bailiff Agent
    if ((urlPath === '/api/fact-finding' || urlPath === '/api/agents/fact-finding') && req.method === 'POST') {
      try {
        const contract = await readJsonBody(req);
        const result = await runFactFindingBailiffAgentLive(contract);
        sendJson(res, 200, result);
      } catch (err) {
        sendJson(res, err.statusCode || 400, { error: err.message });
      }
      return;
    }

    // API Chuẩn hóa Tiêu chí Nghiệm thu mơ hồ (RAG Historical Baselines + Rule + LLM Fallback)
    if (urlPath === '/api/agreements/refine-criteria' && req.method === 'POST') {
      try {
        const { contractTitle, rawCriteria } = await readJsonBody(req);
        const baselinesDir = path.join(ROOT_DIR, 'data', 'baselines');
        const historicalBaselines = loadHistoricalBaselines(baselinesDir);
        const refined = await executeWithFallback(
          () => refineVagueCriteria(contractTitle, rawCriteria, historicalBaselines, { useLlm: true }),
          () => refineVagueCriteria(contractTitle, rawCriteria, historicalBaselines, { useLlm: false }),
          8000
        );
        sendJson(res, 200, { ok: true, ...refined });
      } catch (err) {
        sendJson(res, err.statusCode || 400, { error: err.message });
      }
      return;
    }

    // API Gợi ý Tiêu chí Nghiệm thu từ Tên hợp đồng (RAG + LLM Fallback)
    if (urlPath === '/api/agreements/suggest-criteria' && req.method === 'POST') {
      try {
        const { contractTitle, rawCriteria } = await readJsonBody(req);
        const baselinesDir = path.join(ROOT_DIR, 'data', 'baselines');
        const historicalBaselines = loadHistoricalBaselines(baselinesDir);
        const suggested = await executeWithFallback(
          () => refineVagueCriteria(contractTitle, rawCriteria || [], historicalBaselines, { useLlm: true }),
          () => refineVagueCriteria(contractTitle, rawCriteria || [], historicalBaselines, { useLlm: false }),
          8000
        );
        sendJson(res, 200, { ok: true, ...suggested });
      } catch (err) {
        sendJson(res, err.statusCode || 400, { error: err.message });
      }
      return;
    }

    // API Kiểm tra GitHub & Nghiệm thu tự động theo Baseline (POST /api/milestones/:milestoneId/verify-github)
    const verifyGhMatch = urlPath.match(/^\/api\/milestones\/([^/]+)\/verify-github$/);
    if (verifyGhMatch && req.method === 'POST') {
      try {
        const milestoneId = decodeURIComponent(verifyGhMatch[1]);
        const body = await readJsonBody(req);
        const { repoUrl, commitSha } = normalizeGitHubVerifyPayload(body);
        const testCommand = body.testCommand || 'node --test';
        const agreementId = body.agreementId || milestoneId;

        const strictCheck = validateStrictGitHubVerifyInput({ repoUrl, commitSha });
        if (!strictCheck.valid) {
          sendJson(res, 400, { ok: false, error: strictCheck.error });
          return;
        }

        const baselinesDir = path.join(ROOT_DIR, 'data', 'baselines');
        let baseline = loadBaseline(agreementId, milestoneId, { baseDir: baselinesDir });

        if (!baseline && fs.existsSync(baselinesDir)) {
          for (const file of fs.readdirSync(baselinesDir)) {
            if (file.endsWith('.json') && file.includes(milestoneId)) {
              baseline = JSON.parse(fs.readFileSync(path.join(baselinesDir, file), 'utf8'));
              break;
            }
          }
        }

        if (!baseline) {
          const matchedContract = serverEscrowState.contracts.find(
            (c) => c.id === agreementId || c.id === milestoneId
          );
          const refined = await refineVagueCriteria(
            matchedContract?.title || body.contractTitle || 'Hợp đồng Escrow',
            matchedContract?.acceptanceCriteria || body.acceptanceCriteria || ['API chạy nhanh', 'Code không lỗi'],
            loadHistoricalBaselines(baselinesDir),
            { useLlm: false }
          );
          baseline = createBaseline({
            agreementId: matchedContract?.id || agreementId,
            milestoneId,
            persist: false,
            scopeConstraints: body.scopeConstraints || { forbiddenPaths: ['.env', 'config/secrets'] },
            acceptanceCriteria: refined.criteria.map((c) =>
              c.type === 'DETERMINISTIC'
                ? {
                    id: c.id,
                    type: 'DETERMINISTIC',
                    metric: c.metric,
                    operator: c.operator,
                    expectedValue: c.expectedValue,
                    weight: c.weight
                  }
                : {
                    id: c.id,
                    type: 'SUBJECTIVE',
                    description: c.clarifiedDescription || c.originalText,
                    requiresHitl: true,
                    weight: c.weight
                  }
            )
          });
        }

        const parsedGh = parseGitHubUrl(repoUrl);
        const hasGithubToken = Boolean(process.env.GITHUB_TOKEN && process.env.GITHUB_TOKEN.trim());
        const [commitDetails, sandbox] = await Promise.all([
          parsedGh.valid
            ? fetchGitHubCommitDetails({
                owner: parsedGh.owner,
                repo: parsedGh.repo,
                commitSha: commitSha !== 'HEAD' ? commitSha : parsedGh.commitSha || 'HEAD'
              })
            : Promise.resolve({ ok: false, changedFiles: [] }),
          runSandboxTests({ repoUrl, commitSha, testCommand })
        ]);

        if (parsedGh.valid && commitDetails && !commitDetails.ok && (commitDetails.status === 429 || commitDetails.status === 403)) {
          const reasonMsg = !hasGithubToken
            ? `GitHub API trả về mã ${commitDetails.status} (vượt giới hạn truy cập) do hệ thống chưa cấu hình GITHUB_TOKEN trong biến môi trường (.env).`
            : `GitHub API đang giới hạn tốc độ (${commitDetails.status}), vui lòng thử lại sau ít phút.`;
          sendJson(res, 429, {
            ok: false,
            error: reasonMsg,
            missingGithubToken: !hasGithubToken,
            githubStatus: commitDetails.status
          });
          return;
        }

        const changedFiles =
          Array.isArray(commitDetails.changedFiles) && commitDetails.changedFiles.length > 0
            ? commitDetails.changedFiles
            : sandbox.deliveredFiles;

        const evaluation = evaluateSubmission(baseline, {
          changedFiles,
          deliveredFiles: sandbox.deliveredFiles,
          metrics: sandbox.metrics
        });

        let autoFrozen = false;
        if (evaluation.blocked) {
          const targetContract = serverEscrowState.contracts.find(
            (c) => c.id === agreementId || c.id === milestoneId
          );
          if (targetContract) {
            targetContract.vaultFrozen = true;
            targetContract.status = 'DISPUTED';
            targetContract.timelockRemaining = '❄️ ĐÓNG BĂNG TỰ ĐỘNG (Circuit Breaker)';
          }
          autoFrozen = true;
        }

        latestEvaluationReports.set(milestoneId, {
          baseline,
          evaluation,
          updatedAt: new Date().toISOString()
        });

        const fujiAnchor = await anchorProofOnFuji({
          milestoneId,
          deliverableHash: commitDetails.sha || commitSha,
          testReportHash: evaluation.testReportHash,
          score: evaluation.deterministicScore
        }).catch((err) => ({
          onChain: false,
          chainId: 43113,
          reason: err.message,
          txHash: null,
          snowtraceUrl: null
        }));

        sendJson(res, 200, {
          ok: true,
          milestoneId,
          agreementId: baseline.agreementId,
          baselineHash: baseline.baselineHash,
          github: {
            validUrl: parsedGh.valid,
            owner: parsedGh.owner,
            repo: parsedGh.repo,
            commitSha: commitDetails.sha || commitSha,
            message: commitDetails.message || '',
            author: commitDetails.author || '',
            changedFiles
          },
          sandbox: {
            cloned: sandbox.cloned,
            testCommand: sandbox.testCommand,
            exitCode: sandbox.exitCode,
            executionTimeMs: sandbox.executionTimeMs,
            deliveredFilesCount: sandbox.deliveredFiles.length,
            metrics: sandbox.metrics,
            testLog: sandbox.testLog
          },
          evaluation,
          autoFrozen,
          testReportHash: evaluation.testReportHash,
          fujiAnchor
        });
      } catch (err) {
        sendJson(res, err.statusCode || 400, { ok: false, error: err.message });
      }
      return;
    }

    // API Tạo & Nạp quỹ Hợp đồng mới (POST /api/contracts)
    if (urlPath === '/api/contracts' && req.method === 'POST') {
      try {
        const body = await readJsonBody(req);
        const createRes = createEscrowContract(serverEscrowState, body);
        if (!createRes.ok) {
          sendJson(res, 400, { ok: false, error: createRes.error });
          return;
        }
        persistEscrowStateToDisk(serverEscrowState);
        sendJson(res, 201, createRes);
      } catch (err) {
        sendJson(res, err.statusCode || 400, { ok: false, error: err.message });
      }
      return;
    }

    // API Nộp bàn giao sản phẩm từ Freelancer sang Client (POST /api/contracts/:id/deliver)
    const deliverMatch = urlPath.match(/^\/api\/contracts\/([^/]+)\/deliver$/);
    if (deliverMatch && req.method === 'POST') {
      try {
        const contractId = decodeURIComponent(deliverMatch[1]);
        const body = await readJsonBody(req);
        const contract = serverEscrowState.contracts.find((c) => c.id === contractId);
        if (!contract) {
          sendJson(res, 404, { ok: false, error: 'Không tìm thấy hợp đồng.' });
          return;
        }
        const { repoUrl, commitSha } = normalizeGitHubVerifyPayload(body);
        const previewUrl = String(body.previewUrl || '').trim();
        const deliveryNotes = String(body.deliveryNotes || '').trim();
        const attachments = Array.isArray(body.attachments) ? body.attachments : [];

        let verificationReport = body.verificationReport || null;
        if (!verificationReport) {
          if (repoUrl && /github\.com/i.test(repoUrl)) {
            const ghCheck = validateStrictGitHubVerifyInput({ repoUrl, commitSha });
            if (!ghCheck.valid) {
              sendJson(res, 400, { ok: false, error: ghCheck.error });
              return;
            }
          }
          const report = await runAutonomousVerificationAndAssessorLive(
            { deliverableUrl: repoUrl, commitHash: commitSha, deliverableNote: deliveryNotes },
            body.scenario || 'PASS_100'
          );
          verificationReport = report;
        }

        const resDeliver = submitDeliverable(serverEscrowState, contractId, {
          deliveredBy: body.deliveredBy || 'FREELANCER',
          repoUrl,
          commitHash: commitSha,
          previewUrl,
          deliveryNotes,
          attachments,
          verificationReport,
          testReportHash: body.testReportHash || verificationReport?.testReportHash
        });
        if (!resDeliver.ok) {
          sendJson(res, 400, resDeliver);
          return;
        }
        persistEscrowStateToDisk(serverEscrowState);
        sendJson(res, 200, resDeliver);
      } catch (err) {
        sendJson(res, err.statusCode || 400, { ok: false, error: err.message });
      }
      return;
    }

    // API Client gửi yêu cầu chỉnh sửa hợp đồng (POST /api/contracts/:id/request-revision)
    const revMatch = urlPath.match(/^\/api\/contracts\/([^/]+)\/request-revision$/);
    if (revMatch && req.method === 'POST') {
      try {
        const contractId = decodeURIComponent(revMatch[1]);
        const body = await readJsonBody(req);
        const contract = serverEscrowState.contracts.find((c) => c.id === contractId);
        if (!contract) {
          sendJson(res, 404, { ok: false, error: 'Không tìm thấy hợp đồng.' });
          return;
        }
        const reason = String(body.reason || body.comment || body.message || '').trim();
        const revResult = requestContractRevision(serverEscrowState, contractId, reason);
        if (!revResult.ok) {
          sendJson(res, 400, { ok: false, error: revResult.error });
          return;
        }
        persistEscrowStateToDisk(serverEscrowState);
        sendJson(res, 200, revResult);
      } catch (err) {
        sendJson(res, err.statusCode || 400, { ok: false, error: err.message });
      }
      return;
    }

    // API Đóng băng Quỹ / Mở Tranh chấp (POST /api/contracts/:id/dispute hoặc /freeze)
    const disputeFreezeMatch = urlPath.match(/^\/api\/contracts\/([^/]+)\/(dispute|freeze)$/);
    if (disputeFreezeMatch && req.method === 'POST') {
      try {
        const contractId = decodeURIComponent(disputeFreezeMatch[1]);
        const actionMode = disputeFreezeMatch[2];
        const body = await readJsonBody(req);
        const contract = serverEscrowState.contracts.find((c) => c.id === contractId);
        if (!contract) {
          sendJson(res, 404, { ok: false, error: 'Không tìm thấy hợp đồng.' });
          return;
        }
        if (Array.isArray(body.evidences) && body.evidences.length > 0 && (!Array.isArray(contract.evidences) || contract.evidences.length === 0)) {
          contract.evidences = body.evidences;
        }
        if (actionMode === 'freeze' && (!Array.isArray(contract.evidences) || contract.evidences.length === 0)) {
          contract.evidences = [{ id: `EV-${Date.now()}`, fileName: 'freeze-snapshot.json', uploadedBy: 'CLIENT' }];
        }
        const actorRole = String(body.role || req.headers['x-user-role'] || 'client').toLowerCase();
        const openRes = openDisputeWithEvidence(
          serverEscrowState,
          contractId,
          { role: actorRole, actorId: body.actorId },
          String(body.reason || '').trim()
        );
        if (!openRes.ok) {
          sendJson(res, 400, { ok: false, error: openRes.error });
          return;
        }
        openRes.contract.isFrozen = true;
        openRes.contract.vaultFrozen = true;
        openRes.contract.timelockPaused = true;
        if (actionMode === 'freeze') {
          openRes.contract.status = 'FROZEN';
        }
        persistEscrowStateToDisk(serverEscrowState);
        sendJson(res, 200, { ok: true, contract: openRes.contract });
      } catch (err) {
        sendJson(res, err.statusCode || 400, { ok: false, error: err.message });
      }
      return;
    }

    // API Giải ngân Milestone có kiểm tra Multi-Sig 2-of-3 bắt buộc
    const releaseMatch = urlPath.match(/^\/api\/milestones\/([^/]+)\/release$/);
    if (releaseMatch && req.method === 'POST') {
      try {
        const contractId = decodeURIComponent(releaseMatch[1]);
        const body = await readJsonBody(req);
        const contract = serverEscrowState.contracts.find((c) => c.id === contractId);
        if (!contract) {
          sendJson(res, 404, { ok: false, error: 'Không tìm thấy hợp đồng.' });
          return;
        }
        if (body.buyerSigned === true || String(req.headers['x-user-role'] || '').toLowerCase() === 'client') {
          contract.signatures = contract.signatures || {};
          contract.signatures.client = true;
          contract.signatures.buyer = true;
        }
        const sigCheck = assertMultiSig2Of3(contract, 'RELEASE');
        if (!sigCheck.ok) {
          sendJson(res, 403, { ok: false, error: sigCheck.error });
          return;
        }
        const result = releasePartialMilestone(serverEscrowState, contractId, body.percent ?? 50);
        if (!result.ok) {
          sendJson(res, 400, result);
          return;
        }
        persistEscrowStateToDisk(serverEscrowState);
        sendJson(res, 200, result);
      } catch (err) {
        sendJson(res, err.statusCode || 400, { ok: false, error: err.message });
      }
      return;
    }

    // API Phân xử Tranh chấp có kiểm tra Multi-Sig 2-of-3 & Chống xung đột lợi ích
    const resolveMatch = urlPath.match(/^\/api\/milestones\/([^/]+)\/resolve-dispute$/);
    if (resolveMatch && req.method === 'POST') {
      try {
        const contractId = decodeURIComponent(resolveMatch[1]);
        const body = await readJsonBody(req);
        const contract = serverEscrowState.contracts.find((c) => c.id === contractId);
        if (!contract) {
          sendJson(res, 404, { ok: false, error: 'Không tìm thấy hợp đồng.' });
          return;
        }
        const sigCheck = assertMultiSig2Of3(contract, 'DISPUTE_RESOLUTION');
        if (!sigCheck.ok) {
          sendJson(res, 403, { ok: false, error: sigCheck.error });
          return;
        }
        const result = resolveDisputeByArbiter(
          serverEscrowState,
          contractId,
          body.resolution || 'CUSTOM_SPLIT',
          body.customBuyerPercent ?? 35,
          { role: 'arbiter', actorId: body.actorId }
        );
        if (!result.ok) {
          sendJson(res, 400, result);
          return;
        }
        sendJson(res, 200, result);
      } catch (err) {
        sendJson(res, err.statusCode || 400, { ok: false, error: err.message });
      }
      return;
    }

    // API Khuyến nghị Chia Quỹ Đóng Băng theo điểm chấm nghiệm thu (POST /api/milestones/:milestoneId/dispute-recommendation)
    const disputeRecMatch = urlPath.match(/^\/api\/milestones\/([^/]+)\/dispute-recommendation$/);
    if (disputeRecMatch && req.method === 'POST') {
      try {
        const milestoneId = decodeURIComponent(disputeRecMatch[1]);
        const body = await readJsonBody(req);
        const agreementId = body.agreementId || milestoneId;
        const baselinesDir = path.join(ROOT_DIR, 'data', 'baselines');

        const cached = latestEvaluationReports.get(milestoneId);
        const matchedContract = serverEscrowState.contracts.find(
          (c) => c.id === agreementId || c.id === milestoneId
        );

        let baseline = body.baseline || cached?.baseline || loadBaseline(agreementId, milestoneId, { baseDir: baselinesDir });
        if (!baseline) {
          const refined = await refineVagueCriteria(
            matchedContract?.title || body.contractTitle || 'Hợp đồng Escrow',
            matchedContract?.acceptanceCriteria || body.acceptanceCriteria || ['API chạy nhanh', 'Code không lỗi', 'Giao diện đẹp'],
            loadHistoricalBaselines(baselinesDir),
            { useLlm: false }
          );
          baseline = createBaseline({
            agreementId: matchedContract?.id || agreementId,
            milestoneId,
            persist: false,
            scopeConstraints: body.scopeConstraints || { forbiddenPaths: ['.env', 'config/secrets'] },
            acceptanceCriteria: refined.criteria.map((c) =>
              c.type === 'DETERMINISTIC'
                ? {
                    id: c.id,
                    type: 'DETERMINISTIC',
                    metric: c.metric,
                    operator: c.operator,
                    expectedValue: c.expectedValue,
                    weight: c.weight
                  }
                : {
                    id: c.id,
                    type: 'SUBJECTIVE',
                    description: c.clarifiedDescription || c.originalText,
                    requiresHitl: true,
                    weight: c.weight
                  }
            )
          });
        }

        const evaluationReport =
          body.evaluationReport ||
          cached?.evaluation ||
          evaluateSubmission(baseline, {
            changedFiles: body.changedFiles || [],
            metrics: body.metrics || {
              unit_test_pass_rate: matchedContract?.ciVerified ? 100 : 70,
              api_latency_ms: matchedContract?.ciVerified ? 160 : 320,
              security_critical_issues: 0
            }
          });

        const frozenAmount =
          body.frozenAmount !== undefined
            ? Number(body.frozenAmount)
            : Math.max(0, Number(matchedContract?.amount || 3000000) - Number(matchedContract?.releasedSoFar || 0));

        const recommendation = calculateFrozenFundSplit({
          frozenAmount,
          baseline,
          evaluationReport,
          hitlDisputeResolutionRatio: body.hitlDisputeResolutionRatio ?? 0.5
        });

        sendJson(res, 200, {
          ok: true,
          milestoneId,
          agreementId: baseline.agreementId,
          baselineHash: baseline.baselineHash,
          ...recommendation
        });
      } catch (err) {
        sendJson(res, 400, { ok: false, error: err.message });
      }
      return;
    }

    if (urlPath === '/api/tools' && req.method === 'GET') {
      sendJson(res, 200, {
        ok: true,
        tools: AGENT_VERIFICATION_TOOLS.map(({ name, description }) => ({ name, description }))
      });
      return;
    }

    if (urlPath === '/api/tools/execute' && req.method === 'POST') {
      try {
        const { tool, args } = await readJsonBody(req);
        const result = await executeAgentTool(tool, args || {});
        sendJson(res, 200, { ok: true, result });
      } catch (err) {
        sendJson(res, 400, { ok: false, error: err.message });
      }
      return;
    }

    if (urlPath === '/api/avalanche/status' && req.method === 'GET') {
      const reqUrl = new URL(req.url || '/', 'http://localhost');
      const result = await fetchAvalancheContext({
        chainId: reqUrl.searchParams.get('chainId') || undefined,
        address: reqUrl.searchParams.get('address') || undefined,
        txHash: reqUrl.searchParams.get('txHash') || undefined
      });
      if (!result) {
        sendJson(res, 502, { ok: false, error: 'Không thể kết nối Avalanche Glacier API' });
        return;
      }
      sendJson(res, 200, { ok: true, ...result });
      return;
    }

    if (urlPath === '/api/powerbatch-report') {
      const reportPath = path.join(ROOT_DIR, '.antigravity', 'powerbatch-report.json');
      if (fs.existsSync(reportPath)) {
        res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' });
        res.end(fs.readFileSync(reportPath, 'utf8'));
      } else {
        sendJson(res, 404, { error: 'Chưa có báo cáo PowerBatch' });
      }
      return;
    }

    const relativeFile = urlPath === '/' ? 'index.html' : urlPath.replace(/^\/+/, '');
    const safePath = path.normalize(path.join(__dirname, relativeFile));

    if (!safePath.startsWith(__dirname) || !fs.existsSync(safePath) || fs.statSync(safePath).isDirectory()) {
      res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' });
      res.end('404 Not Found');
      return;
    }

    const ext = path.extname(safePath);
    res.writeHead(200, {
      'Content-Type': MIME_TYPES[ext] || 'application/octet-stream',
      'X-Antigravity-Engine': 'PowerBatch-v1.0',
      ...SECURITY_HEADERS
    });
    res.end(fs.readFileSync(safePath));
  });
}

if (process.argv[1] && path.resolve(process.argv[1]) === __filename) {
  const server = createPreviewServer();
  server.on('error', (err) => {
    if (err.code === 'EADDRINUSE') {
      console.log(`[Antigravity Preview Server] Cong ${PORT} da dang duoc su dung boi mot tien trinh.`);
      console.log(`[Antigravity Preview Server] He thong da san sang tai http://localhost:${PORT} hoac http://127.0.0.1:${PORT}`);
      process.exit(0);
    } else {
      console.error('[Antigravity Preview Server] Loi khoi dong:', err);
      process.exit(1);
    }
  });
  server.listen(PORT, HOST, () => {
    setInterval(() => {
      processAutoReleaseContracts(serverEscrowState, Date.now());
    }, 15000).unref();
    console.log(`[Antigravity Preview Server] Listening at http://${HOST}:${PORT}`);
  });
}
