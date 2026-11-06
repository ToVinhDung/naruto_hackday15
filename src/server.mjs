/**
 * Local Execution Sandbox & Dynamic API Server (src/server.mjs)
 * Phục vụ giao diện White Tone UI tại http://localhost:3000 và các REST API dữ liệu động.
 */

import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  ESCROW_AGENTS_MATRIX,
  runScopeDecomposerAgent,
  runAutonomousVerificationAndAssessor,
  runFactFindingBailiffAgent
} from './agents.js';
import { createInitialEscrowState } from './app.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const ROOT_DIR = path.resolve(__dirname, '..');

const PORT = Number(process.env.PORT || 3000);

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

function readJsonBody(req) {
  return new Promise((resolve, reject) => {
    let body = '';
    req.on('data', (chunk) => {
      body += chunk;
    });
    req.on('end', () => {
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
    req.on('error', reject);
  });
}

function sendJson(res, statusCode, data) {
  res.writeHead(statusCode, {
    'Content-Type': 'application/json; charset=utf-8',
    'Cache-Control': 'no-store'
  });
  res.end(JSON.stringify(data));
}

export function createPreviewServer() {
  return http.createServer(async (req, res) => {
    const urlPath = (req.url || '/').split('?')[0];

    if (urlPath === '/api/health') {
      sendJson(res, 200, {
        status: 'ok',
        engine: 'Google Antigravity + PowerBatch + Vercel',
        uiTheme: 'Pure White (#FFFFFF)',
        dynamicApi: true
      });
      return;
    }

    // API lấy & đồng bộ dữ liệu động của toàn bộ phiên giao dịch Escrow
    if (urlPath === '/api/state') {
      if (req.method === 'GET') {
        sendJson(res, 200, serverEscrowState);
        return;
      }
      if (req.method === 'POST') {
        try {
          const updated = await readJsonBody(req);
          if (updated && typeof updated === 'object' && Array.isArray(updated.contracts)) {
            serverEscrowState = updated;
          }
          sendJson(res, 200, { ok: true, state: serverEscrowState });
        } catch (err) {
          sendJson(res, 400, { error: err.message });
        }
        return;
      }
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
        const result = runScopeDecomposerAgent(brief);
        sendJson(res, 200, result);
      } catch (err) {
        sendJson(res, 400, { error: err.message });
      }
      return;
    }

    // API Tầng 2 & 3: Autonomous Verification & Technical Assessor Agent
    if ((urlPath === '/api/verify-assess' || urlPath === '/api/agents/verify-assess') && req.method === 'POST') {
      try {
        const { submission, scenario } = await readJsonBody(req);
        const result = runAutonomousVerificationAndAssessor(submission, scenario);
        sendJson(res, 200, result);
      } catch (err) {
        sendJson(res, 400, { error: err.message });
      }
      return;
    }

    // API Tầng 4: Autonomous Fact-finding Bailiff Agent
    if ((urlPath === '/api/fact-finding' || urlPath === '/api/agents/fact-finding') && req.method === 'POST') {
      try {
        const contract = await readJsonBody(req);
        const result = runFactFindingBailiffAgent(contract);
        sendJson(res, 200, result);
      } catch (err) {
        sendJson(res, 400, { error: err.message });
      }
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
      'X-Antigravity-Engine': 'PowerBatch-v1.0'
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
  server.listen(PORT, '0.0.0.0', () => {
    console.log(`[Antigravity Preview Server] Listening at http://localhost:${PORT} and http://127.0.0.1:${PORT}`);
  });
}
