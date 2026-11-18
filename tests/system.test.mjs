import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  ARCHITECTURE_NODES,
  GUARDRAIL_LAYERS_SPEC,
  ROLE_ZONES_CONFIG,
  validateTopupAmount,
  evaluateGuardrailCommand,
  createInitialEscrowState,
  calculateFeeBreakdown,
  buildContractMilestones,
  computeProofHashAndCid,
  countMultiSignatures,
  requestContractRevision,
  releasePartialMilestone,
  triggerTimelockAutoRelease,
  submitDisputeEvidence,
  resolveDisputeByArbiter,
  downloadEvidenceFile,
  submitClientTopup,
  approveTopupByArbiter,
  rejectTopupByArbiter,
  escapeHtml,
  evaluateAmlKycTier,
  toggleVaultCircuitBreaker,
  detectScopeCreepRisk
} from '../src/app.js';
import {
  ESCROW_AGENTS_MATRIX,
  runScopeDecomposerAgent,
  runAutonomousVerificationAndAssessor,
  runFactFindingBailiffAgent,
  isValidGitHubUrl,
  validateContractTitle
} from '../src/agents.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const ROOT_DIR = path.resolve(__dirname, '..');

test('1. Cấu trúc thư mục chuẩn hóa cho Antigravity + PowerBatch + Vercel tồn tại đầy đủ', () => {
  const requiredPaths = [
    '.antigravity/config.json',
    '.antigravity/system_prompt.md',
    '.antigravity/test_commands.json',
    '.antigravity/powerbatch.mjs',
    '.antigravity/agents.json',
    'docs/architecture.md',
    'docs/roadmap.md',
    'src/index.html',
    'src/styles.css',
    'src/app.js',
    'src/agents.js',
    'src/server.mjs',
    'vercel.json',
    'powerbatch.cmd',
    'package.json'
  ];

  for (const rel of requiredPaths) {
    const abs = path.join(ROOT_DIR, rel);
    assert.equal(fs.existsSync(abs), true, `Thiếu file bắt buộc: ${rel}`);
  }
});

test('2. 3 Trạng thái Đăng nhập (Client, Freelancer, Arbiter) mỗi vai trò có 3 Nút Vùng mở Toàn Màn Hình & Popup Giao dịch', () => {
  assert.ok(ARCHITECTURE_NODES.guardrails);
  assert.equal(GUARDRAIL_LAYERS_SPEC.length, 5);
  assert.equal(ROLE_ZONES_CONFIG.client.zones.length, 3);
  assert.equal(ROLE_ZONES_CONFIG.freelancer.zones.length, 3);
  assert.equal(ROLE_ZONES_CONFIG.arbiter.zones.length, 3);

  const html = fs.readFileSync(path.join(ROOT_DIR, 'src/index.html'), 'utf8');
  assert.match(html, /data-login-role="client"/);
  assert.match(html, /data-login-role="freelancer"/);
  assert.match(html, /data-login-role="arbiter"/);
  assert.match(html, /id="zone-launcher-grid"/);
  assert.match(html, /id="fullscreen-zone-stage"/);
  assert.match(html, /id="transaction-detail-modal"/);
  assert.match(html, /id="popup-evidence-file-input"/);
  assert.match(html, /id="btn-open-ai-agents-modal"/);
  assert.match(html, /id="ai-agents-modal"/);
  assert.match(html, /id="client-agent-failure-box"/);
  assert.match(html, /id="freelancer-agent-failure-box"/);
  assert.match(html, /id="wallet-card-client"/);
  assert.match(html, /id="wallet-card-freelancer"/);
  assert.match(html, /id="topup-account-input"/);
  assert.match(html, /id="freelancer-withdraw-account"/);
  assert.match(html, /id="contract-code-input"/);
  assert.match(html, /id="btn-new-contract-beside"/);
  assert.match(html, /id="topup-notification-zone"/);
  assert.match(html, /id="arbiter-auth-modal"/);
  assert.match(html, /id="arbiter-password-input"/);
  assert.match(html, /id="topup-notification-items-container"/);
  assert.equal(escapeHtml('<script>alert(1)</script>'), '&lt;script&gt;alert(1)&lt;/script&gt;');
  assert.ok(!html.includes('123456'), 'Không được chứa mật khẩu mặc định 123456 trong index.html');
});

test('3. Upload File Bằng chứng trong Cửa sổ Popup Giao dịch & Arbiter nhận đầy đủ File', () => {
  const state = createInitialEscrowState();
  const res = submitDisputeEvidence(
    state,
    'ESC-103',
    'CLIENT (Buyer)',
    'Đính kèm file log lỗi timeout',
    {
      fileName: 'buyer-timeout-log.txt',
      fileSizeKb: 84,
      fileType: 'text/plain'
    }
  );
  assert.equal(res.ok, true);
  assert.equal(res.entry.fileName, 'buyer-timeout-log.txt');
  assert.equal(res.entry.fileSizeKb, 84);

  const disputedContract = state.contracts.find((c) => c.id === 'ESC-103');
  assert.equal(disputedContract.evidences[0].fileName, 'buyer-timeout-log.txt');
});

test('4. Phân hệ 1–4: Chia Milestone, Multi-Sig 2-of-3, SHA-256/IPFS, Giải ngân từng phần & Timelock', () => {
  const milestones = buildContractMilestones(3000000, 3);
  assert.equal(milestones.length, 3);
  const fee = calculateFeeBreakdown(3000000, 'USDC Stablecoin');
  assert.equal(fee.takeRateFee, 60000);
  assert.equal(countMultiSignatures({ client: true, freelancer: true, arbiter: false }), 2);

  const proof = computeProofHashAndCid('commit#9f8c2a1');
  assert.match(proof.sha256, /^sha256:/);

  const state = createInitialEscrowState();
  const partial = releasePartialMilestone(state, 'ESC-101', 50);
  assert.equal(partial.ok, true);
  assert.equal(partial.contract.amount, 2400000);

  const rev = requestContractRevision(state, 'ESC-102', 'Cần cập nhật SLA');
  assert.equal(rev.ok, true);

  const autoRel = triggerTimelockAutoRelease(state, 'ESC-101');
  assert.equal(autoRel.ok, true);
  assert.equal(autoRel.contract.amount, 0);
});

test('5. Phân hệ 5 & 6: Trọng tài Chia Tỷ lệ Linh hoạt (60/40 Split) & Kiểm thử 5 Lớp Guardrails', () => {
  const state = createInitialEscrowState();
  const splitRes = resolveDisputeByArbiter(state, 'ESC-103', 'CUSTOM_SPLIT', 60);
  assert.equal(splitRes.ok, true);
  assert.equal(splitRes.contract.status, 'SPLIT');

  assert.equal(validateTopupAmount(10000).valid, false);
  assert.equal(validateTopupAmount(50000).valid, true);
  assert.equal(evaluateGuardrailCommand('rm -rf /').allowed, false);
  assert.equal(evaluateGuardrailCommand('cat .env.local').allowed, false);
  assert.equal(evaluateGuardrailCommand('git push --force origin main').allowed, false);
  assert.equal(evaluateGuardrailCommand('.\\powerbatch.cmd verify').allowed, true);
});

test('6. Hệ thống 4 Tầng Agentic AI: Soạn thảo Checklist, Sandbox Verifier, Technical Assessor & Fact-finding Bailiff', () => {
  assert.equal(ESCROW_AGENTS_MATRIX.length, 4);

  // Tầng 1: Scope Decomposer Agent
  const decomposed = runScopeDecomposerAgent('Làm web bán hàng đẹp, mượt');
  assert.equal(decomposed.deterministicItems.length, 4);
  assert.equal(decomposed.subjectiveItems.length, 2);
  assert.match(decomposed.checklistHash, /^sha256:/);

  // Tầng 2 & 3: Autonomous Verifier & Technical Assessor (PASS_100)
  const passReport = runAutonomousVerificationAndAssessor({ commitHash: 'commit#9f8c2a1' }, 'PASS_100');
  assert.equal(passReport.allObjectivePassed, true);
  assert.equal(passReport.passRatePercent, 100);
  assert.equal(passReport.recommendation.decision, 'RECOMMEND_RELEASE');
  assert.match(passReport.proofRegistryOnChainTx, /^ProofRegistry::record/);

  // Tầng 2 & 3: Autonomous Verifier & Technical Assessor (FAIL_PAYMENT_500)
  const failReport = runAutonomousVerificationAndAssessor({ commitHash: 'commit#9f8c2a1' }, 'FAIL_PAYMENT_500');
  assert.equal(failReport.allObjectivePassed, false);
  assert.equal(failReport.recommendation.decision, 'REQUEST_FIX');
  assert.match(failReport.recommendation.message, /\/api\/payment bị lỗi 500 khi test với input âm/);

  // Tầng 4: Autonomous Fact-finding Bailiff Agent
  const state = createInitialEscrowState();
  const disputed = state.contracts.find((c) => c.id === 'ESC-103');
  const dossier = runFactFindingBailiffAgent(disputed);
  assert.equal(dossier.verifiedCompletionPercent, 70);
  assert.equal(dossier.recommendedSellerPercent, 70);
  assert.equal(dossier.recommendedBuyerPercent, 30);
  assert.match(dossier.proposalStatement, /70% cho Freelancer và hoàn trả 30% cho Client/);
});

test('7. Tính năng Yêu cầu Chỉnh sửa (Custom Revision Input) & Kiểm tra Bắt buộc File Bằng chứng', () => {
  const state = createInitialEscrowState();
  const cId = 'ESC-101';

  // Yêu cầu sửa có phần nhập thêm yêu cầu nếu có
  const customReason = 'Bổ sung unit test cho endpoint /api/payment và sửa lỗi mã 500 khi input âm';
  const revRes = requestContractRevision(state, cId, customReason);
  assert.equal(revRes.ok, true);
  assert.equal(revRes.contract.status, 'REVISION_REQUESTED');
  assert.equal(revRes.contract.clientRevisionComment, customReason);
  assert.match(revRes.contract.failedStepText, /Bổ sung unit test cho endpoint \/api\/payment/);

  // Kiểm tra nộp bằng chứng khi có file
  const evRes = submitDisputeEvidence(state, 'ESC-103', 'CLIENT', 'Log lỗi', {
    fileName: 'test-evidence.log',
    fileSizeKb: 50,
    fileType: 'text/plain',
    dataUrl: 'data:text/plain;base64,VGVzdCBldmlkZW5jZSBjb250ZW50'
  });
  assert.equal(evRes.ok, true);
  assert.equal(evRes.entry.fileName, 'test-evidence.log');
  assert.equal(evRes.entry.dataUrl, 'data:text/plain;base64,VGVzdCBldmlkZW5jZSBjb250ZW50');

  // Arbiter có thể lưu file bằng chứng về máy
  const dlRes = downloadEvidenceFile(evRes.entry);
  assert.equal(dlRes.ok, true);
  assert.equal(dlRes.downloaded, true);
  assert.equal(dlRes.fileName, 'test-evidence.log');

  // Kiểm tra lưu file bằng chứng mẫu có sẵn trong hợp đồng tranh chấp
  const presetEv = state.contracts.find((c) => c.id === 'ESC-103').evidences[1];
  const dlPresetRes = downloadEvidenceFile(presetEv);
  assert.equal(dlPresetRes.ok, true);
  assert.equal(dlPresetRes.downloaded, true);
});

test('8. Agent kiểm tra định dạng link GitHub chuẩn & Tên hợp đồng có ý nghĩa (chặn ký hiệu linh tinh)', () => {
  // 1. Kiểm tra định dạng link GitHub
  assert.equal(isValidGitHubUrl('https://github.com/vibecode/app/pull/42'), true);
  assert.equal(isValidGitHubUrl('https://github.com/facebook/react'), true);
  assert.equal(isValidGitHubUrl('http://github.com/user/project/commit/9f8c2a1'), true);

  // Link không phải GitHub chuẩn
  assert.equal(isValidGitHubUrl('https://gitlab.com/vibecode/app'), false);
  assert.equal(isValidGitHubUrl('https://google.com'), false);
  assert.equal(isValidGitHubUrl('https://preview.vercel.app'), false);
  assert.equal(isValidGitHubUrl('not-a-link'), false);
  assert.equal(isValidGitHubUrl(''), false);

  // 2. Agent Tầng 2 & 3 xử lý khi Freelancer nộp link không phải GitHub
  const invalidUrlReport = runAutonomousVerificationAndAssessor({
    deliverableUrl: 'https://preview.vercel.app/demo',
    commitHash: 'commit#9f8c2a1'
  }, 'PASS_100');
  assert.equal(invalidUrlReport.isGitHubValid, false);
  assert.equal(invalidUrlReport.allObjectivePassed, false);
  assert.equal(invalidUrlReport.toolchainSteps[0].status, 'FAILED');
  assert.match(invalidUrlReport.toolchainSteps[0].log, /LỖI ĐỊNH DẠNG/);
  assert.equal(invalidUrlReport.toolchainSteps[1].status, 'SKIPPED');
  assert.equal(invalidUrlReport.recommendation.decision, 'REQUEST_FIX');
  assert.match(invalidUrlReport.recommendation.message, /không phải là link chuẩn của GitHub/);

  // 3. Kiểm tra Tên hợp đồng phải có ý nghĩa, không là ký hiệu linh tinh
  // Các chuỗi ký hiệu linh tinh / vô nghĩa phải bị chặn
  const badTitles = [
    '!@#$%^&*',
    '------',
    '12345678',
    'aaaaaa',
    'asdfghjk',
    'qwertyuiop',
    '......'
  ];
  for (const bad of badTitles) {
    const res = validateContractTitle(bad);
    assert.equal(res.valid, false, `Tiêu đề "${bad}" phải bị chặn`);
    assert.ok(res.error.length > 0);
  }

  // Các tên hợp đồng có ý nghĩa phải được chấp nhận
  const goodTitles = [
    'Phát triển API thanh toán VietQR & Cổng Escrow',
    'Thiết kế giao diện White UI Design Tokens',
    'Tối ưu hóa Vercel Edge Functions và Cache',
    'Xây dựng ứng dụng di động React Native'
  ];
  for (const good of goodTitles) {
    const res = validateContractTitle(good);
    assert.equal(res.valid, true, `Tiêu đề "${good}" phải hợp lệ`);
  }
});

test('9. Hệ thống nạp tiền VietQR (MB - NGUYEN VAN A 0000000000) & Quy trình Arbiter phê duyệt mới vào hệ thống', () => {
  const state = createInitialEscrowState();
  const initialBalance = state.clientBalance;

  // 1. Client tạo lệnh nạp 2.000.000 VNĐ qua VietQR
  const topupRes = submitClientTopup(state, {
    accountNumber: '19036888999012 - Techcombank (Client Corp)',
    amount: 2000000,
    method: 'VietQR Pro 24/7 (MB - NGUYEN VAN A)'
  });

  assert.equal(topupRes.ok, true);
  assert.equal(topupRes.entry.amount, 2000000);
  assert.equal(topupRes.entry.status, 'PENDING_APPROVAL');
  assert.equal(topupRes.entry.receiverAccount, '0000000000');
  assert.equal(topupRes.entry.receiverName, 'NGUYEN VAN A');
  assert.equal(topupRes.entry.receiverBank, 'MB (Ngân hàng TMCP Quân Đội)');

  // Tiền CHƯA được nạp vào ví ngay lập tức
  assert.equal(state.clientBalance, initialBalance, 'Tiền không được nạp vào ví trước khi Arbiter duyệt');

  // 2. Trọng tài (Arbiter) xác nhận biến động số dư thành công
  const approveRes = approveTopupByArbiter(state, topupRes.entry.id);
  assert.equal(approveRes.ok, true);
  assert.equal(approveRes.entry.status, 'APPROVED');

  // Sau khi Arbiter duyệt, tiền ĐÃ ĐƯỢC nạp vào ví Client
  assert.equal(state.clientBalance, initialBalance + 2000000, 'Tiền đã được ghi có vào Segregated Vault của Client');

  // 3. Kiểm tra nhật ký Ledger có ghi nhận sự kiện Arbiter phê duyệt
  const latestTx = state.ledger[0];
  assert.equal(latestTx.role, 'ARBITER');
  assert.match(latestTx.type, /Xác nhận Nạp Quỹ/);
  assert.match(latestTx.detail, /0000000000/);

  // 4. Kiểm tra từ chối lệnh nạp tiền
  const secondTopup = submitClientTopup(state, {
    accountNumber: '999999999 - Fake Account',
    amount: 500000,
    method: 'VietQR Pro 24/7'
  });
  const balanceBeforeReject = state.clientBalance;
  const rejectRes = rejectTopupByArbiter(state, secondTopup.entry.id, 'Không nhận được tiền');
  assert.equal(rejectRes.ok, true);
  assert.equal(rejectRes.entry.status, 'REJECTED');
  assert.equal(state.clientBalance, balanceBeforeReject, 'Số dư không đổi khi lệnh bị từ chối');
});

test('10. Giảm thiểu 5 Rủi ro: Circuit Breaker, AML/KYC phân tầng, Scope Creep Detection, Sandbox Cache & Onboarding Non-tech', () => {
  const html = fs.readFileSync(path.join(ROOT_DIR, 'src/index.html'), 'utf8');
  assert.match(html, /id="non-tech-onboarding-strip"/);
  assert.match(html, /id="btn-arbiter-circuit-breaker"/);

  // 1. Circuit Breaker chặn giải ngân khi tạm dừng
  const state = createInitialEscrowState();
  toggleVaultCircuitBreaker(state, true, 'Kiểm tra bảo mật');
  assert.equal(state.vaultPaused, true);
  const blockedRelease = releasePartialMilestone(state, 'ESC-101', 50);
  assert.equal(blockedRelease.ok, false);
  assert.match(blockedRelease.error, /Circuit Breaker/);

  toggleVaultCircuitBreaker(state, false);
  const allowedRelease = releasePartialMilestone(state, 'ESC-101', 50);
  assert.equal(allowedRelease.ok, true);

  // 2. AML/KYC phân tầng theo hạn mức
  const tier1 = evaluateAmlKycTier(5000000);
  assert.equal(tier1.tier, 'TIER_1_BASIC');
  const tier2 = evaluateAmlKycTier(25000000);
  assert.equal(tier2.tier, 'TIER_2_ENHANCED_KYC');
  assert.equal(tier2.requiresEnhancedReview, true);

  // 3. Phát hiện Scope Creep khi yêu cầu chỉnh sửa
  const creep = detectScopeCreepRisk('Hãy thêm tính năng multi-region failover');
  assert.equal(creep.hasScopeCreepRisk, true);
  const revRes = requestContractRevision(state, 'ESC-102', 'Hãy thêm tính năng multi-region failover');
  assert.equal(revRes.ok, true);
  assert.ok(revRes.contract.scopeCreepWarning);

  // 4. Sandbox Verification Cache theo commitHash giảm độ trễ & chi phí
  const sub = { deliverableUrl: 'https://github.com/vibecode/cache-test/pull/7', commitHash: 'commit#cache777' };
  const firstRun = runAutonomousVerificationAndAssessor(sub, 'PASS_100');
  assert.equal(firstRun.cacheHit, false);
  const secondRun = runAutonomousVerificationAndAssessor(sub, 'PASS_100');
  assert.equal(secondRun.cacheHit, true);
  assert.equal(secondRun.executionMs, 2);
});
