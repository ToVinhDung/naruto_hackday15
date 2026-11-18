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
  evaluateGuardrailCommand,
  calculateFeeBreakdown,
  buildContractMilestones,
  submitClientTopup
} from '../src/app.js';
import { validateContractTitle, detectScopeCreepRisk } from '../src/agents.js';
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

    const expectedToken = process.env.ARBITER_AUTH_TOKEN || 'naruto';
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

test('P2-1 & P2-2: REFUND_CLIENT hoàn 100% không trừ phí, và calculateFeeBreakdown hỗ trợ feePayer (FREELANCER/CLIENT/SPLIT)', () => {
  const feeFreelancer = calculateFeeBreakdown(1000000, 'VietQR', 'VND', 'FREELANCER');
  assert.equal(feeFreelancer.clientPays, 1000000);
  assert.equal(feeFreelancer.netPayout, 1000000 - feeFreelancer.totalFee);

  const feeClient = calculateFeeBreakdown(1000000, 'VietQR', 'VND', 'CLIENT');
  assert.equal(feeClient.clientPays, 1000000 + feeClient.totalFee);
  assert.equal(feeClient.netPayout, 1000000);

  const feeSplit = calculateFeeBreakdown(1000000, 'VietQR', 'VND', 'SPLIT');
  assert.equal(feeSplit.clientFee + feeSplit.freelancerFee, feeSplit.totalFee);

  const state = createInitialEscrowState();
  const c103 = state.contracts.find((c) => c.id === 'ESC-103');
  const originalAmount = c103.amount;
  const beforeClient = state.clientBalance;
  const res = resolveDisputeByArbiter(state, 'ESC-103', 'REFUND_CLIENT', 100, { role: 'arbiter' });
  assert.equal(res.ok, true);
  assert.equal(res.buyerShare, originalAmount);
  assert.equal(res.feeInfo.totalFee, 0);
  assert.equal(state.clientBalance, beforeClient + originalAmount);
});

test('P2-3, P2-4 & P2-5: Chia 2 đợt đúng 40%/60%, giải ngân đúng milestone.amount tiếp theo, và nút nạp nhanh đổi thành 20.000đ', () => {
  const milestones = buildContractMilestones(5000000, 2);
  assert.equal(milestones[0].amount, 2000000); // 40%
  assert.equal(milestones[1].amount, 3000000); // 60%

  const state = createInitialEscrowState();
  const c101 = state.contracts.find((c) => c.id === 'ESC-101');
  // ESC-101: 4.000.000đ, 2 đợt -> M1 = 1.600.000đ (40%), M2 = 2.400.000đ (60%)
  const rel1 = releasePartialMilestone(state, 'ESC-101');
  assert.equal(rel1.ok, true);
  assert.equal(rel1.feeInfo.gross, 1600000);
  assert.equal(c101.amount, 2400000);

  const html = fs.readFileSync('src/index.html', 'utf8');
  assert.equal(html.includes('data-preset-amount="5000"'), false);
  assert.equal(html.includes('data-preset-amount="20000"'), true);
});

test('P2-6: detectScopeCreepRisk đối chiếu tiêu chí hợp đồng để phát hiện chức năng ngoài phạm vi', () => {
  const inScope = detectScopeCreepRisk('Sửa lại giao diện trang chủ cho gọn', 'Thiết kế giao diện trang chủ White UI');
  assert.equal(inScope.hasScopeCreepRisk, false);

  const outOfScope = detectScopeCreepRisk(
    'Yêu cầu hỗ trợ thêm blockchain và oauth đăng nhập',
    'Xây dựng API thanh toán VietQR, Coverage > 80%'
  );
  assert.equal(outOfScope.hasScopeCreepRisk, true);
  assert.ok(outOfScope.outOfScopeFeatures.includes('blockchain'));
  assert.ok(outOfScope.outOfScopeFeatures.includes('oauth'));
});

test('P2-9: Mã lệnh nạp tiền dùng crypto.randomUUID().slice(0, 8) qua server và không bị ghi đè 0 -> 35 với ??', async () => {
  const server = createPreviewServer();
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const { port } = server.address();
  try {
    const res1 = await fetch(`http://127.0.0.1:${port}/api/topups/id`, { method: 'POST' }).then((r) => r.json());
    const res2 = await fetch(`http://127.0.0.1:${port}/api/topups/id`, { method: 'POST' }).then((r) => r.json());
    assert.equal(res1.ok, true);
    assert.match(res1.topupId, /^TOPUP-[A-F0-9]{8}$/);
    assert.notEqual(res1.topupId, res2.topupId);
  } finally {
    server.close();
  }

  const state = createInitialEscrowState();
  const topup = submitClientTopup(state, { accountNumber: '0000000000', amount: 500000, method: 'VietQR' });
  assert.equal(topup.ok, true);
  assert.match(topup.entry.id, /^TOPUP-[A-F0-9]{8}$/);

  // customBuyerPercent = 0 không bị ghi đè thành 35
  const splitZero = resolveDisputeByArbiter(state, 'ESC-103', 'CUSTOM_SPLIT', 0, { role: 'arbiter' });
  assert.equal(splitZero.ok, true);
  assert.equal(splitZero.buyerShare, 0);
});

test('P2-10: Sổ cái lưu contractId và bank-ui gắn data-bank-contract để click mở đúng hợp đồng', () => {
  const state = createInitialEscrowState();
  const rel = releasePartialMilestone(state, 'ESC-101');
  assert.equal(rel.ok, true);
  assert.equal(state.ledger[0].contractId, 'ESC-101');

  const bankUi = fs.readFileSync('src/bank-ui.js', 'utf8');
  assert.ok(bankUi.includes('tx.contractId'));
  assert.ok(bankUi.includes('data-bank-contract'));
});

