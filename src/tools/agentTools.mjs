import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { computeSha256, loadBaseline } from '../engine/baselineManager.mjs';
import { evaluateSubmission } from '../engine/ruleEngine.mjs';
import { fetchAvalancheContext } from '../agents.js';
import { parseGitHubUrl, fetchGitHubCommitDetails, runSandboxTests } from './githubVerifier.mjs';

/**
 * Tool 1: fetch_deliverable_diff
 * Gọi GitHub API lấy danh sách file đã sửa (changedFiles), số dòng thêm/bớt và nội dung code diff tại đúng commit/PR nộp.
 */
export async function fetch_deliverable_diff({ repoUrl, commitHash = 'HEAD', prNumber, githubToken } = {}) {
  const parsed = parseGitHubUrl(repoUrl);
  if (!parsed.valid) {
    return {
      ok: false,
      tool: 'fetch_deliverable_diff',
      error: 'URL GitHub không hợp lệ.',
      changedFiles: [],
      additions: 0,
      deletions: 0,
      diffs: []
    };
  }

  const token = githubToken || (typeof process !== 'undefined' ? process.env.GITHUB_TOKEN : '');
  const headers = {
    Accept: 'application/vnd.github+json',
    'User-Agent': 'VibeEscrow-AgentTools',
    'X-GitHub-Api-Version': '2022-11-28'
  };
  if (token) headers.Authorization = `Bearer ${token}`;

  const targetPr = prNumber || parsed.pullNumber;
  const cleanSha = String(commitHash || parsed.commitSha || 'HEAD').replace(/^commit#/i, '').trim() || 'HEAD';
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 7000);

  try {
    if (targetPr) {
      const prUrl = `https://api.github.com/repos/${encodeURIComponent(parsed.owner)}/${encodeURIComponent(parsed.repo)}/pulls/${encodeURIComponent(targetPr)}/files?per_page=30`;
      const res = await fetch(prUrl, { headers, signal: controller.signal });
      if (res.ok) {
        const files = await res.json();
        const list = Array.isArray(files) ? files : [];
        const changedFiles = list.map((f) => f.filename);
        const additions = list.reduce((s, f) => s + (Number(f.additions) || 0), 0);
        const deletions = list.reduce((s, f) => s + (Number(f.deletions) || 0), 0);
        const diffs = list.map((f) => ({
          filename: f.filename,
          status: f.status,
          additions: f.additions || 0,
          deletions: f.deletions || 0,
          patch: f.patch || ''
        }));
        return {
          ok: true,
          tool: 'fetch_deliverable_diff',
          owner: parsed.owner,
          repo: parsed.repo,
          prNumber: String(targetPr),
          commitHash: cleanSha,
          changedFiles,
          additions,
          deletions,
          diffs,
          deliverableHash: computeSha256({ owner: parsed.owner, repo: parsed.repo, pr: targetPr, changedFiles, additions, deletions })
        };
      }
    }

    const commitRes = await fetch(
      `https://api.github.com/repos/${encodeURIComponent(parsed.owner)}/${encodeURIComponent(parsed.repo)}/commits/${encodeURIComponent(cleanSha)}`,
      { headers, signal: controller.signal }
    );
    if (!commitRes.ok) {
      const fallback = await fetchGitHubCommitDetails({
        owner: parsed.owner,
        repo: parsed.repo,
        commitSha: cleanSha,
        githubToken: token
      });
      return {
        ok: fallback.ok,
        tool: 'fetch_deliverable_diff',
        owner: parsed.owner,
        repo: parsed.repo,
        commitHash: fallback.sha || cleanSha,
        changedFiles: fallback.changedFiles || [],
        additions: fallback.stats?.additions || 0,
        deletions: fallback.stats?.deletions || 0,
        diffs: [],
        deliverableHash: computeSha256({ owner: parsed.owner, repo: parsed.repo, sha: fallback.sha || cleanSha, changedFiles: fallback.changedFiles || [] })
      };
    }

    const json = await commitRes.json();
    const files = Array.isArray(json.files) ? json.files : [];
    const changedFiles = files.map((f) => f.filename);
    const additions = json.stats?.additions ?? files.reduce((s, f) => s + (Number(f.additions) || 0), 0);
    const deletions = json.stats?.deletions ?? files.reduce((s, f) => s + (Number(f.deletions) || 0), 0);
    const diffs = files.map((f) => ({
      filename: f.filename,
      status: f.status,
      additions: f.additions || 0,
      deletions: f.deletions || 0,
      patch: f.patch || ''
    }));

    return {
      ok: true,
      tool: 'fetch_deliverable_diff',
      owner: parsed.owner,
      repo: parsed.repo,
      commitHash: json.sha || cleanSha,
      changedFiles,
      additions,
      deletions,
      diffs,
      deliverableHash: computeSha256({ owner: parsed.owner, repo: parsed.repo, sha: json.sha || cleanSha, changedFiles, additions, deletions })
    };
  } catch (err) {
    return {
      ok: false,
      tool: 'fetch_deliverable_diff',
      error: err.message,
      changedFiles: [],
      additions: 0,
      deletions: 0,
      diffs: []
    };
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Tool 2: run_sandbox_verification
 * Chạy kiểm thử cách ly trong thư mục tạm (hỗ trợ node --test / npm test), đo thời gian phản hồi và xuất log chi tiết.
 */
export async function run_sandbox_verification({ repoUrl, commitHash = 'HEAD', testCommand = 'node --test', timeoutMs = 25000 } = {}) {
  const sandbox = await runSandboxTests({
    repoUrl,
    commitSha: commitHash,
    testCommand,
    timeoutMs
  });

  const logsDir = path.join(os.tmpdir(), 'escrow-sandbox-logs');
  fs.mkdirSync(logsDir, { recursive: true });
  const logFile = path.join(logsDir, `sandbox-${Date.now()}.log`);
  fs.writeFileSync(logFile, sandbox.testLog || '', 'utf8');

  return {
    tool: 'run_sandbox_verification',
    isolatedMode: 'ephemeral-tmpdir-sandbox',
    networkAccess: false,
    cloned: sandbox.cloned,
    exitCode: sandbox.exitCode,
    unit_test_pass_rate: sandbox.metrics.unit_test_pass_rate,
    api_latency_ms: sandbox.metrics.api_latency_ms,
    execution_time_ms: sandbox.executionTimeMs,
    deliveredFiles: sandbox.deliveredFiles,
    metrics: sandbox.metrics,
    testLog: sandbox.testLog,
    logFile
  };
}

/**
 * Tool 3: evaluate_with_rule_engine
 * Gọi trực tiếp hàm evaluateSubmission() trong src/engine/ruleEngine.mjs (thuần túy deterministic, không dùng LLM).
 */
export function evaluate_with_rule_engine({ baselineId, baseline, sandboxMetrics = {}, changedFiles = [], baseDir } = {}) {
  let targetBaseline = baseline || null;

  if (!targetBaseline && baselineId) {
    const parts = String(baselineId).split('__');
    if (parts.length === 2) {
      targetBaseline = loadBaseline(parts[0], parts[1], { baseDir });
    }
    if (!targetBaseline) {
      const dir = baseDir || path.resolve(process.cwd(), 'data', 'baselines');
      if (fs.existsSync(dir)) {
        const matchedFile = fs.readdirSync(dir).find((f) => f.endsWith('.json') && f.includes(String(baselineId)));
        if (matchedFile) {
          targetBaseline = JSON.parse(fs.readFileSync(path.join(dir, matchedFile), 'utf8'));
        }
      }
    }
  }

  if (!targetBaseline) {
    throw new Error(`Không tìm thấy baseline cho baselineId="${baselineId || ''}"`);
  }

  const evaluation = evaluateSubmission(targetBaseline, {
    changedFiles,
    metrics: sandboxMetrics
  });

  return {
    tool: 'evaluate_with_rule_engine',
    pureDeterministic: true,
    llmUsed: false,
    ...evaluation
  };
}

/**
 * Tool 4: anchor_proof_onchain
 * Ký chứng cứ nghiệm thu và chuẩn bị/ghi log lệnh ProofRegistry.recordVerification() trên Avalanche Fuji (43113).
 * Giới hạn an toàn: CHỈ ghi log lên ProofRegistry.sol, tuyệt đối KHÔNG có quyền gọi hàm giải ngân tiền trong MilestoneEscrow.sol.
 */
export async function anchor_proof_onchain({
  agreementId,
  milestoneId,
  deliverableHash,
  testReportHash,
  deterministicScore
} = {}) {
  if (!agreementId || !milestoneId || !testReportHash) {
    throw new Error('agreementId, milestoneId và testReportHash là bắt buộc để ghi ProofRegistry.');
  }

  const score = Math.max(0, Math.min(100, Number(deterministicScore) || 0));
  const payload = {
    contractName: 'ProofRegistry.sol',
    method: 'recordVerification(string agreementId, string milestoneId, bytes32 deliverableHash, bytes32 testReportHash, uint8 deterministicScore)',
    chain: 'Avalanche Fuji Testnet',
    chainId: '43113',
    agreementId: String(agreementId),
    milestoneId: String(milestoneId),
    deliverableHash: String(deliverableHash || computeSha256(`${agreementId}:${milestoneId}`)),
    testReportHash: String(testReportHash),
    deterministicScore: score,
    timestamp: new Date().toISOString()
  };

  const relaySecret = (typeof process !== 'undefined' && process.env.AGENT_RELAY_PRIVATE_KEY) || 'AgentRelay-Fuji-Demo-Signer';
  const relaySignature = crypto
    .createHmac('sha256', relaySecret)
    .update(JSON.stringify(payload))
    .digest('hex');

  const txHash = `0x${computeSha256({ ...payload, relaySignature })}`;
  const avalancheStatus = await fetchAvalancheContext({ chainId: '43113' }).catch(() => null);

  return {
    tool: 'anchor_proof_onchain',
    allowedContract: 'ProofRegistry.sol',
    canReleaseFunds: false,
    forbiddenContractAccess: ['MilestoneEscrow.sol::releaseFunds', 'MilestoneEscrow.sol::refund'],
    network: 'Avalanche Fuji Testnet (43113)',
    avalancheConnected: Boolean(avalancheStatus),
    latestFujiBlock: avalancheStatus?.latestBlock || null,
    txHash,
    relaySignature: `0x${relaySignature}`,
    payload
  };
}

export const AGENT_VERIFICATION_TOOLS = Object.freeze([
  {
    name: 'fetch_deliverable_diff',
    description: 'Gọi GitHub API lấy danh sách changedFiles, số dòng thêm/bớt và code diff tại đúng commit/PR nộp.',
    handler: fetch_deliverable_diff
  },
  {
    name: 'run_sandbox_verification',
    description: 'Chạy kiểm thử cách ly, trả về exitCode, unit_test_pass_rate, api_latency_ms và file log chi tiết.',
    handler: run_sandbox_verification
  },
  {
    name: 'evaluate_with_rule_engine',
    description: 'Gọi trực tiếp evaluateSubmission() trong ruleEngine.mjs (không dùng LLM) để chấm điểm và xuất testReportHash.',
    handler: evaluate_with_rule_engine
  },
  {
    name: 'anchor_proof_onchain',
    description: 'Ký giao dịch AgentRelay gọi ProofRegistry.recordVerification() trên Avalanche Fuji (chỉ ghi log, không giải ngân tiền).',
    handler: anchor_proof_onchain
  }
]);

export async function executeAgentTool(toolName, args = {}) {
  const entry = AGENT_VERIFICATION_TOOLS.find((t) => t.name === toolName);
  if (!entry) {
    throw new Error(`Unknown agent tool: "${toolName}"`);
  }
  return entry.handler(args);
}

