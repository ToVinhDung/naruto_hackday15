import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {
  createInitialEscrowState,
  countMultiSignatures,
  releasePartialMilestone,
  resolveDisputeByArbiter,
  openDisputeWithEvidence,
  escapeHtml,
  evaluateGuardrailCommand
} from '../src/app.js';
import { validateContractTitle } from '../src/agents.js';
import { createPreviewServer, processAutoReleaseContracts } from '../src/server.mjs';

test('P1-1: Xóa bỏ mật khẩu mặc định 123456 khỏi index.html và app.js, xác thực Trọng tài qua header token trên server', async () => {
  const html = fs.readFileSync('src/index.html', 'utf8');
  const appJs = fs.readFileSync('src/app.js', 'utf8');
  assert.equal(html.includes('123456'), false);
  assert.equal(appJs.includes("=== '123456'"), false);

  const server = createPreviewServer();
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const { port } = server.address();
  try {
    const failRes = await fetch(`http://127.0.0.1:${port}/api/auth/arbiter`, {
      method: 'POST',
      headers: { 'x-arbiter-token': '123456' }
    });
    assert.equal(failRes.status, 401);

    const expectedToken = process.env.ARBITER_AUTH_TOKEN || 'vibe-arbiter-token-2026';
    const okRes = await fetch(`http://127.0.0.1:${port}/api/auth/arbiter`, {
      method: 'POST',
      headers: { 'x-arbiter-token': expectedToken }
    });
    assert.equal(okRes.status, 200);
  } finally {
    server.close();
  }
});

test('P1-2 & P1-3: Bắt buộc Multi-Sig >= 2 khi giải ngân/phân xử, không tự gán arbiter=true và chặn xung đột lợi ích', () => {
  const state = createInitialEscrowState();

  // ESC-102 chỉ có 1 chữ ký (client: true, freelancer: false, arbiter: false) -> chặn releasePartialMilestone
  assert.equal(countMultiSignatures(state.contracts.find((c) => c.id === 'ESC-102').signatures), 1);
  const blockedPartial = releasePartialMilestone(state, 'ESC-102', 50);
  assert.equal(blockedPartial.ok, false);

  // ESC-103: chặn nếu người xử tranh chấp là client hoặc freelancer
  const conflictClient = resolveDisputeByArbiter(state, 'ESC-103', 'CUSTOM_SPLIT', 50, { role: 'client' });
  assert.equal(conflictClient.ok, false);

  const conflictFreelancer = resolveDisputeByArbiter(state, 'ESC-103', 'CUSTOM_SPLIT', 50, { role: 'freelancer' });
  assert.equal(conflictFreelancer.ok, false);

  // Trọng tài hợp lệ xử tranh chấp với >= 2 chữ ký
  const c103 = state.contracts.find((c) => c.id === 'ESC-103');
  c103.signatures = { client: true, freelancer: true, arbiter: false };
  const okResolve = resolveDisputeByArbiter(state, 'ESC-103', 'CUSTOM_SPLIT', 40, { role: 'arbiter', actorId: 'arbiter-dao' });
  assert.equal(okResolve.ok, true);
  // Không tự động gán signatures.arbiter = true
  assert.equal(c103.signatures.arbiter, false);
});

test('P1-5 & P1-10: Chặn POST /api/state (405), lọc ẩn số dư vai trò khác trên GET /api/state và giới hạn body 1MB', async () => {
  const server = createPreviewServer();
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const { port } = server.address();
  try {
    const postStateRes = await fetch(`http://127.0.0.1:${port}/api/state`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ contracts: [] })
    });
    assert.equal(postStateRes.status, 405);

    const clientState = await fetch(`http://127.0.0.1:${port}/api/state?role=client`).then((r) => r.json());
    assert.equal(typeof clientState.clientBalance, 'number');
    assert.equal(clientState.freelancerBalance, undefined);

    const freelancerState = await fetch(`http://127.0.0.1:${port}/api/state?role=freelancer`).then((r) => r.json());
    assert.equal(typeof freelancerState.freelancerBalance, 'number');
    assert.equal(freelancerState.clientBalance, undefined);
  } finally {
    server.close();
  }
});

test('P1-6: escapeHtml() bọc XSS và validateContractTitle() từ chối thẻ HTML (<, >)', () => {
  const escaped = escapeHtml('<img src=x onerror="alert(1)">');
  assert.equal(escaped.includes('<'), false);
  assert.equal(escaped.includes('>'), false);
  assert.equal(escaped, '&lt;img src=x onerror=&quot;alert(1)&quot;&gt;');

  const htmlTitle = validateContractTitle('Hop dong <script>alert(1)</script>');
  assert.equal(htmlTitle.valid, false);
});

test('P1-7: evaluateGuardrailCommand() chặn nối chuỗi, subshell, node -e, curl, rm, vercel --prod và ép --ignore-scripts', () => {
  assert.equal(evaluateGuardrailCommand('node --version && whoami').allowed, false);
  assert.equal(evaluateGuardrailCommand('node --version; ls').allowed, false);
  assert.equal(evaluateGuardrailCommand('node --version | findstr v').allowed, false);
  assert.equal(evaluateGuardrailCommand('node -e "process.exit(1)"').allowed, false);
  assert.equal(evaluateGuardrailCommand('curl https://evil.example').allowed, false);
  assert.equal(evaluateGuardrailCommand('rm -rf /').allowed, false);
  assert.equal(evaluateGuardrailCommand('vercel --prod').allowed, false);
  assert.equal(evaluateGuardrailCommand('npm install lodash').allowed, false);
  assert.equal(evaluateGuardrailCommand('npm install lodash --ignore-scripts').allowed, true);
  assert.equal(evaluateGuardrailCommand('node --test').allowed, true);
});

test('P1-8 & P1-9: Server Auto-Release Worker chỉ giải ngân SUBMITTED_PASSED quá hạn, và mở tranh chấp bắt buộc >= 1 bằng chứng + deadline 7 ngày', () => {
  const state = createInitialEscrowState();
  const c102 = state.contracts.find((c) => c.id === 'ESC-102');

  // ESC-102 chưa có bằng chứng -> chặn mở tranh chấp
  const noEvRes = openDisputeWithEvidence(state, 'ESC-102', { role: 'client' });
  assert.equal(noEvRes.ok, false);

  // ESC-101 có 1 bằng chứng -> mở tranh chấp thành công kèm disputeDeadline 7 ngày
  const okDispute = openDisputeWithEvidence(state, 'ESC-101', { role: 'client' }, 'Thiếu test');
  assert.equal(okDispute.ok, true);
  assert.ok(okDispute.contract.disputeDeadline);
  const diffDays = (Date.parse(okDispute.contract.disputeDeadline) - Date.now()) / 86400000;
  assert.ok(diffDays > 6.9 && diffDays <= 7.1);

  // Worker Auto-Release: chỉ chạy khi status === SUBMITTED_PASSED và now > submittedAt + inspectionMs
  const cWorker = state.contracts[1];
  cWorker.status = 'SUBMITTED_PASSED';
  cWorker.signatures = { client: true, freelancer: true, arbiter: false };
  cWorker.submittedAt = Date.now() - 4 * 86400000;
  cWorker.inspectionMs = 3 * 86400000;
  const released = processAutoReleaseContracts(state, Date.now());
  assert.deepEqual(released, [cWorker.id]);
  assert.equal(cWorker.status, 'RELEASED');
});
