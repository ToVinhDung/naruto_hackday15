import { createBankDashboard } from './bank-ui.js';

/**
 * VibeEscrow Smart Custody & Dynamic API Controller (src/app.js)
 * - Kết nối API động (/api/state, /api/agents/scope-decompose, /api/agents/verify-assess, /api/agents/fact-finding)
 * - Không hiển thị chi tiết các tầng AI Agent ở các vùng làm việc; chỉ khi bấm nút "🤖 AI Agents (4 Tầng)" cạnh Guardrails trên thanh bar mới hiện 4 tầng.
 * - Khi chạy giao dịch trong các vùng: chỉ khi KHÔNG PASS ở bước nào thì mới hiện Thông báo và Khuyến nghị của Agent.
 * - Giao diện tối giản, loại bỏ toàn bộ ghi chú hướng dẫn thừa.
 */

import {
  ESCROW_AGENTS_MATRIX,
  runScopeDecomposerAgent,
  runAutonomousVerificationAndAssessor,
  runFactFindingBailiffAgent,
  isValidGitHubUrl,
  validateContractTitle,
  detectScopeCreepRisk,
  buildConsistentAgentRecommendation
} from './agents.js';
import { countValidSignatures, assertMultiSig2Of3 } from './engine/multiSigGuard.mjs';

export {
  ESCROW_AGENTS_MATRIX,
  runScopeDecomposerAgent,
  runAutonomousVerificationAndAssessor,
  runFactFindingBailiffAgent,
  isValidGitHubUrl,
  validateContractTitle,
  detectScopeCreepRisk,
  buildConsistentAgentRecommendation,
  countValidSignatures,
  assertMultiSig2Of3
};

/**
 * Escape HTML để chống XSS khi render dữ liệu người dùng vào innerHTML.
 */
export function escapeHtml(str) {
  return String(str ?? '').replace(/[&<>"'`]/g, (c) => ({
    '&': '&amp;',
    '<': '&lt;',
    '>': '&gt;',
    '"': '&quot;',
    "'": '&#39;',
    '`': '&#96;'
  }[c]));
}

/**
 * Xác thực Trọng tài (Arbiter) qua Header Token trên Server (POST /api/auth/arbiter).
 */
export async function verifyArbiterTokenOnServer(token) {
  const cleanToken = String(token || '').trim();
  if (!cleanToken) return { ok: false, error: 'Vui lòng nhập token Trọng tài.' };
  const res = await fetch('/api/auth/arbiter', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-arbiter-token': cleanToken
    }
  });
  if (!res.ok) {
    return { ok: false, error: 'Token Trọng tài không chính xác.' };
  }
  return { ok: true, token: cleanToken };
}

/**
 * Helper gọi REST API động (kèm fallback an toàn khi chạy trong môi trường Node test)
 */
export async function callDynamicApi(endpoint, method = 'GET', payload = null) {
  if (typeof fetch !== 'function') {
    throw new Error('Fetch API unavailable');
  }
  const options = {
    method,
    headers: { 'Content-Type': 'application/json' }
  };
  if (payload && method !== 'GET') {
    options.body = JSON.stringify(payload);
  }
  const res = await fetch(endpoint, options);
  if (!res.ok) {
    throw new Error(`API ${endpoint} trả về mã lỗi ${res.status}`);
  }
  return await res.json();
}

export const ARCHITECTURE_NODES = {
  steering: {
    id: 'steering',
    title: '1. Input & Steering Layer (Tầng định hướng)',
    tag: '.antigravity/system_prompt.md',
    summary: 'Quy định phong cách code, White Tone UI Design System (#FFFFFF), Context Anchors và Guardrails trước khi sinh code.',
    files: ['.antigravity/system_prompt.md', '.antigravity/config.json', 'docs/architecture.md'],
    snippet: `// Context Anchors tự động nạp vào Context Window:
{
  "uiTheme": { "mode": "light", "primaryBackground": "#FFFFFF" },
  "contextAnchors": [
    "docs/architecture.md",
    ".antigravity/system_prompt.md",
    ".antigravity/agents.json",
    "vercel.json"
  ]
}`
  },
  engine: {
    id: 'engine',
    title: '2. Google Antigravity Engine & 4 Escrow Agents',
    tag: 'src/agents.js • 4 Tiers',
    summary: 'Kết hợp Planner/Coder Agent với 4 Tầng Escrow AI Agents chạy ngầm qua REST API và chỉ phát cảnh báo khi có bước không pass.',
    files: ['.antigravity/agents.json', 'src/agents.js', 'src/server.mjs'],
    snippet: `// 4 Tầng Agentic AI (Bấm nút "🤖 AI Agents" trên Topbar để xem):
1. ScopeDecomposerAgent     -> POST /api/agents/scope-decompose
2. SandboxVerifierAgent     -> POST /api/agents/verify-assess
3. TechnicalAssessorAgent   -> ProofRegistry On-chain + Recommendation
4. FactFindingBailiffAgent  -> POST /api/agents/fact-finding`
  },
  guardrails: {
    id: 'guardrails',
    title: '3. 🛡️ Tầng Guardrails & Kiểm soát An toàn 5 Lớp (G1–G5)',
    tag: '.antigravity/config.json • G1..G5',
    summary: 'Rào chắn bảo vệ đa tầng bắt buộc kiểm duyệt mọi thao tác của Agent và người dùng trước khi thực thi Terminal hoặc giải ngân Quỹ Escrow.',
    files: ['.antigravity/config.json', 'docs/architecture.md', 'src/app.js'],
    snippet: `// Đặc tả 5 Lớp Guardrails trong .antigravity/config.json:
{
  "G1_CommandWhitelist": ["node", "npm.cmd", "pnpm.cmd", "git status", "vercel", "powerbatch.cmd"],
  "G1_BlockedDestructive": ["rm -rf", "format ", "del /f /s /q", "git push --force"],
  "G2_SecretProtectionHITL": [".env", ".env.local", ".env.production", "sk_live_*", "PrivateKey"],
  "G3_GitCheckpointIsolation": "Auto-branch vibe-feature-* trước khi refactor lớn",
  "G4_EscrowFinancialGuardrail": "Min > 10.000đ, Multi-Sig 2-of-3, Freeze Vault khi tranh chấp",
  "G5_SandboxSelfHealQuota": { "timeoutMs": 15000, "maxRetries": 3 }
}`
  },
  powerbatch: {
    id: 'powerbatch',
    title: '4. ⚡ PowerBatch Orchestration Engine',
    tag: '.antigravity/powerbatch.mjs',
    summary: 'Thực thi hàng loạt các bước kiểm tra nguyên tử (Guardrails → White UI Tokens → Unit Tests → Vercel Check) và xuất báo cáo JSON tự chữa lành.',
    files: ['.antigravity/powerbatch.mjs', '.antigravity/test_commands.json', 'powerbatch.cmd'],
    snippet: `// Chạy toàn bộ pipeline kiểm tra nguyên tử:
$ .\\powerbatch.cmd verify
▶ [batch-01-guardrails] Security & Guardrails Audit ... PASSED
▶ [batch-02-white-ui]   White UI Token Verification ... PASSED
▶ [batch-03-unit-tests] Automated Integration Tests ... PASSED
▶ [batch-04-vercel-check] Vercel Deployment Readiness . PASSED`
  },
  sandbox: {
    id: 'sandbox',
    title: '5. Local Execution Sandbox & Self-Healing Loop',
    tag: 'Auto-Patch ≠ 0',
    summary: 'Tự động kích hoạt linter/test sau mỗi batch. Nếu mã thoát ≠ 0, đọc stderr từ powerbatch-report.json để tự động patch code (tối đa 3 lần theo G5).',
    files: ['tests/system.test.mjs', '.antigravity/powerbatch-report.json'],
    snippet: `// Self-Healing Loop tuân thủ Guardrail G5 (maxRetries: 3):
if (batch.status === 'FAILED') {
  return agent.selfHeal({
    stderr: batch.stderr,
    maxRetries: 3,
    checkpointBranch: 'vibe-feature-escrow'
  });
}`
  },
  vercel: {
    id: 'vercel',
    title: '6. ▲ Vercel Cloud Preview & Observability',
    tag: 'vercel.json • Edge',
    summary: 'Kết hợp Hot-reload Local Server (:3000) với Vercel Preview Deployment tự động cho mỗi nhánh vibe-feature-* và đồng bộ Production.',
    files: ['vercel.json', 'src/server.mjs'],
    snippet: `// Cấu hình vercel.json sẵn sàng cho Edge & Preview:
{
  "version": 2,
  "name": "antigravity-vibecode-system",
  "cleanUrls": true,
  "outputDirectory": "src",
  "headers": [{ "key": "X-Antigravity-Engine", "value": "PowerBatch-v1.0" }]
}`
  }
};

export const GUARDRAIL_LAYERS_SPEC = [
  {
    code: 'G1',
    name: 'Terminal Command Whitelist',
    rule: 'Chỉ cho phép thực thi binary an toàn (node, npm.cmd, pnpm.cmd, git status, vercel, powerbatch.cmd); chặn rm -rf, format, git push --force.'
  },
  {
    code: 'G2',
    name: 'Human-in-the-Loop (HITL) cho Secrets',
    rule: 'Cấm tự động đọc/xuất .env*, API keys (sk_live_*, AIza*) hoặc Private Key ra ngoài terminal.'
  },
  {
    code: 'G3',
    name: 'Git Checkpoint & Branch Isolation',
    rule: 'Tự động tạo nhánh vibe-feature-* trước khi refactor lớn; cấm ghi đè trực tiếp nhánh main.'
  },
  {
    code: 'G4',
    name: 'Escrow Financial & Multi-Sig Guardrail',
    rule: 'Ràng buộc giao dịch > 10.000đ & <= 500.000.000đ, bắt buộc 2-of-3 Multi-Sig, băm bất biến SHA-256/IPFS và Freeze Vault khi tranh chấp.'
  },
  {
    code: 'G5',
    name: 'Sandbox Quota & Self-Healing Limit',
    rule: 'Timeout 10s–15s mỗi batch, giới hạn tự động vá lỗi tối đa 3 lần liên tiếp chống lặp vô hạn.'
  }
];

export const POWERBATCH_DEFAULT_BATCHES = [
  {
    id: 'batch-01-guardrails',
    name: 'Security & Guardrails Audit (G1–G5)',
    stage: 'pre-verify',
    command: 'node .antigravity/powerbatch.mjs audit-guardrails',
    status: 'PASSED',
    durationMs: 42
  },
  {
    id: 'batch-02-white-ui',
    name: 'White UI Design Token Verification',
    stage: 'lint',
    command: 'node .antigravity/powerbatch.mjs verify-ui-tokens',
    status: 'PASSED',
    durationMs: 38
  },
  {
    id: 'batch-03-unit-tests',
    name: 'Automated Integration & Architecture Tests',
    stage: 'test',
    command: 'node --test tests/system.test.mjs',
    status: 'PASSED',
    durationMs: 115
  },
  {
    id: 'batch-04-vercel-check',
    name: 'Vercel Deployment & Route Readiness',
    stage: 'deploy-check',
    command: 'node .antigravity/powerbatch.mjs verify-vercel',
    status: 'PASSED',
    durationMs: 35
  }
];

/**
 * Cấu hình 3 Vùng theo từng Vai trò (Không hiện các tầng AI Agent ở tên/mô tả vùng)
 */
export const ROLE_ZONES_CONFIG = {
  client: {
    roleTitle: '👤 CLIENT (BUYER)',
    badgeClass: 'pill-blue',
    zones: [
      {
        id: 'view-client-zone-1',
        shortTitle: 'Hợp đồng',
        title: 'Vùng 1: Quản lý Giao dịch, Nghiệm thu & Smart Vault',
        icon: '📋',
        tag: 'Multi-Sig 2/3',
        desc: 'Theo dõi trạng thái các hợp đồng ký quỹ, giải ngân theo cột mốc hoặc yêu cầu chỉnh sửa.'
      },
      {
        id: 'view-client-zone-2',
        shortTitle: 'Nạp tiền',
        title: 'Vùng 2: Nạp Quỹ Đa Phương thức (> 10.000đ • Fiat & USDC/USDT)',
        icon: '💳',
        tag: 'Fiat + Web3',
        desc: 'Nạp tiền vào Segregated Account qua VietQR 24/7, Thẻ quốc tế hoặc Stablecoin.'
      },
      {
        id: 'view-client-zone-3',
        shortTitle: 'Tạo hợp đồng',
        title: 'Vùng 3: Khởi tạo Hợp đồng, Chia Milestone & Ký kết Số',
        icon: '✍️',
        tag: 'Smart Contract',
        desc: 'Thiết lập điều khoản, chia đợt thanh toán (Milestones) và khóa ngân sách vào Vault.'
      }
    ]
  },
  freelancer: {
    roleTitle: '💻 FREELANCER (SELLER)',
    badgeClass: 'pill-emerald',
    zones: [
      {
        id: 'view-freelancer-zone-1',
        shortTitle: 'Bàn giao',
        title: 'Vùng 1: Nộp Bàn giao Sản phẩm (Git PR / Commit / Figma)',
        icon: '📤',
        tag: 'Proof SHA-256',
        desc: 'Gửi kết quả công việc kèm mã băm SHA-256 bất biến để kích hoạt quy trình nghiệm thu.'
      },
      {
        id: 'view-freelancer-zone-2',
        shortTitle: 'Hợp đồng',
        title: 'Vùng 2: Danh sách Hợp đồng Đảm nhận & Ký Multi-Sig (2-of-3)',
        icon: '📂',
        tag: 'EIP-712 Sign',
        desc: 'Quản lý các hợp đồng đang thực hiện, ký xác nhận điều khoản và theo dõi tiến độ giải ngân.'
      },
      {
        id: 'view-freelancer-zone-3',
        shortTitle: 'Rút tiền',
        title: 'Vùng 3: Rút Thù lao Đa Phương thức (Ngân hàng / Ví USDC-USDT)',
        icon: '🏦',
        tag: 'Instant Payout',
        desc: 'Rút số dư thù lao thực nhận (Net Payout) về tài khoản ngân hàng hoặc ví Web3.'
      }
    ]
  },
  arbiter: {
    roleTitle: '⚖️ ARBITER (TRỌNG TÀI)',
    badgeClass: 'pill-purple',
    zones: [
      {
        id: 'view-arbiter-zone-1',
        shortTitle: 'Tranh chấp',
        title: 'Vùng 1: Phân xử Tranh chấp & Chia Tỷ lệ Quỹ Linh hoạt',
        icon: '⚖️',
        tag: 'Split Settlement',
        desc: 'Xem xét các hợp đồng đang đóng băng và thực thi phán quyết phân chia ngân sách.'
      },
      {
        id: 'view-arbiter-zone-2',
        shortTitle: 'Chứng cứ',
        title: 'Vùng 2: Cổng Thu thập Chứng cứ & Giám sát Giao dịch',
        icon: '📎',
        tag: 'Evidence Portal',
        desc: 'Tiếp nhận file bằng chứng đối chứng từ hai bên và kiểm tra trạng thái toàn sàn.'
      },
      {
        id: 'view-arbiter-zone-3',
        shortTitle: 'Sổ cái & tín nhiệm',
        title: 'Vùng 3: Nhật ký Kiểm toán Bất biến & Điểm Tín nhiệm',
        icon: '🔒',
        tag: 'Immutable Log',
        desc: 'Tra cứu lịch sử sự kiện kèm mã Audit Hash và bảng điểm uy tín của các bên.'
      }
    ]
  }
};

export function formatVND(amount, currency = 'VND') {
  if (currency === 'mock USDC' || currency === 'USDC') {
    return `${Math.round(amount)} mock USDC`;
  }
  return new Intl.NumberFormat('vi-VN').format(Math.round(amount)) + ' ₫';
}

export function computeProofHashAndCid(inputString) {
  const str = String(inputString || 'vibeescrow-proof');
  let h1 = 0xdeadbeef ^ str.length;
  let h2 = 0x41c6ce57 ^ str.length;
  for (let i = 0; i < str.length; i++) {
    const ch = str.charCodeAt(i);
    h1 = Math.imul(h1 ^ ch, 2654435761);
    h2 = Math.imul(h2 ^ ch, 1597334677);
  }
  h1 = Math.imul(h1 ^ (h1 >>> 16), 2246822507) ^ Math.imul(h2 ^ (h2 >>> 13), 3266489909);
  h2 = Math.imul(h2 ^ (h2 >>> 16), 2246822507) ^ Math.imul(h1 ^ (h1 >>> 13), 3266489909);
  const hex1 = (h1 >>> 0).toString(16).padStart(8, '0');
  const hex2 = (h2 >>> 0).toString(16).padStart(8, '0');
  const sha256Short = `sha256:${hex1}${hex2}9a7f3c2b`;
  const ipfsCid = `ipfs://QmVibe${hex1.toUpperCase()}${hex2.toUpperCase()}`;
  return { sha256: sha256Short, ipfsCid, auditHash: `0x${hex1}${hex2}` };
}

export function calculateFeeBreakdown(grossAmount, method = 'VietQR', currency = 'VND', feePayer = 'FREELANCER') {
  const gross = Math.max(0, Math.floor(Number(grossAmount) || 0));
  const isUSDC = currency === 'mock USDC' || /USDC/i.test(method);
  const takeRateFee = Math.round(gross * 0.02);
  let gatewayOrGasFee = 0;
  if (isUSDC) {
    gatewayOrGasFee = gross > 1000 ? 15000 : 0;
  } else {
    const isCard = /Visa|Mastercard/i.test(method);
    gatewayOrGasFee = isCard ? Math.round(gross * 0.01) : 5000;
  }
  const totalFee = takeRateFee + gatewayOrGasFee;
  const payer = String(feePayer || 'FREELANCER').toUpperCase();

  let clientFee = 0;
  let freelancerFee = totalFee;
  if (payer === 'CLIENT') {
    clientFee = totalFee;
    freelancerFee = 0;
  } else if (payer === 'SPLIT') {
    clientFee = Math.floor(totalFee / 2);
    freelancerFee = totalFee - clientFee;
  }

  const clientPays = gross + clientFee;
  const netPayout = Math.max(0, gross - freelancerFee);
  return {
    gross,
    takeRateFee,
    gatewayOrGasFee,
    totalFee,
    feePayer: payer,
    clientFee,
    freelancerFee,
    clientPays,
    netPayout
  };
}

export function buildContractMilestones(totalAmount, count = 2) {
  const n = Number(count ?? 2);
  if (n === 1) {
    return [{ id: 'M1', name: 'M1: Bàn giao toàn bộ & Nghiệm thu (100%)', amount: totalAmount, released: false }];
  }
  if (n === 3) {
    const m1 = Math.round(totalAmount * 0.3);
    const m2 = Math.round(totalAmount * 0.4);
    const m3 = totalAmount - m1 - m2;
    return [
      { id: 'M1', name: 'M1: Khởi tạo & Kiến trúc (30%)', amount: m1, released: false },
      { id: 'M2', name: 'M2: Phát triển Core & Kiểm thử (40%)', amount: m2, released: false },
      { id: 'M3', name: 'M3: Triển khai Vercel Production (30%)', amount: m3, released: false }
    ];
  }
  const m1 = Math.round(totalAmount * 0.4);
  const m2 = totalAmount - m1;
  return [
    { id: 'M1', name: 'M1: Khởi tạo Kiến trúc & Database Schema (40%)', amount: m1, released: false },
    { id: 'M2', name: 'M2: Endpoint API & Xử lý Giao dịch (60%)', amount: m2, released: false }
  ];
}

export function countMultiSignatures(signatures) {
  return countValidSignatures(signatures);
}

export function validateTopupAmount(rawAmount) {
  const numeric = Number(rawAmount);
  if (!Number.isFinite(numeric) || Number.isNaN(numeric)) {
    return { valid: false, amount: 0, error: '[Guardrail G4] Vui lòng nhập số tiền hợp lệ.' };
  }
  if (numeric <= 10000) {
    return {
      valid: false,
      amount: numeric,
      error: '[Guardrail G4] Số tiền giao dịch phải lớn hơn 10.000đ theo quy định an toàn hệ thống.'
    };
  }
  if (numeric > 500000000) {
    return {
      valid: false,
      amount: numeric,
      error: '[Guardrail G4] Số tiền vượt hạn mức tối đa trong một lần giao dịch (500.000.000đ).'
    };
  }
  return {
    valid: true,
    amount: Math.floor(numeric),
    formatted: formatVND(Math.floor(numeric)),
    error: null
  };
}

/**
 * Phân tầng tuân thủ AML/KYC theo hạn mức giao dịch VietQR / Web3.
 */
export function evaluateAmlKycTier(amount) {
  const num = Number(amount) || 0;
  if (num > 20000000) {
    return {
      tier: 'TIER_2_ENHANCED_KYC',
      label: 'KYC Nâng cao (>20tr)',
      requiresEnhancedReview: true
    };
  }
  return {
    tier: 'TIER_1_BASIC',
    label: 'KYC Cơ bản',
    requiresEnhancedReview: false
  };
}

/**
 * Circuit Breaker (Công tắc tạm dừng khẩn cấp Smart Vault) do Arbiter điều khiển.
 */
export function toggleVaultCircuitBreaker(state, paused, reason = 'Kiểm tra bảo mật định kỳ') {
  state.vaultPaused = Boolean(paused);
  const proof = computeProofHashAndCid(`circuit-breaker-${state.vaultPaused}-${Date.now()}`);
  state.ledger.unshift({
    id: `EV-${Math.floor(1000 + Math.random() * 9000)}`,
    time: new Date().toLocaleTimeString('vi-VN'),
    role: 'ARBITER',
    type: state.vaultPaused ? 'Circuit Breaker: TẠM DỪNG VAULT' : 'Circuit Breaker: MỞ LẠI VAULT',
    detail: state.vaultPaused
      ? `Arbiter đã kích hoạt Circuit Breaker tạm khóa giải ngân (${reason}).`
      : 'Arbiter đã tắt Circuit Breaker, Smart Vault hoạt động bình thường.',
    amount: 0,
    auditHash: proof.auditHash
  });
  return { ok: true, vaultPaused: state.vaultPaused };
}

/**
 * Gửi yêu cầu Nạp tiền qua mã VietQR của Hệ thống.
 * Tiền sẽ KHÔNG vào ví ngay, mà ở trạng thái PENDING_APPROVAL chờ Arbiter đối soát biến động số dư.
 */
export function submitClientTopup(state, { accountNumber, amount, method, topupId: providedTopupId }) {
  const validation = validateTopupAmount(amount);
  if (!validation.valid) {
    return { ok: false, error: validation.error };
  }
  const kycInfo = evaluateAmlKycTier(validation.amount);
  const isVietQR = /VietQR/i.test(method || '');
  const gatewayFee = isVietQR ? 0 : 15000;
  const netCredited = validation.amount - gatewayFee;
  const uniqueCode =
    providedTopupId ||
    (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function'
      ? `TOPUP-${crypto.randomUUID().slice(0, 8).toUpperCase()}`
      : `TOPUP-${Math.random().toString(16).slice(2, 10).toUpperCase()}`);
  const topupId = uniqueCode;
  const memo = `NAP ESCROW ${topupId}`;

  const entry = {
    id: topupId,
    time: new Date().toLocaleTimeString('vi-VN'),
    date: new Date().toISOString(),
    clientAccount: accountNumber || '19036888999012 - Techcombank (Client Corp)',
    amount: validation.amount,
    formatted: validation.formatted,
    gatewayFee,
    netCredited,
    kycTier: kycInfo.tier,
    kycLabel: kycInfo.label,
    method: method || 'VietQR Pro 24/7 (MB - NGUYEN VAN A)',
    memo,
    status: 'PENDING_APPROVAL',
    receiverBank: 'MB (Ngân hàng TMCP Quân Đội)',
    receiverName: 'NGUYEN VAN A',
    receiverAccount: '0000000000',
    qrImage: './vietqr.jpg'
  };

  if (!Array.isArray(state.pendingTopups)) {
    state.pendingTopups = [];
  }
  state.pendingTopups.unshift(entry);

  const proof = computeProofHashAndCid(`topup-req-${entry.id}-${entry.amount}`);
  state.ledger.unshift({
    id: `EV-${Math.floor(1000 + Math.random() * 9000)}`,
    time: entry.time,
    role: 'CLIENT',
    type: 'Lệnh Nạp Quỹ VietQR (Chờ Arbiter Duyệt)',
    detail: `Tạo lệnh nạp [${topupId}] ${validation.formatted} vào QR MB 0000000000 (Nội dung: ${memo}). Chờ Arbiter đối soát.`,
    amount: validation.amount,
    auditHash: proof.auditHash
  });

  return { ok: true, entry };
}

/**
 * Trọng tài (Arbiter) xác nhận biến động số dư thành công từ mã VietQR MB.
 * Tiền được chính thức ghi có vào Segregated Vault của Client.
 */
export function approveTopupByArbiter(state, topupId) {
  if (!Array.isArray(state.pendingTopups)) return { ok: false, error: 'Không tìm thấy danh sách lệnh nạp tiền.' };
  const entry = state.pendingTopups.find((t) => t.id === topupId);
  if (!entry) return { ok: false, error: `Không tìm thấy lệnh nạp tiền ${topupId}.` };
  if (entry.status !== 'PENDING_APPROVAL') {
    return { ok: false, error: `Lệnh ${topupId} đã được xử lý trước đó (${entry.status}).` };
  }

  entry.status = 'APPROVED';
  entry.approvedTime = new Date().toLocaleTimeString('vi-VN');
  state.clientBalance += entry.netCredited;
  state.platformFeesCollected += entry.gatewayFee;

  const proof = computeProofHashAndCid(`topup-approved-${entry.id}-${entry.amount}`);
  state.ledger.unshift({
    id: `EV-${Math.floor(1000 + Math.random() * 9000)}`,
    time: entry.approvedTime,
    role: 'ARBITER',
    type: 'Xác nhận Nạp Quỹ VietQR Thành công',
    detail: `Arbiter xác nhận đã nhận ${formatVND(entry.amount)} từ STK [${entry.clientAccount}] qua VietQR MB 0000000000. Đã ghi có ${formatVND(entry.netCredited)} vào Segregated Vault cho Client.`,
    amount: entry.netCredited,
    auditHash: proof.auditHash
  });

  return { ok: true, entry };
}

/**
 * Trọng tài (Arbiter) từ chối lệnh nạp tiền (do chưa nhận được tiền hoặc thông tin sai).
 */
export function rejectTopupByArbiter(state, topupId, reason = 'Không nhận được tiền biến động số dư hoặc thông tin sai lệch') {
  if (!Array.isArray(state.pendingTopups)) return { ok: false, error: 'Không tìm thấy danh sách lệnh nạp tiền.' };
  const entry = state.pendingTopups.find((t) => t.id === topupId);
  if (!entry) return { ok: false, error: `Không tìm thấy lệnh nạp tiền ${topupId}.` };
  if (entry.status !== 'PENDING_APPROVAL') {
    return { ok: false, error: `Lệnh ${topupId} đã được xử lý trước đó (${entry.status}).` };
  }

  entry.status = 'REJECTED';
  entry.rejectedTime = new Date().toLocaleTimeString('vi-VN');
  entry.rejectReason = reason;

  const proof = computeProofHashAndCid(`topup-rejected-${entry.id}`);
  state.ledger.unshift({
    id: `EV-${Math.floor(1000 + Math.random() * 9000)}`,
    time: entry.rejectedTime,
    role: 'ARBITER',
    type: 'Từ chối Lệnh Nạp Quỹ VietQR',
    detail: `Arbiter từ chối lệnh nạp [${topupId}] (${formatVND(entry.amount)}): ${reason}`,
    amount: entry.amount,
    auditHash: proof.auditHash
  });

  return { ok: true, entry };
}

export function evaluateGuardrailCommand(commandString) {
  const cmd = (commandString || '').trim();
  if (!cmd) {
    return { allowed: false, reason: 'Lệnh rỗng.' };
  }

  // Chặn triệt để toán tử nối chuỗi / subshell / thực thi ngầm / lệnh nguy hiểm
  const dangerousOperators = [
    { pattern: /&&|\|\||;|\||`|\$\(/, reason: '[Guardrail G1] Chặn toán tử nối chuỗi hoặc subshell (&&, ||, ;, |, `, $()).' },
    { pattern: /\bnode\s+(-e|--eval)\b/i, reason: '[Guardrail G1] Chặn thực thi mã inline qua node -e.' },
    { pattern: /\b(curl|wget)\b/i, reason: '[Guardrail G1] Chặn tải hoặc gửi dữ liệu mạng ngoài qua curl/wget.' },
    { pattern: /(^|\s)rm(\s|$)/i, reason: '[Guardrail G1] Chặn lệnh xóa tệp hệ thống (rm).' },
    { pattern: /\bvercel\s+--prod\b/i, reason: '[Guardrail G3] Chặn deploy thẳng lên production (vercel --prod).' },
    { pattern: /format\s+[a-z]:/i, reason: '[Guardrail G1] Chặn lệnh format ổ đĩa hệ thống.' },
    { pattern: /git\s+push\s+(--force|-f)/i, reason: '[Guardrail G3] Chặn force push gây mất lịch sử nhánh chính.' },
    { pattern: /(cat|type|Get-Content)\s+.*\.env/i, reason: '[Guardrail G2] Vi phạm HITL Secret Rule: Cấm tự động đọc/xuất file .env ra terminal.' }
  ];

  for (const rule of dangerousOperators) {
    if (rule.pattern.test(cmd)) {
      return {
        allowed: false,
        status: 'BLOCKED_BY_GUARDRAIL',
        reason: rule.reason
      };
    }
  }

  // Ép buộc lệnh cài đặt gói trong sandbox phải có cờ --ignore-scripts
  if (/^(npm|pnpm|yarn)\s+(install|i|add)\b/i.test(cmd) && !/--ignore-scripts\b/i.test(cmd)) {
    return {
      allowed: false,
      status: 'BLOCKED_BY_GUARDRAIL',
      reason: '[Guardrail G2] Lệnh cài đặt gói trong Sandbox bắt buộc phải kèm cờ --ignore-scripts.'
    };
  }

  const whitelistPrefixes = ['node', 'npm', 'npm.cmd', 'pnpm', 'git status', 'git checkout -b vibe-feature-', 'vercel', 'powerbatch', '.\\powerbatch.cmd'];
  const matchesWhitelist = whitelistPrefixes.some((prefix) => cmd.toLowerCase().startsWith(prefix.toLowerCase()));

  if (!matchesWhitelist) {
    return {
      allowed: false,
      status: 'NOT_IN_WHITELIST',
      reason: `[Guardrail G1] Binary đầu tiên không nằm trong Terminal Command Whitelist (${whitelistPrefixes.join(', ')}).`
    };
  }

  return {
    allowed: true,
    status: 'ALLOWED',
    reason: '[Guardrail G1–G5 Passed] Lệnh hợp lệ và nằm trong vùng an toàn (Sandbox Whitelist).'
  };
}

export function createInitialEscrowState() {
  return {
    vaultPaused: false,
    clientBalance: 15000000,
    freelancerBalance: 8450000,
    platformFeesCollected: 320000,
    pendingTopups: [
      {
        id: 'TOPUP-101',
        time: '14:20:15',
        clientAccount: '19036888999012 - Techcombank (Client Corp)',
        amount: 1000000,
        formatted: '1.000.000 ₫',
        gatewayFee: 0,
        netCredited: 1000000,
        method: 'VietQR Pro 24/7 (MB - NGUYEN VAN A)',
        memo: 'NAP ESCROW TOPUP-101',
        status: 'PENDING_APPROVAL',
        receiverBank: 'MB (Ngân hàng TMCP Quân Đội)',
        receiverName: 'NGUYEN VAN A',
        receiverAccount: '0000000000',
        qrImage: './vietqr.jpg'
      }
    ],
    reputation: {
      client: {
        name: 'Client Corp (Buyer)',
        role: 'BUYER / CLIENT',
        score: 98,
        onTimeRate: '99.2%',
        totalVolume: 48500000,
        disputesCount: 1,
        rating: '4.9 ★'
      },
      freelancer: {
        name: 'Liên minh Freelancer (Seller)',
        role: 'SELLER / FREELANCER',
        score: 96,
        onTimeRate: '97.5%',
        totalVolume: 36200000,
        disputesCount: 1,
        rating: '4.8 ★'
      },
      arbiter: {
        name: 'Hội đồng Trọng tài VibeDAO',
        role: 'ESCROW ARBITRATOR',
        score: 100,
        onTimeRate: '100% SLA',
        totalVolume: 84700000,
        disputesCount: 14,
        rating: '5.0 ★'
      }
    },
    contracts: [
      {
        id: 'ESC-101',
        title: 'Thiết kế Hệ thống Giao diện Trắng (White UI Kit)',
        freelancer: 'Lan Anh (Product Designer)',
        amount: 4000000,
        releasedSoFar: 0,
        status: 'SUBMITTED',
        vaultAddress: '0xVault101...A9F2',
        acceptanceCriteria: 'Coverage > 80%, API < 200ms, Xuất đủ 5 màn hình Figma chuẩn #FFFFFF',
        signatureScheme: 'EIP-712 Wallet Sig (0x8b31...e42a)',
        signatures: { client: true, freelancer: true, arbiter: false },
        milestones: buildContractMilestones(4000000, 2),
        inspectionDays: 3,
        timelockRemaining: 'Còn 2 ngày 14 giờ (Auto-Release)',
        revisionsUsed: 0,
        maxRevisions: 3,
        deliverableUrl: 'https://white-ui-kit-preview.vercel.app',
        commitHash: 'commit#7a4f992',
        deliverableNote: 'Đã bàn giao đầy đủ 5 màn hình Figma + CSS Variables chuẩn #FFFFFF.',
        proofHash: 'sha256:9f4d2c1b8a7e3f609a7f3c2b',
        ipfsCid: 'ipfs://QmVibe9F4D2C1B8A7E3F60',
        ciVerified: true,
        failedStepText: null,
        aiRecommendation: null,
        vaultFrozen: false,
        disputeReason: null,
        evidences: [
          {
            actor: 'FREELANCER (Seller)',
            fileName: 'white-ui-design-tokens.pdf',
            fileSizeKb: 420,
            fileType: 'application/pdf',
            content: 'Tài liệu đặc tả bảng màu Pure White #FFFFFF và bộ 5 màn hình Figma.',
            hash: 'sha256:8a1f90c2',
            ipfsCid: 'ipfs://QmVibePDF8A1F',
            time: '23:12:40'
          }
        ]
      },
      {
        id: 'ESC-102',
        title: 'Xây dựng API Cổng Thanh toán Đa Tiền tệ (Fiat & USDC)',
        freelancer: 'Minh Tuấn (Fullstack Dev)',
        amount: 4000000,
        releasedSoFar: 0,
        status: 'IN_PROGRESS',
        vaultAddress: '0xVault102...C4B8',
        acceptanceCriteria: 'Hỗ trợ VietQR + USDC, Multi-Sig 2-of-3, Unit Test > 80%',
        signatureScheme: 'DocuSign / OTP e-Sign (#DS-99201)',
        signatures: { client: true, freelancer: false, arbiter: false },
        milestones: buildContractMilestones(4000000, 2),
        inspectionDays: 5,
        timelockRemaining: 'Chờ Seller nộp bàn giao',
        revisionsUsed: 1,
        maxRevisions: 3,
        deliverableUrl: '',
        commitHash: '',
        deliverableNote: '',
        proofHash: '',
        ipfsCid: '',
        ciVerified: true,
        failedStepText: null,
        aiRecommendation: null,
        vaultFrozen: false,
        disputeReason: null,
        evidences: []
      },
      {
        id: 'ESC-103',
        title: 'Tối ưu Tốc độ Edge & Tích hợp Bot Tự động',
        freelancer: 'Hoàng Nam (AI Engineer)',
        amount: 3000000,
        releasedSoFar: 0,
        status: 'DISPUTED',
        vaultAddress: '0xVault103...F7D1',
        acceptanceCriteria: 'p95 Latency < 200ms trên Vercel Edge, 0 lỗi runtime',
        signatureScheme: 'EIP-712 Wallet Sig (0x4c90...11d8)',
        signatures: { client: false, freelancer: true, arbiter: true },
        milestones: buildContractMilestones(3000000, 3),
        inspectionDays: 3,
        timelockRemaining: '❄️ ĐÓNG BĂNG TIMELOCK (G4)',
        revisionsUsed: 2,
        maxRevisions: 2,
        deliverableUrl: 'https://edge-bot-demo.vercel.app',
        commitHash: 'commit#3e1b804',
        deliverableNote: 'Đã hoàn thành tối ưu p95 = 165ms trên môi trường staging.',
        proofHash: 'sha256:3e1b804d7c2a19049a7f3c2b',
        ipfsCid: 'ipfs://QmVibe3E1B804D7C2A1904',
        ciVerified: false,
        latestVerification: {
          verifiedScore: 70,
          passedCriteria: ['UI Kit', 'DB Schema', 'Staging Latency p95=165ms'],
          failedCriteria: ['Stress Test tải đột biến 10.000 req/s'],
          isEmptyOrInvalid: false
        },
        recommendedSellerPercent: 70,
        recommendedBuyerPercent: 30,
        failedStepText: 'Không đạt bài Stress Test tải đột biến 10.000 req/s (hoàn thành 70% tiêu chí khách quan).',
        aiRecommendation: 'Freelancer đã hoàn thành 70% khối lượng công việc được kiểm chứng; đề xuất giải ngân 70% cho Freelancer và hoàn trả 30% cho Client.',
        vaultFrozen: true,
        disputeReason: 'Buyer phản hồi cần kiểm tra thêm tải cao; Seller khẳng định đã đạt SLA.',
        evidences: [
          {
            actor: 'CLIENT (Buyer)',
            fileName: 'stress-test-report-21h.log',
            fileSizeKb: 128,
            fileType: 'text/plain',
            content: 'Báo cáo đo tải lúc 21:00 ghi nhận 1 số request đạt 240ms.',
            hash: 'sha256:client_ev_01',
            ipfsCid: 'ipfs://QmVibeClientLog01',
            time: '23:14:00'
          },
          {
            actor: 'FREELANCER (Seller)',
            fileName: 'vercel-edge-benchmark-sin1.png',
            fileSizeKb: 315,
            fileType: 'image/png',
            content: 'Ảnh chụp & Log Vercel Edge Region sin1 chứng minh trung bình p95 = 165ms (< 200ms).',
            hash: 'sha256:seller_ev_02',
            ipfsCid: 'ipfs://QmVibeSellerImg02',
            time: '23:16:30'
          }
        ]
      }
    ],
    ledger: [
      {
        id: 'EV-9007',
        contractId: 'ESC-103',
        time: '23:18:00',
        role: 'ARBITER',
        type: 'Tổng hợp Hồ sơ Tranh chấp',
        detail: 'Hợp đồng ESC-103 đạt 70% tiêu chí kiểm chứng -> Khuyến nghị chia 70% Seller / 30% Buyer',
        amount: 3000000,
        auditHash: '0x99a2d104'
      },
      {
        id: 'EV-9006',
        time: '23:16:30',
        role: 'FREELANCER',
        type: 'Tải File Bằng chứng (Evidence)',
        detail: 'Đính kèm file vercel-edge-benchmark-sin1.png cho ESC-103 (Gửi tới Arbiter)',
        amount: 3000000,
        auditHash: '0x88f1c209'
      },
      {
        id: 'EV-9005',
        time: '23:15:10',
        role: 'CLIENT',
        type: 'Đóng băng & Mở Tranh chấp',
        detail: 'Kích hoạt Freeze Vault hợp đồng ESC-103, chuyển quyền sang Arbiter',
        amount: 3000000,
        auditHash: '0x71a4e812'
      },
      {
        id: 'EV-9004',
        time: '23:12:40',
        role: 'FREELANCER',
        type: 'Nộp Bàn giao & Xác thực Proof',
        detail: 'Bàn giao ESC-101 vượt qua toàn bộ kiểm thử tự động',
        amount: 4000000,
        auditHash: '0x9f4d2c1b'
      }
    ]
  };
}

export function requestContractRevision(state, contractId, reason) {
  const contract = state.contracts.find((c) => c.id === contractId);
  if (!contract) return { ok: false, error: 'Không tìm thấy hợp đồng.' };
  if (contract.revisionsUsed >= contract.maxRevisions) {
    return {
      ok: false,
      error: `Đã hết lượt yêu cầu chỉnh sửa (${contract.revisionsUsed}/${contract.maxRevisions}). Vui lòng nghiệm thu hoặc mở tranh chấp.`
    };
  }
  const comment = (reason || '').trim() || 'Cần bổ sung tiêu chí DoD và cập nhật mã nguồn theo yêu cầu';
  const scopeCheck = detectScopeCreepRisk(comment, contract.acceptanceCriteria || '');
  contract.revisionsUsed += 1;
  contract.status = 'REVISION_REQUESTED';
  contract.ciVerified = false;
  contract.clientRevisionComment = comment;
  contract.scopeCreepWarning = scopeCheck.hasScopeCreepRisk ? scopeCheck.warningMessage : null;
  contract.failedStepText = `Client yêu cầu chỉnh sửa (Lần ${contract.revisionsUsed}/${contract.maxRevisions}): "${comment}"`;
  contract.aiRecommendation = scopeCheck.hasScopeCreepRisk
    ? `${scopeCheck.warningMessage} Khuyến nghị Seller đối chiếu phạm vi gốc trước khi thực hiện.`
    : `Khuyến nghị Seller cập nhật theo yêu cầu của Client: "${comment}" và nộp lại commit mới.`;
  const proof = computeProofHashAndCid(`${contractId}-rev-${contract.revisionsUsed}-${comment}`);
  state.ledger.unshift({
    id: `EV-${Math.floor(1000 + Math.random() * 9000)}`,
    contractId: contract.id,
    time: new Date().toLocaleTimeString('vi-VN'),
    role: 'CLIENT',
    type: `Yêu cầu Chỉnh sửa (${contract.revisionsUsed}/${contract.maxRevisions})`,
    detail: `[${contract.id}] Mô tả yêu cầu sửa: "${comment}"${scopeCheck.hasScopeCreepRisk ? ' [Cảnh báo Scope Creep]' : ''}`,
    amount: contract.amount,
    auditHash: proof.auditHash
  });
  return { ok: true, contract, scopeCreepRisk: scopeCheck };
}

export function releasePartialMilestone(state, contractId, percent = 50) {
  if (state.vaultPaused) {
    return { ok: false, error: '⚠️ Circuit Breaker đang bật: Tạm dừng giải ngân Smart Vault để kiểm tra an toàn.' };
  }
  const contract = state.contracts.find((c) => c.id === contractId);
  if (!contract) return { ok: false, error: 'Không tìm thấy hợp đồng.' };
  const sigCheck = assertMultiSig2Of3(contract, 'RELEASE');
  if (!sigCheck.ok) {
    return { ok: false, error: sigCheck.error };
  }

  const requestedPct = Number(percent ?? 50);
  const firstPending = (contract.milestones || []).find((m) => !m.released);
  let grossRelease;
  if (requestedPct >= 100) {
    grossRelease = contract.amount;
  } else if (firstPending && firstPending.amount > 0 && firstPending.amount <= contract.amount) {
    grossRelease = firstPending.amount;
  } else {
    const pct = Math.min(100, Math.max(0, requestedPct));
    grossRelease = Math.round(contract.amount * (pct / 100));
  }

  if (grossRelease <= 0 || grossRelease > contract.amount) {
    return { ok: false, error: 'Số tiền giải ngân từng phần không hợp lệ.' };
  }

  const feeInfo = calculateFeeBreakdown(grossRelease, 'Escrow Release', 'VND', contract.feePayer || 'FREELANCER');
  contract.amount -= grossRelease;
  contract.releasedSoFar = (contract.releasedSoFar || 0) + grossRelease;
  if (requestedPct >= 100) {
    (contract.milestones || []).forEach((m) => {
      m.released = true;
    });
  } else if (firstPending) {
    firstPending.released = true;
  }

  contract.status = contract.amount === 0 ? 'RELEASED' : 'PARTIALLY_RELEASED';
  contract.failedStepText = null;
  contract.aiRecommendation = null;
  state.freelancerBalance += feeInfo.netPayout;
  state.platformFeesCollected += feeInfo.totalFee;
  state.reputation.freelancer.totalVolume += feeInfo.netPayout;

  const proof = computeProofHashAndCid(`${contractId}-partial-${grossRelease}`);
  state.ledger.unshift({
    id: `EV-${Math.floor(1000 + Math.random() * 9000)}`,
    contractId: contract.id,
    time: new Date().toLocaleTimeString('vi-VN'),
    role: 'CLIENT',
    type: requestedPct >= 100 ? 'Giải ngân toàn bộ (100%)' : `Giải ngân Milestone (${firstPending?.id || `${requestedPct}%`})`,
    detail: `[${contract.id}] Gross ${formatVND(grossRelease)} → Net ${formatVND(feeInfo.netPayout)} (Phí: ${formatVND(feeInfo.totalFee)})`,
    amount: feeInfo.netPayout,
    auditHash: proof.auditHash
  });

  return { ok: true, contract, feeInfo };
}

export function triggerTimelockAutoRelease(state, contractId, options = {}) {
  if (state.vaultPaused) {
    return { ok: false, error: '⚠️ Circuit Breaker đang bật: Tạm dừng giải ngân Smart Vault để kiểm tra an toàn.' };
  }
  const contract = state.contracts.find((c) => c.id === contractId);
  if (!contract || contract.vaultFrozen) {
    return { ok: false, error: 'Hợp đồng không hợp lệ hoặc đang bị đóng băng tranh chấp.' };
  }
  if (countMultiSignatures(contract.signatures) < 2) {
    return { ok: false, error: 'Chưa đủ chữ ký Multi-Sig 2-of-3 để Auto-Release.' };
  }
  const gross = contract.amount;
  const feeInfo = calculateFeeBreakdown(gross, 'Timelock Auto-Release');
  contract.amount = 0;
  contract.releasedSoFar = (contract.releasedSoFar || 0) + gross;
  contract.status = 'RELEASED';
  contract.timelockRemaining = options.triggeredBy === 'SERVER_WORKER' ? 'Đã hoàn tất Auto-Release (Server Worker)' : 'Đã hoàn tất Auto-Release';
  contract.failedStepText = null;
  contract.aiRecommendation = null;

  state.freelancerBalance += feeInfo.netPayout;
  state.platformFeesCollected += feeInfo.totalFee;
  state.reputation.freelancer.totalVolume += feeInfo.netPayout;

  const proof = computeProofHashAndCid(`${contractId}-timelock-${gross}`);
  state.ledger.unshift({
    id: `EV-${Math.floor(1000 + Math.random() * 9000)}`,
    time: new Date().toLocaleTimeString('vi-VN'),
    role: 'ARBITER',
    type: 'Timelock Auto-Release',
    detail: `[${contract.id}] Hết hạn ${contract.inspectionDays} ngày kiểm tra → Tự động giải ngân Net ${formatVND(feeInfo.netPayout)}`,
    amount: feeInfo.netPayout,
    auditHash: proof.auditHash
  });

  return { ok: true, contract, feeInfo };
}

export function downloadEvidenceFile(evidence) {
  if (!evidence) return { ok: false, error: 'Thiếu dữ liệu file bằng chứng.' };
  const fileName = evidence.fileName || 'evidence-document.dat';

  // Trong môi trường Node.js (Unit tests)
  if (typeof document === 'undefined') {
    return {
      ok: true,
      downloaded: true,
      fileName,
      sizeKb: evidence.fileSizeKb || 120,
      hash: evidence.hash
    };
  }

  // Trong môi trường trình duyệt: Tải trực tiếp file về máy tính của Arbiter
  if (evidence.dataUrl) {
    const a = document.createElement('a');
    a.href = evidence.dataUrl;
    a.download = fileName;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    return { ok: true, downloaded: true, fileName };
  }

  // Trường hợp file mẫu hoặc file văn bản: sinh nội dung chứng thực để tải về máy
  let content = evidence.fileContent;
  let mimeType = evidence.fileType || 'text/plain;charset=utf-8';

  if (!content) {
    if (fileName.endsWith('.log') || fileName.endsWith('.txt')) {
      content = `[VIBEESCROW EVIDENCE AUDIT LOG]\n` +
        `File Name: ${fileName}\n` +
        `Actor: ${evidence.actor}\n` +
        `Time: ${evidence.time}\n` +
        `SHA-256 Hash: ${evidence.hash}\n` +
        `IPFS CID: ${evidence.ipfsCid}\n` +
        `----------------------------------------\n` +
        `Description: ${evidence.content}\n` +
        `Status: VERIFIED_BY_ARBITER\n`;
      mimeType = 'text/plain;charset=utf-8';
    } else if (fileName.endsWith('.pdf')) {
      content = `%PDF-1.4\n%VibeEscrow Verified Evidence Document\n%File: ${fileName}\n%Actor: ${evidence.actor}\n%Hash: ${evidence.hash}\n%Content: ${evidence.content}\n%%EOF`;
      mimeType = 'application/pdf';
    } else if (fileName.endsWith('.png') || fileName.endsWith('.jpg') || fileName.endsWith('.jpeg')) {
      content = `<svg xmlns="http://www.w3.org/2000/svg" width="600" height="300" viewBox="0 0 600 300">
        <rect width="100%" height="100%" fill="#0F172A"/>
        <text x="30" y="50" fill="#38BDF8" font-family="sans-serif" font-size="18" font-weight="bold">VibeEscrow Evidence Screenshot</text>
        <text x="30" y="90" fill="#FFFFFF" font-family="sans-serif" font-size="14">File: ${fileName}</text>
        <text x="30" y="120" fill="#94A3B8" font-family="sans-serif" font-size="12">Actor: ${evidence.actor}</text>
        <text x="30" y="150" fill="#94A3B8" font-family="sans-serif" font-size="12">Hash: ${evidence.hash}</text>
        <text x="30" y="180" fill="#34D399" font-family="sans-serif" font-size="12">CID: ${evidence.ipfsCid}</text>
        <text x="30" y="220" fill="#F8FAFC" font-family="sans-serif" font-size="13">${evidence.content}</text>
      </svg>`;
      mimeType = 'image/svg+xml;charset=utf-8';
    } else {
      content = `VibeEscrow Evidence File: ${fileName}\nActor: ${evidence.actor}\nHash: ${evidence.hash}\nContent: ${evidence.content}`;
      mimeType = 'text/plain;charset=utf-8';
    }
  }

  const blob = new Blob([content], { type: mimeType });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = fileName;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  setTimeout(() => URL.revokeObjectURL(url), 1000);
  return { ok: true, downloaded: true, fileName };
}

export function submitDisputeEvidence(state, contractId, actor, content, fileMeta = null) {
  const contract = state.contracts.find((c) => c.id === contractId);
  if (!contract) return { ok: false, error: 'Không tìm thấy hợp đồng.' };
  const text = (content || '').trim();
  const fileName = fileMeta?.fileName || 'evidence-document.pdf';
  const fileSizeKb = fileMeta?.fileSizeKb || 145;
  const fileType = fileMeta?.fileType || 'application/octet-stream';
  const dataUrl = fileMeta?.dataUrl || null;
  const fileContent = fileMeta?.fileContent || null;

  if (!text && !fileMeta) {
    return { ok: false, error: 'Nội dung hoặc file chứng cứ không được để trống.' };
  }

  const proof = computeProofHashAndCid(`${contractId}-${actor}-${fileName}-${text}-${Date.now()}`);
  const entry = {
    id: fileMeta?.id || `EV-FILE-${Math.floor(100000 + Math.random() * 900000)}`,
    actor,
    fileName,
    fileSizeKb,
    fileType,
    dataUrl,
    fileContent,
    content: text || `Đính kèm file bằng chứng ${fileName}`,
    hash: proof.sha256,
    ipfsCid: proof.ipfsCid,
    time: new Date().toLocaleTimeString('vi-VN')
  };
  contract.evidences = contract.evidences || [];
  contract.evidences.unshift(entry);

  state.ledger.unshift({
    id: `EV-${Math.floor(1000 + Math.random() * 9000)}`,
    time: entry.time,
    role: actor.includes('CLIENT') ? 'CLIENT' : actor.includes('FREELANCER') ? 'FREELANCER' : 'ARBITER',
    type: 'Tải File Bằng chứng (Gửi Arbiter)',
    detail: `[${contract.id}] ${actor} tải lên "${fileName}" (${fileSizeKb} KB • ${proof.sha256})`,
    amount: contract.amount,
    auditHash: proof.auditHash
  });

  return { ok: true, entry };
}

export function applyCircuitBreakerFreeze(state, contractId, reason = 'Phát hiện vi phạm forbidden_paths') {
  const contract = state.contracts.find((c) => c.id === contractId);
  if (!contract) return { ok: false, error: 'Không tìm thấy hợp đồng.' };
  contract.vaultFrozen = true;
  contract.status = 'DISPUTED';
  contract.ciVerified = false;
  contract.timelockRemaining = '❄️ ĐÓNG BĂNG TỰ ĐỘNG (Circuit Breaker)';
  contract.disputeReason = reason;
  return { ok: true, contract };
}

export function openDisputeWithEvidence(state, contractId, actorContext = {}, reason = '') {
  const contract = state.contracts.find((c) => c.id === contractId);
  if (!contract) return { ok: false, error: 'Không tìm thấy hợp đồng.' };
  if (!Array.isArray(contract.evidences) || contract.evidences.length < 1) {
    return { ok: false, error: 'Bắt buộc đính kèm ít nhất 1 file bằng chứng trước khi mở tranh chấp.' };
  }
  const actorRole = String(actorContext.role || '').toLowerCase();
  if (actorRole === 'arbiter') {
    return { ok: false, error: 'Trọng tài không được tự ý mở tranh chấp thay cho các bên.' };
  }
  contract.status = 'DISPUTED';
  contract.vaultFrozen = true;
  contract.ciVerified = false;
  contract.disputeOpenedBy = actorContext.actorId || actorRole || 'client';
  contract.disputeDeadline = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString();
  if (reason) contract.disputeReason = reason;
  contract.timelockRemaining = '❄️ ĐÓNG BĂNG TIMELOCK (Hạn xử lý 7 ngày)';
  return { ok: true, contract };
}

export function resolveDisputeByArbiter(state, contractId, resolution, customBuyerPercent = 35, actorContext = {}) {
  const contract = state.contracts.find((c) => c.id === contractId);
  if (!contract || contract.status !== 'DISPUTED') {
    return { ok: false, error: 'Hợp đồng không tồn tại hoặc không ở trạng thái tranh chấp.' };
  }
  const actorRole = String(actorContext.role || '').toLowerCase();
  const actorId = actorContext.actorId ? String(actorContext.actorId) : '';
  if (actorRole === 'client' || actorRole === 'freelancer') {
    return { ok: false, error: 'Xung đột lợi ích: Client hoặc Freelancer của hợp đồng không được phép tự xử tranh chấp.' };
  }
  if (actorId && (actorId === contract.clientId || actorId === contract.freelancer || actorId === contract.disputeOpenedBy)) {
    return { ok: false, error: 'Xung đột lợi ích: Người xử tranh chấp không được trùng với người mở tranh chấp hoặc các bên hợp đồng.' };
  }
  const sigCheck = assertMultiSig2Of3(contract, 'DISPUTE_RESOLUTION');
  if (!sigCheck.ok) {
    return { ok: false, error: sigCheck.error };
  }

  const grossAmount = contract.amount;
  const isFullRefund = resolution === 'REFUND_CLIENT';
  const feeInfo = isFullRefund
    ? { gross: grossAmount, takeRateFee: 0, gatewayOrGasFee: 0, totalFee: 0, netPayout: grossAmount }
    : calculateFeeBreakdown(grossAmount, 'Arbitration Settlement', 'VND', contract.feePayer || 'FREELANCER');
  const distributable = feeInfo.netPayout;
  let buyerShare = 0;
  let sellerShare = 0;
  let detailText = '';

  if (resolution === 'RELEASE_FREELANCER') {
    contract.status = 'RELEASED';
    sellerShare = distributable;
    detailText = `Arbiter giải ngân 100% [${contract.id}] cho ${contract.freelancer} (Net: ${formatVND(sellerShare)})`;
  } else if (resolution === 'REFUND_CLIENT') {
    contract.status = 'REFUNDED';
    buyerShare = grossAmount;
    detailText = `Arbiter hoàn trả 100% [${contract.id}] về ví Client không trừ phí (${formatVND(buyerShare)})`;
  } else if (resolution === 'SPLIT_50_50') {
    contract.status = 'SPLIT';
    buyerShare = Math.floor(distributable / 2);
    sellerShare = distributable - buyerShare;
    detailText = `Arbiter chia 50/50 [${contract.id}]: Buyer ${formatVND(buyerShare)} • Seller ${formatVND(sellerShare)}`;
  } else if (resolution === 'CUSTOM_SPLIT') {
    const bPct = Math.min(100, Math.max(0, Number(customBuyerPercent ?? 35)));
    const sPct = 100 - bPct;
    contract.status = 'SPLIT';
    buyerShare = Math.round(distributable * (bPct / 100));
    sellerShare = distributable - buyerShare;
    detailText = `Arbiter phê duyệt chia ${sPct}% Freelancer (${formatVND(sellerShare)}) / ${bPct}% Client (${formatVND(buyerShare)}) cho [${contract.id}]`;
  } else {
    return { ok: false, error: 'Phán quyết không hợp lệ.' };
  }

  contract.amount = 0;
  contract.vaultFrozen = false;
  contract.failedStepText = null;
  contract.aiRecommendation = null;

  state.clientBalance += buyerShare;
  state.freelancerBalance += sellerShare;
  state.platformFeesCollected += feeInfo.totalFee;
  state.reputation.arbiter.disputesCount += 1;

  const proof = computeProofHashAndCid(`${contract.id}-${resolution}-${buyerShare}-${sellerShare}`);
  state.ledger.unshift({
    id: `EV-${Math.floor(1000 + Math.random() * 9000)}`,
    contractId: contract.id,
    time: new Date().toLocaleTimeString('vi-VN'),
    role: 'ARBITER',
    type: 'Phán quyết Trọng tài',
    detail: detailText,
    amount: grossAmount,
    auditHash: proof.auditHash
  });

  return { ok: true, contract, buyerShare, sellerShare, feeInfo, detailText };
}

/* ==========================================================================
   Browser DOM Controller
   ========================================================================== */
export function initBrowserApp() {
  if (typeof document === 'undefined') return;

  let state = createInitialEscrowState();
  let currentLoginRole = 'client';
  let activePopupContractId = null;
  let bankDashboard;

  const walletCardClientEl = document.getElementById('wallet-card-client');
  const walletCardFreelancerEl = document.getElementById('wallet-card-freelancer');
  const kpiClientEl = document.getElementById('kpi-client-balance');
  const kpiEscrowEl = document.getElementById('kpi-escrow-locked');
  const kpiEscrowCountEl = document.getElementById('kpi-escrow-count');
  const kpiFreelancerEl = document.getElementById('kpi-freelancer-balance');
  const kpiDisputedAmountEl = document.getElementById('kpi-disputed-amount');
  const kpiDisputedCountEl = document.getElementById('kpi-disputed-count');
  const kpiPlatformFeesEl = document.getElementById('kpi-platform-fees');
  const apiSyncIndicatorEl = document.getElementById('api-sync-indicator');

  const activeSessionBadgeEl = document.getElementById('active-session-badge');
  const backTo3ButtonsTopBtn = document.getElementById('btn-back-to-3-buttons');
  const zoneLauncherGridEl = document.getElementById('zone-launcher-grid');
  const fullscreenStageEl = document.getElementById('fullscreen-zone-stage');
  const fullscreenStageTitleEl = document.getElementById('fullscreen-stage-title');
  const fullscreenQuickTabsEl = document.getElementById('fullscreen-quick-zone-tabs');
  const stageBackBtn = document.getElementById('btn-stage-back');

  const clientContractsListEl = document.getElementById('client-contracts-list');
  const freelancerContractsListEl = document.getElementById('freelancer-contracts-list');
  const freelancerSelectEl = document.getElementById('freelancer-contract-select');
  const evidenceContractSelectEl = document.getElementById('evidence-contract-select');
  const arbiterDisputesListEl = document.getElementById('arbiter-disputes-list');
  const arbiterAllContractsListEl = document.getElementById('arbiter-all-contracts-list');
  const reputationContainerEl = document.getElementById('reputation-cards-container');
  const ledgerBodyEl = document.getElementById('transaction-ledger-body');
  const ledgerCountPillEl = document.getElementById('ledger-count-pill');

  // Lệnh Nạp tiền VietQR & Xác nhận từ Arbiter
  const clientTopupsHistoryListEl = document.getElementById('client-topups-history-list');
  const clientTopupsCountBadgeEl = document.getElementById('client-topups-count-badge');
  const arbiterPendingTopupsListEl = document.getElementById('arbiter-pending-topups-list');
  const arbiterPendingTopupsCountBadgeEl = document.getElementById('arbiter-pending-topups-count-badge');
  const arbiterTopupFeedbackEl = document.getElementById('arbiter-topup-feedback');
  const modalQrAmountEl = document.getElementById('modal-qr-amount');
  const modalQrMemoEl = document.getElementById('modal-qr-memo');

  // Vùng Thông báo Duyệt Tiền Nạp (VietQR Pro 24/7)
  const topupNotificationZoneEl = document.getElementById('topup-notification-zone');
  const notifyZoneCountBadgeEl = document.getElementById('notify-zone-count-badge');
  const btnToggleNotifyBody = document.getElementById('btn-toggle-notify-body');
  const topupNotificationBodyEl = document.getElementById('topup-notification-body');
  const topupNotificationRoleHintEl = document.getElementById('topup-notification-role-hint');
  const topupNotificationItemsContainerEl = document.getElementById('topup-notification-items-container');
  const topupNotificationFeedbackEl = document.getElementById('topup-notification-feedback');

  // Onboarding Non-tech & Circuit Breaker Bảo mật Vault
  const btnToggleOnboardingGuide = document.getElementById('btn-toggle-onboarding-guide');
  const btnCloseOnboardingGuide = document.getElementById('btn-close-onboarding-guide');
  const nonTechOnboardingStripEl = document.getElementById('non-tech-onboarding-strip');
  const btnArbiterCircuitBreaker = document.getElementById('btn-arbiter-circuit-breaker');
  const vaultSecurityPillEl = document.getElementById('vault-security-pill');

  // Popup Modal Xác thực Mật khẩu Arbiter (123456)
  const arbiterAuthModal = document.getElementById('arbiter-auth-modal');
  const arbiterAuthForm = document.getElementById('arbiter-auth-form');
  const arbiterPasswordInput = document.getElementById('arbiter-password-input');
  const arbiterAuthErrorEl = document.getElementById('arbiter-auth-error');
  const btnCloseArbiterAuth = document.getElementById('btn-close-arbiter-auth');
  const btnCancelArbiterAuth = document.getElementById('btn-cancel-arbiter-auth');

  // Hộp cảnh báo & khuyến nghị của Agent (CHỈ HIỆN KHI BƯỚC KIỂM TRA KHÔNG PASS)
  const clientAgentFailureBoxEl = document.getElementById('client-agent-failure-box');
  const freelancerAgentFailureBoxEl = document.getElementById('freelancer-agent-failure-box');

  // Transaction Detail Popup Elements
  const txModal = document.getElementById('transaction-detail-modal');
  const closeTxModalBtn = document.getElementById('btn-close-tx-modal');
  const txModalIdEl = document.getElementById('tx-modal-id');
  const txModalStatusBadgeEl = document.getElementById('tx-modal-status-badge');
  const txModalViewerRoleEl = document.getElementById('tx-modal-viewer-role');
  const txModalTitleEl = document.getElementById('tx-modal-title');
  const txModalOverviewEl = document.getElementById('tx-modal-overview');
  const txModalRoleActionsEl = document.getElementById('tx-modal-role-actions');
  const txModalEvidenceCountEl = document.getElementById('tx-modal-evidence-count');
  const txModalEvidenceListEl = document.getElementById('tx-modal-evidence-list');
  const popupEvidenceForm = document.getElementById('popup-evidence-file-form');
  const popupEvidenceFileInput = document.getElementById('popup-evidence-file-input');
  const popupEvidenceNoteInput = document.getElementById('popup-evidence-note-input');
  const popupEvidenceFeedbackEl = document.getElementById('popup-evidence-feedback');

  // Đồng bộ dữ liệu động với Backend API (/api/state)
  async function syncStateWithServer(pushUpdate = false) {
    try {
      const health = await callDynamicApi('/api/health', 'GET');
      if (!pushUpdate && health?.status === 'ok') {
        const remote = await callDynamicApi(`/api/state?role=${encodeURIComponent(currentLoginRole)}`, 'GET');
        if (remote && Array.isArray(remote.contracts)) {
          state = {
            ...state,
            ...remote,
            clientBalance: remote.clientBalance ?? state.clientBalance,
            freelancerBalance: remote.freelancerBalance ?? state.freelancerBalance,
            platformFeesCollected: remote.platformFeesCollected ?? state.platformFeesCollected
          };
        }
      }
      if (apiSyncIndicatorEl) {
        if (health?.status === 'ok') {
          const llmLabel = health.llmEngine || (health.geminiConfigured ? 'LLM_ONLINE' : 'RULE_FALLBACK_ACTIVE');
          const sandboxLabel = health.sandboxRunner || 'Ready';
          const timelockLabel = health.timelockMonitor || 'Active (15s)';
          apiSyncIndicatorEl.textContent = `● API Online • ${llmLabel} • Sandbox: ${sandboxLabel} • Timelock: ${timelockLabel}`;
          apiSyncIndicatorEl.className = 'bank-connection is-connected';
        } else {
          apiSyncIndicatorEl.textContent = '● Mất kết nối API';
          apiSyncIndicatorEl.className = 'bank-connection';
        }
      }
    } catch {
      if (apiSyncIndicatorEl) {
        apiSyncIndicatorEl.textContent = '● Mất kết nối API — Chế độ Offline';
        apiSyncIndicatorEl.className = 'bank-connection';
      }
    }
  }

  function getStatusBadgeHtml(status) {
    switch (status) {
      case 'IN_PROGRESS':
        return `<span class="pill pill-blue">Đang thực hiện</span>`;
      case 'SUBMITTED':
        return `<span class="pill pill-emerald">✓ Đã nộp bàn giao</span>`;
      case 'REVISION_REQUESTED':
        return `<span class="pill pill-rose">⚠️ Không Pass (Chờ sửa)</span>`;
      case 'PARTIALLY_RELEASED':
        return `<span class="pill pill-emerald">Giải ngân 1 phần</span>`;
      case 'DISPUTED':
        return `<span class="pill pill-rose">❄️ Đang Tranh chấp</span>`;
      case 'RELEASED':
      case 'AUTO_RELEASED':
        return `<span class="pill pill-emerald">✓ Đã giải ngân${status === 'AUTO_RELEASED' ? ' (Auto)' : ''}</span>`;
      case 'REFUNDED':
        return `<span class="pill">Đã hoàn trả Buyer</span>`;
      case 'SPLIT':
        return `<span class="pill pill-purple">⚖️ Đã chia %</span>`;
      default:
        return `<span class="pill">${status}</span>`;
    }
  }

  function renderMultiSigBar(c) {
    const count = countMultiSignatures(c.signatures);
    return `
      <div class="multisig-row">
        <span style="font-size:0.68rem;font-weight:700;color:var(--text-secondary);">Multi-Sig (${count}/3):</span>
        <span class="sig-chip ${c.signatures.client ? 'signed' : ''}">${c.signatures.client ? '✓' : '○'} Buyer</span>
        <span class="sig-chip ${c.signatures.freelancer ? 'signed' : ''}">${c.signatures.freelancer ? '✓' : '○'} Seller</span>
        <span class="sig-chip ${c.signatures.arbiter ? 'signed' : ''}">${c.signatures.arbiter ? '✓' : '○'} Arbiter</span>
        <span class="sig-chip">${c.vaultAddress}</span>
      </div>`;
  }

  function renderMilestonesMini(c) {
    if (!c.milestones || c.milestones.length === 0) return '';
    return `
      <div class="milestone-mini-list">
        ${c.milestones
          .map(
            (m) => `
          <div class="milestone-mini-item">
            <span>${m.name}</span>
            <strong>${m.released ? '✓ Đã trả' : formatVND(m.amount)}</strong>
          </div>`
          )
          .join('')}
      </div>`;
  }

  /**
   * Chỉ hiển thị hộp thông báo & khuyến nghị của Agent khi hợp đồng có bước KHÔNG PASS
   * (REVISION_REQUESTED hoặc DISPUTED hoặc ciVerified === false)
   */
  function renderAgentAlertIfFailed(c) {
    const hasFailedStep = c.status === 'REVISION_REQUESTED' || c.status === 'DISPUTED' || c.ciVerified === false;
    if (!hasFailedStep) {
      if (c.ciVerified === true && c.aiRecommendation) {
        return `
          <div class="alert-box alert-success" style="margin-top:0.4rem;">
            <div><strong>✅ Đã đạt kiểm thử tự động:</strong> Đủ 100% tiêu chí khách quan.</div>
            <div style="margin-top:0.2rem;"><strong>💡 Khuyến nghị của AI Agent:</strong> "${escapeHtml(c.aiRecommendation)}"</div>
          </div>`;
      }
      return '';
    }
    if (!c.aiRecommendation && !c.failedStepText) return '';

    const v = c.latestVerification;
    const recText =
      !c.aiRecommendation || /PASS_100|xuất sắc|Khuyến nghị giải ngân/i.test(c.aiRecommendation)
        ? buildConsistentAgentRecommendation({
            allObjectivePassed: false,
            passedCount: v?.passedCriteria?.length || 0,
            totalCount: (v?.passedCriteria?.length || 0) + (v?.failedCriteria?.length || 1),
            failedReasons: v?.failedCriteria?.length ? v.failedCriteria : [c.failedStepText || 'Chưa đạt tiêu chí kỹ thuật']
          }).message
        : c.aiRecommendation;

    return `
      <div class="alert-box alert-error" style="margin-top:0.4rem;">
        <div><strong>⚠️ Thông báo không đạt:</strong> ${escapeHtml(c.failedStepText || 'Phát hiện tiêu chí chưa vượt qua kiểm thử.')}</div>
        <div style="margin-top:0.2rem;"><strong>💡 Khuyến nghị của AI Agent:</strong> "${escapeHtml(recText)}"</div>
      </div>`;
  }

  function renderRoleLauncherButtons() {
    if (!zoneLauncherGridEl) return;
    const roleCfg = ROLE_ZONES_CONFIG[currentLoginRole] || ROLE_ZONES_CONFIG.client;

    if (activeSessionBadgeEl) {
      activeSessionBadgeEl.className = `pill ${roleCfg.badgeClass}`;
      activeSessionBadgeEl.textContent = roleCfg.roleTitle;
    }

    const activeCount = state.contracts.filter((c) => c.amount > 0).length;
    const disputedCount = state.contracts.filter((c) => c.status === 'DISPUTED').length;
    const totalEvidences = state.contracts.reduce((s, c) => s + (c.evidences?.length || 0), 0);

    zoneLauncherGridEl.innerHTML = roleCfg.zones
      .map((z, idx) => {
        let dynamicPreviewHtml = '';
        if (idx === 0) {
          dynamicPreviewHtml = state.contracts
            .slice(0, 3)
            .map(
              (c) =>
                `<div style="display:flex;justify-content:space-between;align-items:center;">
                  <span>• <span class="pill pill-mono">Mã HĐ: ${escapeHtml(c.id)}</span> ${escapeHtml(c.title.slice(0, 26))}...</span>
                  <span class="pill pill-mono">${formatVND(c.amount)}</span>
                 </div>`
            )
            .join('');
        } else if (idx === 1) {
          // Bảo mật số dư ví: Client không xem được ví Freelancer và ngược lại
          const roleWalletRow =
            currentLoginRole === 'client'
              ? `<div>• Số dư Ví Client của bạn: <strong>${formatVND(state.clientBalance)}</strong></div>`
              : currentLoginRole === 'freelancer'
              ? `<div>• Số dư Ví Freelancer của bạn: <strong>${formatVND(state.freelancerBalance)}</strong></div>`
              : `<div>• Quỹ đang khóa Smart Vault: <strong>${formatVND(state.contracts.reduce((s, c) => s + c.amount, 0))}</strong></div>`;
          dynamicPreviewHtml = `
            ${roleWalletRow}
            <div>• Hợp đồng hoạt động: <strong>${activeCount} hợp đồng</strong></div>
            <div>• Bằng chứng đã tải: <strong>${totalEvidences} files</strong></div>`;
        } else {
          const nextCode = `ESC-${101 + state.contracts.length}`;
          dynamicPreviewHtml = `
            <div>• Mã hợp đồng kế tiếp: <strong>${nextCode}</strong></div>
            <div>• Quỹ đang khóa Vault: <strong>${formatVND(state.contracts.reduce((s, c) => s + c.amount, 0))}</strong></div>
            <div>• Hồ sơ tranh chấp: <strong>${disputedCount} vụ</strong></div>`;
        }

        return `
        <button type="button" class="zone-big-btn" data-open-fullscreen-zone="${z.id}">
          <div class="zone-big-top">
            <div class="zone-big-header">
              <span class="zone-big-icon">${z.icon}</span>
              <span class="pill ${roleCfg.badgeClass}">${z.tag}</span>
            </div>
            <div class="zone-big-title">${z.title}</div>
            <div class="zone-big-desc">${z.desc}</div>
            <div class="zone-big-preview-list">
              ${dynamicPreviewHtml}
            </div>
          </div>
          <div class="zone-big-cta">
            <span>${z.shortTitle}</span>
            <span>➔</span>
          </div>
        </button>`;
      })
      .join('');
  }

  function openFullscreenZone(zoneId) {
    bankDashboard?.setPage(zoneId);
    const roleCfg = ROLE_ZONES_CONFIG[currentLoginRole] || ROLE_ZONES_CONFIG.client;
    const allViews = document.querySelectorAll('.zone-content-view');

    if (!zoneId) {
      if (zoneLauncherGridEl) zoneLauncherGridEl.hidden = false;
      if (fullscreenStageEl) fullscreenStageEl.hidden = true;
      if (backTo3ButtonsTopBtn) backTo3ButtonsTopBtn.hidden = true;
      allViews.forEach((v) => (v.hidden = true));
      return;
    }

    if (zoneLauncherGridEl) zoneLauncherGridEl.hidden = true;
    if (fullscreenStageEl) fullscreenStageEl.hidden = false;
    if (backTo3ButtonsTopBtn) backTo3ButtonsTopBtn.hidden = false;

    const matchedZone = roleCfg.zones.find((z) => z.id === zoneId) || roleCfg.zones[0];
    if (fullscreenStageTitleEl) {
      fullscreenStageTitleEl.textContent = document.getElementById('bank-page-title')?.textContent || matchedZone.shortTitle;
    }

    if (fullscreenQuickTabsEl) {
      fullscreenQuickTabsEl.innerHTML = roleCfg.zones
        .map(
          (z) => `
          <button
            type="button"
            class="btn ${z.id === matchedZone.id ? 'btn-primary' : 'btn-secondary'} btn-xs"
            data-quick-zone="${z.id}"
          >
            ${z.icon} ${z.shortTitle}
          </button>`
        )
        .join('');
    }

    allViews.forEach((v) => {
      v.hidden = v.id !== matchedZone.id;
    });
  }

  function openTransactionPopup(contractId) {
    const c = state.contracts.find((item) => item.id === contractId);
    if (!c || !txModal) return;
    activePopupContractId = c.id;

    if (txModalIdEl) txModalIdEl.textContent = c.id;
    if (txModalStatusBadgeEl) txModalStatusBadgeEl.innerHTML = getStatusBadgeHtml(c.status);
    if (txModalViewerRoleEl) {
      txModalViewerRoleEl.textContent = currentLoginRole.toUpperCase();
    }
    if (txModalTitleEl) txModalTitleEl.textContent = `[${c.id}] ${c.title}`;

    if (txModalOverviewEl) {
      txModalOverviewEl.innerHTML = `
        <div class="contract-subbox" style="font-size:0.78rem;">
          <div style="display:flex;justify-content:space-between;flex-wrap:wrap;gap:0.5rem;margin-bottom:0.35rem;">
            <span><strong>Seller / Freelancer:</strong> ${c.freelancer}</span>
            <span><strong>Số dư đang khóa Vault:</strong> <strong style="color:var(--accent-blue);">${formatVND(c.amount)}</strong></span>
            <span><strong>Đã giải ngân:</strong> ${formatVND(c.releasedSoFar || 0)}</span>
          </div>
          <div><strong>Tiêu chí nghiệm thu:</strong> ${c.acceptanceCriteria}</div>
          <div><strong>Chữ ký số:</strong> <code>${c.signatureScheme}</code> • <strong>Lượt sửa:</strong> ${c.revisionsUsed}/${c.maxRevisions} • <strong>Timelock:</strong> ${c.timelockRemaining}</div>
          ${c.clientRevisionComment && c.status === 'REVISION_REQUESTED' ? `
            <div style="background:#FFFBEB;border:1px solid #FDE68A;border-radius:var(--radius-sm);padding:0.5rem 0.75rem;margin-top:0.45rem;">
              <strong style="color:#92400E;font-size:0.78rem;">📝 Mô tả Yêu cầu Sửa đổi từ Khách hàng:</strong>
              <div style="color:var(--text-primary);font-size:0.83rem;font-weight:700;margin-top:0.2rem;background:#FFFFFF;padding:0.45rem 0.65rem;border-radius:var(--radius-sm);border:1px solid #FDE68A;">
                "${c.clientRevisionComment}"
              </div>
            </div>
          ` : ''}
          ${renderAgentAlertIfFailed(c)}
        </div>
        ${renderMilestonesMini(c)}
        ${renderMultiSigBar(c)}
      `;
    }

    if (txModalRoleActionsEl) {
      if (currentLoginRole === 'client') {
        const canAct = c.amount > 0 && c.status !== 'DISPUTED';
        const releaseSigCheck = assertMultiSig2Of3(c, 'RELEASE');
        const releaseDisabledAttr = releaseSigCheck.ok
          ? ''
          : `disabled title="${escapeHtml(releaseSigCheck.error)}"`;
        txModalRoleActionsEl.innerHTML = canAct
          ? `<div class="contract-actions">
              <button type="button" class="btn btn-emerald btn-sm" data-popup-action="client-release" data-id="${escapeHtml(c.id)}" ${releaseDisabledAttr}>
                ✓ Nghiệm thu & Giải ngân 100%
              </button>
              <button type="button" class="btn btn-secondary btn-sm" data-popup-action="client-partial" data-id="${escapeHtml(c.id)}" ${releaseDisabledAttr}>
                ◑ Giải ngân Milestone
              </button>
              <button type="button" class="btn btn-secondary btn-sm" data-popup-action="client-revision" data-id="${escapeHtml(c.id)}">
                ↺ Yêu cầu Sửa (${c.revisionsUsed}/${c.maxRevisions})
              </button>
              <button type="button" class="btn btn-rose btn-sm" data-popup-action="open-dispute" data-id="${escapeHtml(c.id)}">
                ❄️ Mở Tranh chấp & Đóng băng Quỹ
              </button>
             </div>
             <div id="tx-revision-form-box" class="contract-subbox" style="margin-top:0.6rem;background:#F8FAFC;border:1px dashed #CBD5E1;" hidden>
               <div style="font-weight:700;font-size:0.8rem;margin-bottom:0.35rem;color:var(--text-primary);display:flex;align-items:center;gap:0.35rem;">
                 <span>📝 Nhập yêu cầu chỉnh sửa bổ sung (DoD, chức năng, tài liệu... nếu có):</span>
               </div>
               <textarea id="tx-revision-note-input" class="form-input" rows="2" style="width:100%;font-size:0.8rem;margin-bottom:0.45rem;" placeholder="Nhập chi tiết yêu cầu sửa đổi (ví dụ: bổ sung unit test cho input âm, sửa response 400)..."></textarea>
               <div style="display:flex;justify-content:flex-end;gap:0.45rem;">
                 <button type="button" class="btn btn-secondary btn-xs" id="btn-cancel-revision-form">Hủy</button>
                 <button type="button" class="btn btn-primary btn-xs" id="btn-submit-revision-form" data-id="${c.id}">
                   ✓ Xác nhận gửi Yêu cầu Sửa
                 </button>
               </div>
             </div>`
          : '';
      } else if (currentLoginRole === 'freelancer') {
        const revisionBanner = c.clientRevisionComment && c.status === 'REVISION_REQUESTED' ? `
          <div class="alert-box alert-warning" style="margin-bottom:0.65rem;border-left:4px solid #D97706;">
            <div style="font-weight:800;color:#92400E;display:flex;align-items:center;gap:0.35rem;">
              <span>📝 Khách hàng đã yêu cầu sửa đổi (Lần ${c.revisionsUsed}/${c.maxRevisions}):</span>
            </div>
            <div style="font-weight:700;font-size:0.83rem;color:#1E293B;margin:0.35rem 0;background:#FFFFFF;padding:0.5rem 0.65rem;border-radius:var(--radius-sm);border:1px solid #FDE68A;">
              "${c.clientRevisionComment}"
            </div>
            <div style="font-size:0.73rem;color:var(--text-secondary);">
              💡 Vui lòng hoàn tất sửa đổi rồi vào Vùng 1 để nộp link GitHub / commit hash mới.
            </div>
          </div>
        ` : '';

        txModalRoleActionsEl.innerHTML = `
          ${revisionBanner}
          <div class="contract-actions">
            ${
              !c.signatures.freelancer
                ? `<button type="button" class="btn btn-primary btn-sm" data-popup-action="seller-sign" data-id="${c.id}">
                    ✍️ Ký số Seller (EIP-712 Multi-Sig)
                   </button>`
                : ''
            }
            ${
              c.amount > 0 && c.status !== 'DISPUTED'
                ? `<button type="button" class="btn btn-rose btn-sm" data-popup-action="open-dispute" data-id="${c.id}">
                    ❄️ Mở Tranh chấp & Đóng băng Quỹ
                   </button>`
                : ''
            }
          </div>`;
      } else {
        const bailiff =
          typeof c.recommendedBuyerPercent === 'number' && typeof c.recommendedSellerPercent === 'number'
            ? { recommendedBuyerPercent: c.recommendedBuyerPercent, recommendedSellerPercent: c.recommendedSellerPercent }
            : runFactFindingBailiffAgent(c);
        const recBuyer = bailiff.recommendedBuyerPercent;
        const recSeller = bailiff.recommendedSellerPercent;
        txModalRoleActionsEl.innerHTML =
          c.status === 'DISPUTED' && c.amount > 0
            ? `<div class="split-slider-box">
                <div style="display:flex;justify-content:space-between;font-size:0.76rem;font-weight:700;margin-bottom:0.3rem;">
                  <span>⚖️ Phán quyết Trọng tài:</span>
                  <span id="popup-split-label">Hoàn ${recBuyer}% Client / Giải ngân ${recSeller}% Freelancer</span>
                </div>
                <input type="range" min="0" max="100" step="5" value="${recBuyer}" id="popup-split-slider" style="width:100%;margin-bottom:0.45rem;" />
                <div class="contract-actions">
                  <button type="button" class="btn btn-purple btn-sm" data-popup-action="arbiter-ai-bailiff" data-id="${c.id}" data-buyer-percent="${recBuyer}">
                    ✓ Duyệt Khuyến nghị (${recSeller}% Freelancer / ${recBuyer}% Client)
                  </button>
                  <button type="button" class="btn btn-secondary btn-sm" data-popup-action="arbiter-custom-split" data-id="${c.id}">
                    ⚖️ Chia theo Thanh trượt
                  </button>
                  <button type="button" class="btn btn-emerald btn-sm" data-popup-action="arbiter-release" data-id="${c.id}">
                    100% Seller
                  </button>
                  <button type="button" class="btn btn-rose btn-sm" data-popup-action="arbiter-refund" data-id="${c.id}">
                    100% Buyer
                  </button>
                </div>
               </div>`
            : '';
      }
    }

    renderPopupEvidenceList(c);
    txModal.hidden = false;
  }

  function renderPopupEvidenceList(contract) {
    const evidences = contract.evidences || [];
    if (txModalEvidenceCountEl) {
      txModalEvidenceCountEl.textContent = `${evidences.length} File bằng chứng`;
    }
    if (!txModalEvidenceListEl) return;

    if (evidences.length === 0) {
      txModalEvidenceListEl.innerHTML = `
        <div style="font-size:0.76rem;color:var(--text-muted);text-align:center;padding:0.5rem;">
          Chưa có file bằng chứng nào được tải lên.
        </div>`;
      return;
    }

    txModalEvidenceListEl.innerHTML = evidences
      .map((ev) => {
        const actorBadge = ev.actor.includes('CLIENT')
          ? 'pill-blue'
          : ev.actor.includes('FREELANCER')
          ? 'pill-emerald'
          : 'pill-purple';
        return `
        <div class="evidence-file-item" style="display:flex;align-items:center;justify-content:space-between;gap:0.75rem;">
          <div style="flex:1;">
            <div style="display:flex;align-items:center;gap:0.4rem;margin-bottom:0.2rem;flex-wrap:wrap;">
              <span class="pill ${actorBadge}">${ev.actor}</span>
              <strong>📄 ${ev.fileName || 'evidence-file.dat'}</strong>
              <span style="color:var(--text-muted);font-size:0.7rem;">(${ev.fileSizeKb || 120} KB • ${ev.time})</span>
            </div>
            <div style="color:var(--text-secondary);font-size:0.75rem;">${ev.content}</div>
          </div>
          <div style="display:flex;flex-direction:column;align-items:flex-end;gap:0.35rem;">
            <span class="pill pill-mono" style="font-size:0.68rem;">${ev.hash}</span>
            <button
              type="button"
              class="btn btn-secondary btn-xs"
              data-download-evidence="${ev.hash}"
              data-contract-id="${contract.id}"
              style="display:inline-flex;align-items:center;gap:0.3rem;font-weight:700;"
              title="Lưu file bằng chứng về máy tính của Arbiter"
            >
              💾 Lưu về máy
            </button>
          </div>
        </div>`;
      })
      .join('');
  }

  function renderAllTransactionUI() {
    const activeContracts = state.contracts.filter((c) => c.amount > 0);
    const escrowLockedTotal = activeContracts.reduce((sum, c) => sum + c.amount, 0);
    const disputedContracts = state.contracts.filter((c) => c.status === 'DISPUTED');
    const disputedTotal = disputedContracts.reduce((sum, c) => sum + c.amount, 0);

    if (kpiClientEl) kpiClientEl.textContent = formatVND(state.clientBalance);
    if (kpiEscrowEl) kpiEscrowEl.textContent = formatVND(escrowLockedTotal);
    if (kpiEscrowCountEl) kpiEscrowCountEl.textContent = `${activeContracts.length} Hợp đồng`;
    if (kpiFreelancerEl) kpiFreelancerEl.textContent = formatVND(state.freelancerBalance);
    if (kpiDisputedAmountEl) kpiDisputedAmountEl.textContent = formatVND(disputedTotal);
    if (kpiDisputedCountEl) kpiDisputedCountEl.textContent = `${disputedContracts.length} Tranh chấp`;
    if (kpiPlatformFeesEl) kpiPlatformFeesEl.textContent = formatVND(state.platformFeesCollected);

    // Phân quyền hiển thị số dư ví: Client không xem được ví của Freelancer và ngược lại
    if (walletCardClientEl) {
      walletCardClientEl.hidden = currentLoginRole !== 'client';
    }
    if (walletCardFreelancerEl) {
      walletCardFreelancerEl.hidden = currentLoginRole !== 'freelancer';
    }

    renderRoleLauncherButtons();

    if (clientContractsListEl) {
      clientContractsListEl.innerHTML = state.contracts
        .map(
          (c) => `
          <div class="contract-card" data-open-tx-popup="${c.id}">
            <div class="contract-header">
              <div>
                <div style="display:flex;align-items:center;gap:0.4rem;margin-bottom:0.2rem;">
                  <span class="pill pill-mono">Mã HĐ: ${c.id}</span>
                  <span class="contract-title">${c.title}</span>
                </div>
                <div class="contract-meta">
                  Mã hợp đồng: <strong>${c.id}</strong> • Seller: <strong>${c.freelancer}</strong> • Đang khóa: <strong>${formatVND(c.amount)}</strong>
                </div>
              </div>
              ${getStatusBadgeHtml(c.status)}
            </div>
            <div class="contract-subbox">
              <div><strong>Tiêu chí:</strong> ${c.acceptanceCriteria}</div>
              <div><strong>Bằng chứng:</strong> ${(c.evidences || []).length} files • <strong>Timelock:</strong> ${c.timelockRemaining}</div>
            </div>
            ${c.clientRevisionComment && c.status === 'REVISION_REQUESTED' ? `
              <div style="background:#FFFBEB;border:1px solid #FDE68A;border-radius:var(--radius-sm);padding:0.4rem 0.6rem;margin-top:0.35rem;font-size:0.74rem;">
                <strong style="color:#92400E;">📝 Bạn đã yêu cầu sửa (Lần ${c.revisionsUsed}/${c.maxRevisions}):</strong>
                <div style="color:var(--text-primary);font-weight:700;margin-top:0.15rem;">"${c.clientRevisionComment}"</div>
              </div>
            ` : ''}
            ${renderAgentAlertIfFailed(c)}
            ${renderMilestonesMini(c)}
            ${renderMultiSigBar(c)}
          </div>`
        )
        .join('');
    }

    if (freelancerSelectEl) {
      const submittable = state.contracts.filter((c) => c.amount > 0 && c.status !== 'DISPUTED');
      freelancerSelectEl.innerHTML =
        submittable.length > 0
          ? submittable
              .map((c) => `<option value="${c.id}">Mã HĐ: ${c.id} — ${c.title} (${formatVND(c.amount)})</option>`)
              .join('')
          : `<option value="">Không có hợp đồng chờ bàn giao</option>`;
    }

    // Cập nhật hộp thông báo yêu cầu sửa đổi từ Client cho Freelancer tại Vùng 1
    const freelancerRevisionBoxEl = document.getElementById('freelancer-contract-revision-box');
    if (freelancerRevisionBoxEl) {
      const selId = freelancerSelectEl?.value;
      const selContract = state.contracts.find((c) => c.id === selId);
      if (selContract && selContract.clientRevisionComment && selContract.status === 'REVISION_REQUESTED') {
        freelancerRevisionBoxEl.hidden = false;
        freelancerRevisionBoxEl.innerHTML = `
          <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:0.25rem;">
            <strong style="color:#92400E;">📝 Yêu cầu Sửa đổi từ Khách hàng (Lần ${selContract.revisionsUsed}/${selContract.maxRevisions}):</strong>
            <span class="pill pill-amber">Cần sửa</span>
          </div>
          <div style="font-size:0.83rem;font-weight:700;color:var(--text-primary);background:#FFFFFF;padding:0.5rem 0.65rem;border-radius:var(--radius-sm);border:1px solid #FDE68A;margin:0.25rem 0;">
            "${selContract.clientRevisionComment}"
          </div>
          <div style="font-size:0.72rem;color:var(--text-secondary);">
            Vui lòng hoàn thiện mã nguồn theo đúng mô tả trên của khách hàng rồi nộp lại link GitHub &amp; commit mới bên dưới.
          </div>
        `;
      } else {
        freelancerRevisionBoxEl.hidden = true;
      }
    }

    if (evidenceContractSelectEl) {
      evidenceContractSelectEl.innerHTML = state.contracts
        .map((c) => `<option value="${c.id}">Mã HĐ: ${c.id} — ${c.title} (${c.status})</option>`)
        .join('');
    }

    if (freelancerContractsListEl) {
      freelancerContractsListEl.innerHTML = state.contracts
        .map(
          (c) => `
          <div class="contract-card" data-open-tx-popup="${c.id}">
            <div class="contract-header">
              <div>
                <div style="display:flex;align-items:center;gap:0.4rem;margin-bottom:0.2rem;">
                  <span class="pill pill-mono">Mã HĐ: ${c.id}</span>
                  <span class="contract-title">${c.title}</span>
                </div>
                <div class="contract-meta">Mã hợp đồng: <strong>${c.id}</strong> • Quỹ bảo đảm: <strong>${formatVND(c.amount)}</strong> • Bằng chứng: <strong>${(c.evidences || []).length} files</strong></div>
              </div>
              ${getStatusBadgeHtml(c.status)}
            </div>
            ${c.clientRevisionComment && c.status === 'REVISION_REQUESTED' ? `
              <div style="background:#FFFBEB;border:1px solid #FDE68A;border-radius:var(--radius-sm);padding:0.45rem 0.65rem;margin-top:0.35rem;font-size:0.75rem;">
                <strong style="color:#92400E;">📝 Mô tả Yêu cầu Sửa từ Khách hàng:</strong>
                <div style="color:var(--text-primary);font-weight:700;margin-top:0.15rem;">"${c.clientRevisionComment}"</div>
              </div>
            ` : ''}
            ${renderAgentAlertIfFailed(c)}
            ${renderMultiSigBar(c)}
          </div>`
        )
        .join('');
    }

  function buildLocalDisputeSettlement(contract, evaluationReport = null) {
    const frozenAmount = Math.max(0, Number(contract?.amount || 0) - Number(contract?.releasedSoFar || 0));
    if (!evaluationReport && contract?.latestVerification) {
      const v = contract.latestVerification;
      const freelancerPercent = v.isEmptyOrInvalid ? 0 : Math.max(0, Math.min(100, Math.round(Number(v.verifiedScore ?? 0))));
      const clientPercent = 100 - freelancerPercent;
      const freelancerAmount = Math.round((frozenAmount * freelancerPercent) / 100);
      const clientAmount = Math.max(0, frozenAmount - freelancerAmount);
      const breakdown = [
        ...(v.passedCriteria || []).map((name, i) => ({
          id: `PASS-${i + 1}`,
          metric: name,
          weightPercent: Math.round(freelancerPercent / Math.max(1, (v.passedCriteria || []).length)),
          status: 'PASSED',
          earnedPercent: Math.round(freelancerPercent / Math.max(1, (v.passedCriteria || []).length)),
          reason: `Đạt chuẩn (${name})`
        })),
        ...(v.failedCriteria || []).map((name, i) => ({
          id: `FAIL-${i + 1}`,
          metric: name,
          weightPercent: Math.round(clientPercent / Math.max(1, (v.failedCriteria || []).length)),
          status: 'FAILED',
          earnedPercent: 0,
          reason: name
        }))
      ];
      return {
        frozenAmount,
        productScorePercent: freelancerPercent,
        freelancerPercent,
        clientPercent,
        freelancerAmount,
        clientAmount,
        breakdown,
        testReportHash: v.testReportHash || contract?.proofHash || 'pending-hash'
      };
    }

    const ev = evaluationReport || {
      blocked: false,
      deterministicScore: contract?.ciVerified ? 100 : 0,
      deterministicResults: [
        {
          id: 'OBJ-01',
          metric: 'unit_test_pass_rate',
          passed: Boolean(contract?.ciVerified),
          weight: 100,
          actualValue: contract?.ciVerified ? 100 : 0,
          operator: '==',
          expectedValue: 100
        }
      ],
      pendingHitlCriteria: []
    };

    const totalDetWeight = (ev.deterministicResults || []).reduce((s, r) => s + (Number(r.weight) || 40), 0);
    const totalSubWeight = (ev.pendingHitlCriteria || []).reduce((s, r) => s + (Number(r.weight) || 20), 0);
    const totalW = totalDetWeight + totalSubWeight || 100;

    let earned = 0;
    const breakdown = [];
    for (const r of ev.deterministicResults || []) {
      const w = Math.round((((Number(r.weight) || 40) / totalW) * 100) * 100) / 100;
      const e = ev.blocked ? 0 : r.passed ? w : 0;
      earned += e;
      breakdown.push({
        id: r.id,
        metric: r.metric,
        weightPercent: w,
        status: ev.blocked ? 'BLOCKED' : r.passed ? 'PASSED' : 'FAILED',
        earnedPercent: e,
        reason: r.passed
          ? `Đạt chuẩn (${r.actualValue} ${r.operator} ${r.expectedValue})`
          : `Không đạt (${r.actualValue} vs ${r.operator} ${r.expectedValue})`
      });
    }
    for (const h of ev.pendingHitlCriteria || []) {
      const w = Math.round((((Number(h.weight) || 20) / totalW) * 100) * 100) / 100;
      const e = ev.blocked ? 0 : Math.round(w * 0.5 * 100) / 100;
      earned += e;
      breakdown.push({
        id: h.id,
        metric: 'SUBJECTIVE (HITL)',
        weightPercent: w,
        status: ev.blocked ? 'BLOCKED' : 'PENDING_HITL',
        earnedPercent: e,
        reason: h.description || 'Hòa giải 50% phần cảm quan (HITL)'
      });
    }

    const freelancerPercent = ev.blocked ? 0 : Math.max(0, Math.min(100, Math.round(earned * 100) / 100));
    const clientPercent = Math.round((100 - freelancerPercent) * 100) / 100;
    const freelancerAmount = Math.round((frozenAmount * freelancerPercent) / 100);
    const clientAmount = Math.max(0, frozenAmount - freelancerAmount);

    return {
      frozenAmount,
      productScorePercent: freelancerPercent,
      freelancerPercent,
      clientPercent,
      freelancerAmount,
      clientAmount,
      breakdown,
      testReportHash: ev.testReportHash || contract?.proofHash || 'pending-hash'
    };
  }

  function renderDisputeSettlementPanelHtml(contract, settlement) {
    const s = settlement || buildLocalDisputeSettlement(contract);
    const rows = (s.breakdown || [])
      .map(
        (b) => `
        <tr style="border-top:1px solid var(--border-color);">
          <td style="padding:0.35rem 0.45rem;font-family:var(--font-mono);font-size:0.74rem;">${b.id}${b.metric ? ` (${b.metric})` : ''}${b.isCritical ? ' <span class="pill pill-rose" style="font-size:0.64rem;">critical</span>' : ''}</td>
          <td style="padding:0.35rem 0.45rem;font-size:0.74rem;">${b.weightPercent}%</td>
          <td style="padding:0.35rem 0.45rem;">
            <span class="pill ${b.status === 'PASSED' ? 'pill-emerald' : b.status === 'PENDING_HITL' ? 'pill-amber' : 'pill-rose'}" style="font-size:0.68rem;">${b.status}</span>
          </td>
          <td style="padding:0.35rem 0.45rem;font-size:0.74rem;">${b.earnedPercent}% — ${b.reason || ''}</td>
        </tr>`
      )
      .join('');

    return `
      <div class="settlement-rec-box" data-settlement-contract="${contract.id}" style="margin-top:0.65rem;padding:0.75rem;border:1px solid var(--border-color);border-radius:var(--radius-sm);background:#F8FAFC;">
        <div style="display:flex;justify-content:space-between;align-items:center;gap:0.5rem;flex-wrap:wrap;margin-bottom:0.45rem;">
          <strong style="font-size:0.84rem;">⚖️ Khuyến nghị Phân bổ Quỹ Đóng Băng từ Agent</strong>
          <span class="pill pill-blue" style="font-size:0.72rem;">Điểm sản phẩm đạt chuẩn: ${s.productScorePercent}%</span>
        </div>
        <div style="display:grid;grid-template-columns:1fr 1fr;gap:0.5rem;margin-bottom:0.55rem;">
          <div style="background:#FFFFFF;border:1px solid var(--border-color);border-radius:6px;padding:0.5rem 0.65rem;">
            <div style="font-size:0.72rem;color:var(--text-secondary);">Freelancer nhận (${s.freelancerPercent}%)</div>
            <strong style="font-size:0.92rem;color:var(--accent-emerald);">${formatVND(s.freelancerAmount)}</strong>
          </div>
          <div style="background:#FFFFFF;border:1px solid var(--border-color);border-radius:6px;padding:0.5rem 0.65rem;">
            <div style="font-size:0.72rem;color:var(--text-secondary);">Hoàn trả Client (${s.clientPercent}%)</div>
            <strong style="font-size:0.92rem;color:var(--accent-blue);">${formatVND(s.clientAmount)}</strong>
          </div>
        </div>
        <div style="overflow-x:auto;margin-bottom:0.55rem;">
          <table style="width:100%;border-collapse:collapse;background:#FFFFFF;border:1px solid var(--border-color);border-radius:6px;">
            <thead>
              <tr style="background:var(--bg-secondary);font-size:0.72rem;text-align:left;">
                <th style="padding:0.35rem 0.45rem;">Tiêu chí</th>
                <th style="padding:0.35rem 0.45rem;">Trọng số</th>
                <th style="padding:0.35rem 0.45rem;">Trạng thái</th>
                <th style="padding:0.35rem 0.45rem;">Điểm &amp; Giải trình</th>
              </tr>
            </thead>
            <tbody>${rows}</tbody>
          </table>
        </div>
        <div style="display:flex;justify-content:space-between;align-items:center;gap:0.5rem;flex-wrap:wrap;">
          <span style="font-size:0.71rem;color:var(--text-muted);">Report Hash: <code>${String(s.testReportHash || '').slice(0, 18)}…</code></span>
          <button
            type="button"
            class="btn btn-primary btn-xs"
            data-sign-hitl-settlement="${contract.id}"
            data-client-percent="${Math.round(s.clientPercent)}"
          >
            ⚖️ Trọng tài Ký Phán quyết (HITL)
          </button>
        </div>
      </div>
    `;
  }

    if (arbiterDisputesListEl) {
      if (disputedContracts.length === 0) {
        arbiterDisputesListEl.innerHTML = `
          <div class="contract-card" style="text-align:center;color:var(--text-secondary);">
            ✓ Hiện không có hợp đồng nào bị đóng băng tranh chấp.
          </div>`;
      } else {
        arbiterDisputesListEl.innerHTML = disputedContracts
          .map(
            (c) => `
            <div class="contract-card" data-open-tx-popup="${c.id}">
              <div class="contract-header">
                <div>
                  <div style="display:flex;align-items:center;gap:0.4rem;margin-bottom:0.2rem;">
                    <span class="pill pill-mono">Mã HĐ: ${c.id}</span>
                    <span class="contract-title">⚖️ ${c.title}</span>
                  </div>
                  <div class="contract-meta">Mã hợp đồng: <strong>${c.id}</strong> • Seller: <strong>${c.freelancer}</strong> • Đóng băng: <strong>${formatVND(c.amount)}</strong></div>
                </div>
                ${getStatusBadgeHtml(c.status)}
              </div>
              ${renderAgentAlertIfFailed(c)}
              ${renderDisputeSettlementPanelHtml(c)}
              <div class="contract-subbox">
                <div style="margin-bottom:0.35rem;"><strong>File bằng chứng đã nhận (${(c.evidences || []).length} files):</strong></div>
                ${(c.evidences || [])
                  .map(
                    (ev) =>
                      `<div style="display:flex;justify-content:space-between;align-items:center;gap:0.5rem;flex-wrap:wrap;margin-top:0.35rem;padding:0.3rem 0;border-top:1px dashed var(--border-color);">
                        <div style="font-size:0.75rem;">
                          • <strong>[${ev.actor}] 📄 ${ev.fileName || 'evidence.dat'}</strong>
                          <span style="color:var(--text-muted);font-size:0.7rem;">(${ev.fileSizeKb || 120} KB • ${ev.time})</span>: ${ev.content}
                        </div>
                        <button
                          type="button"
                          class="btn btn-secondary btn-xs"
                          data-download-evidence="${ev.hash}"
                          data-contract-id="${c.id}"
                          title="Lưu file bằng chứng về máy tính của Arbiter"
                          style="display:inline-flex;align-items:center;gap:0.25rem;font-weight:700;"
                        >
                          💾 Lưu về máy
                        </button>
                      </div>`
                  )
                  .join('')}
              </div>
            </div>`
          )
          .join('');
      }
    }

    if (arbiterAllContractsListEl) {
      arbiterAllContractsListEl.innerHTML = state.contracts
        .map(
          (c) => `
          <div class="contract-card" data-open-tx-popup="${c.id}">
            <div class="contract-header">
              <div class="contract-title"><span class="pill pill-mono">Mã HĐ: ${c.id}</span> ${c.title} (${formatVND(c.amount)})</div>
              ${getStatusBadgeHtml(c.status)}
            </div>
            <div class="contract-meta">Mã hợp đồng: <strong>${c.id}</strong> • Đã đính kèm ${(c.evidences || []).length} file bằng chứng</div>
          </div>`
        )
        .join('');
    }

    const arbiterAllEvidencesListEl = document.getElementById('arbiter-all-evidences-list');
    const arbiterEvidenceCountBadgeEl = document.getElementById('arbiter-evidence-count-badge');
    if (arbiterAllEvidencesListEl) {
      const allEvidences = [];
      state.contracts.forEach((c) => {
        (c.evidences || []).forEach((ev) => {
          allEvidences.push({ ...ev, contractId: c.id, contractTitle: c.title });
        });
      });
      if (arbiterEvidenceCountBadgeEl) {
        arbiterEvidenceCountBadgeEl.textContent = `${allEvidences.length} file`;
      }
      if (allEvidences.length === 0) {
        arbiterAllEvidencesListEl.innerHTML = `
          <div style="text-align:center;color:var(--text-muted);font-size:0.75rem;padding:0.6rem;">
            Chưa có file bằng chứng nào được tải lên trên toàn sàn.
          </div>`;
      } else {
        arbiterAllEvidencesListEl.innerHTML = allEvidences
          .map((ev) => {
            const actorBadge = ev.actor.includes('CLIENT')
              ? 'pill-blue'
              : ev.actor.includes('FREELANCER')
              ? 'pill-emerald'
              : 'pill-purple';
            return `
            <div class="evidence-file-item" style="display:flex;align-items:center;justify-content:space-between;gap:0.75rem;margin-bottom:0.4rem;">
              <div style="flex:1;">
                <div style="display:flex;align-items:center;gap:0.4rem;margin-bottom:0.2rem;flex-wrap:wrap;">
                  <span class="pill pill-mono">${ev.contractId}</span>
                  <span class="pill ${actorBadge}">${ev.actor}</span>
                  <strong>📄 ${ev.fileName || 'evidence-file.dat'}</strong>
                  <span style="color:var(--text-muted);font-size:0.7rem;">(${ev.fileSizeKb || 120} KB • ${ev.time})</span>
                </div>
                <div style="color:var(--text-secondary);font-size:0.75rem;">${ev.content}</div>
              </div>
              <div style="display:flex;flex-direction:column;align-items:flex-end;gap:0.3rem;">
                <span class="pill pill-mono" style="font-size:0.67rem;">${ev.hash}</span>
                <button
                  type="button"
                  class="btn btn-secondary btn-xs"
                  data-download-evidence="${ev.hash}"
                  data-contract-id="${ev.contractId}"
                  style="display:inline-flex;align-items:center;gap:0.3rem;font-weight:700;"
                  title="Lưu file bằng chứng về máy tính của Arbiter"
                >
                  💾 Lưu về máy
                </button>
              </div>
            </div>`;
          })
          .join('');
      }
    }

    // Render Lịch sử Lệnh Nạp tiền của Client & Trạng thái duyệt
    if (clientTopupsHistoryListEl) {
      const topups = state.pendingTopups || [];
      if (clientTopupsCountBadgeEl) {
        clientTopupsCountBadgeEl.textContent = `${topups.length} lệnh`;
      }
      if (topups.length === 0) {
        clientTopupsHistoryListEl.innerHTML = `
          <div style="color:var(--text-muted);font-size:0.75rem;padding:0.4rem;text-align:center;">
            Chưa có lệnh nạp tiền nào.
          </div>`;
      } else {
        clientTopupsHistoryListEl.innerHTML = topups
          .map((t) => {
            const isApproved = t.status === 'APPROVED';
            const isRejected = t.status === 'REJECTED';
            const badge = isApproved
              ? '<span class="pill pill-emerald">✓ Đã nạp vào ví</span>'
              : isRejected
              ? '<span class="pill pill-rose">✕ Từ chối</span>'
              : '<span class="pill pill-amber">⏳ Chờ Arbiter duyệt</span>';
            const sub = isApproved
              ? `<span style="color:var(--accent-emerald);">Đã đối soát biến động số dư lúc ${t.approvedTime}</span>`
              : isRejected
              ? `<span style="color:var(--accent-rose);">${t.rejectReason || 'Không hợp lệ'}</span>`
              : `<span style="color:var(--accent-amber);">Đã quét QR MB 0000000000, chờ Arbiter xác nhận</span>`;

            return `
            <div style="display:flex;justify-content:space-between;align-items:center;padding:0.45rem 0.2rem;border-bottom:1px solid var(--border-color);font-size:0.76rem;gap:0.5rem;flex-wrap:wrap;">
              <div>
                <div>
                  <strong style="color:var(--text-primary);">[${t.id}]</strong>
                  <strong style="color:var(--accent-blue);margin-left:0.25rem;">${formatVND(t.amount)}</strong>
                  <span class="pill pill-mono" style="margin-left:0.3rem;">${t.memo}</span>
                </div>
                <div style="font-size:0.71rem;color:var(--text-secondary);margin-top:0.15rem;">
                  ${t.time} • ${sub}
                </div>
              </div>
              <div>${badge}</div>
            </div>`;
          })
          .join('');
      }
    }

    // Render Danh sách Lệnh Nạp Tiền Chờ Duyệt cho Arbiter (Chờ xác nhận để tiền vào ví)
    if (arbiterPendingTopupsListEl) {
      const topups = state.pendingTopups || [];
      const pendingCount = topups.filter((t) => t.status === 'PENDING_APPROVAL').length;
      if (arbiterPendingTopupsCountBadgeEl) {
        arbiterPendingTopupsCountBadgeEl.textContent = `${pendingCount} lệnh chờ duyệt`;
      }
      if (topups.length === 0) {
        arbiterPendingTopupsListEl.innerHTML = `
          <div class="contract-card" style="text-align:center;color:var(--text-secondary);font-size:0.78rem;">
            Hiện không có lệnh nạp tiền nào cần xử lý.
          </div>`;
      } else {
        arbiterPendingTopupsListEl.innerHTML = topups
          .map((t) => {
            const isPending = t.status === 'PENDING_APPROVAL';
            const statusBadge = t.status === 'APPROVED'
              ? `<span class="pill pill-emerald">✓ Đã duyệt lúc ${t.approvedTime}</span>`
              : t.status === 'REJECTED'
              ? `<span class="pill pill-rose">✕ Từ chối: ${t.rejectReason || 'Không hợp lệ'}</span>`
              : `<span class="pill pill-amber">⏳ Chờ Arbiter đối soát QR</span>`;

            const actionButtons = isPending
              ? `
              <div style="display:flex;gap:0.45rem;margin-top:0.45rem;flex-wrap:wrap;">
                <button type="button" class="btn btn-emerald btn-xs" data-approve-topup="${escapeHtml(t.id)}" style="font-weight:700;">
                  🏦 Mô phỏng Webhook Ngân hàng (VA) (+${formatVND(t.netCredited)})
                </button>
                <button type="button" class="btn btn-secondary btn-xs" data-reject-topup="${t.id}">
                  ✕ Từ chối Lệnh
                </button>
              </div>`
              : '';

            return `
            <div class="contract-card" style="margin-bottom:0.45rem;background:#FFFFFF;border:1px solid var(--border-color);">
              <div class="contract-header">
                <div>
                  <span class="pill pill-mono">${t.id}</span>
                  <strong style="font-size:0.82rem;margin-left:0.3rem;">Nạp ${formatVND(t.amount)}</strong>
                </div>
                ${statusBadge}
              </div>
              <div class="contract-subbox" style="font-size:0.74rem;line-height:1.55;">
                <div>• Tài khoản Client gửi: <strong>${t.clientAccount}</strong></div>
                <div>• Tài khoản nhận hệ thống: <strong>MB Quân Đội (0000000000 - NGUYEN VAN A)</strong></div>
                <div>• Nội dung chuyển khoản: <strong style="color:var(--accent-purple);font-family:var(--font-mono);">${t.memo}</strong></div>
                <div>• Thời gian gửi: <span>${t.time}</span></div>
              </div>
              ${actionButtons}
            </div>`;
          })
          .join('');
      }
    }

    if (reputationContainerEl) {
      const reps = [state.reputation.client, state.reputation.freelancer, state.reputation.arbiter];
      reputationContainerEl.innerHTML = reps
        .map(
          (r) => `
          <div class="contract-subbox" style="display:flex;justify-content:space-between;align-items:center;">
            <span><strong>${r.name}</strong> (${r.rating})</span>
            <span>Trust: <strong>${r.score}/100</strong> • KLGD: <strong>${formatVND(r.totalVolume)}</strong></span>
          </div>`
        )
        .join('');
    }

    if (ledgerCountPillEl) {
      ledgerCountPillEl.textContent = `${state.ledger.length} sự kiện`;
    }
    if (ledgerBodyEl) {
      ledgerBodyEl.innerHTML = state.ledger
        .map((tx) => {
          const rolePillClass =
            tx.role === 'CLIENT'
              ? 'pill-blue'
              : tx.role === 'FREELANCER'
              ? 'pill-emerald'
              : 'pill-purple';
          return `
          <div class="contract-card" data-open-tx-popup="${state.contracts[0]?.id || 'ESC-101'}">
            <div class="contract-header">
              <div>
                <span class="pill ${rolePillClass}">${tx.role}</span>
                <strong style="font-size:0.76rem;margin-left:0.3rem;">${tx.type}</strong>
              </div>
              <span class="pill pill-mono">${tx.auditHash || '0xverified'}</span>
            </div>
            <div class="contract-meta">${tx.detail}</div>
            <div style="display:flex;justify-content:space-between;font-size:0.71rem;color:var(--text-muted);">
              <span>Mã: ${tx.id} • ${tx.time}</span>
              <strong style="color:var(--text-primary);">${formatVND(tx.amount)}</strong>
            </div>
          </div>`;
        })
        .join('');
    }

    if (vaultSecurityPillEl) {
      if (state.vaultPaused) {
        vaultSecurityPillEl.className = 'pill pill-rose';
        vaultSecurityPillEl.textContent = '⛔ Circuit Breaker: TẠM DỪNG GIẢI NGÂN';
      } else {
        vaultSecurityPillEl.className = 'pill pill-emerald';
        vaultSecurityPillEl.textContent = '🔒 Multi-Sig 2-of-3 • Non-Custodial AI';
      }
    }

    if (btnArbiterCircuitBreaker) {
      btnArbiterCircuitBreaker.hidden = currentLoginRole !== 'arbiter';
      btnArbiterCircuitBreaker.textContent = state.vaultPaused
        ? '🔓 Mở lại Smart Vault'
        : '🛡️ Circuit Breaker: Đang mở';
      btnArbiterCircuitBreaker.className = state.vaultPaused
        ? 'btn btn-emerald btn-xs'
        : 'btn btn-secondary btn-xs';
    }

    bankDashboard?.render();

    // Render Vùng Thông báo Duyệt Tiền Nạp (VietQR Pro 24/7)
    renderTopupApprovalNotificationZone();

    if (activePopupContractId && txModal && !txModal.hidden) {
      openTransactionPopup(activePopupContractId);
    }
  }

  function renderTopupApprovalNotificationZone() {
    if (!topupNotificationZoneEl) return;

    // Freelancer không có vùng thông báo duyệt tiền nạp vào
    if (currentLoginRole === 'freelancer') {
      topupNotificationZoneEl.hidden = true;
      return;
    }
    topupNotificationZoneEl.hidden = false;

    const topups = state.pendingTopups || [];
    const pendingList = topups.filter((t) => t.status === 'PENDING_APPROVAL');
    const pendingCount = pendingList.length;

    if (notifyZoneCountBadgeEl) {
      notifyZoneCountBadgeEl.textContent = `${pendingCount} thông báo cần duyệt`;
      notifyZoneCountBadgeEl.style.display = pendingCount > 0 ? 'inline-flex' : 'none';
    }

    if (pendingCount > 0) {
      topupNotificationZoneEl.className = 'topup-notification-zone has-pending';
    } else {
      topupNotificationZoneEl.className = 'topup-notification-zone all-cleared';
    }

    if (topupNotificationRoleHintEl) {
      if (currentLoginRole === 'arbiter') {
        topupNotificationRoleHintEl.innerHTML = `
          ⚖️ <strong style="color:var(--text-primary);">QUYỀN TRỌNG TÀI (ARBITER):</strong>
          Bạn có thẩm quyền đối soát giao dịch VietQR MB Bank (<strong>0000000000 - NGUYEN VAN A</strong>).
          Hãy nhấn nút <strong>✓ Xác nhận Đã nhận tiền</strong> để ghi có số dư vào Segregated Vault cho Client.`;
      } else {
        topupNotificationRoleHintEl.innerHTML = `
          👤 <strong style="color:var(--text-primary);">CLIENT (BUYER):</strong>
          Yêu cầu nạp tiền của bạn đã gửi lên sàn và đang chờ Trọng tài đối soát biến động số dư VietQR.`;
      }
    }

    if (topupNotificationItemsContainerEl) {
      if (pendingCount === 0) {
        topupNotificationItemsContainerEl.innerHTML = `
          <div style="font-size:0.78rem;color:var(--text-secondary);padding:0.35rem 0;display:flex;align-items:center;gap:0.45rem;">
            <span style="color:var(--accent-emerald);font-weight:700;">✓</span>
            Hiện không có yêu cầu nạp tiền nào đang chờ duyệt. Tất cả giao dịch VietQR đã được xác nhận thành công.
          </div>`;
      } else {
        topupNotificationItemsContainerEl.innerHTML = pendingList
          .map((t) => {
            const isArbiter = currentLoginRole === 'arbiter';
            const actionHtml = isArbiter
              ? `
              <div style="display:flex;gap:0.4rem;align-items:center;flex-wrap:wrap;">
                <button type="button" class="btn btn-emerald btn-xs" data-approve-topup="${escapeHtml(t.id)}" style="font-weight:700;">
                  🏦 Mô phỏng Webhook Ngân hàng (VA) (+${formatVND(t.netCredited)})
                </button>
                <button type="button" class="btn btn-secondary btn-xs" data-reject-topup="${t.id}">
                  ✕ Từ chối Lệnh
                </button>
              </div>`
              : `
              <div style="display:flex;gap:0.4rem;align-items:center;flex-wrap:wrap;">
                <span class="pill pill-amber" style="font-weight:700;">⏳ Chờ Arbiter duyệt qua VietQR</span>
              </div>`;

            const kycInfo = t.kycLabel ? { label: t.kycLabel, requiresEnhancedReview: t.kycTier === 'TIER_2_ENHANCED_KYC' } : evaluateAmlKycTier(t.amount);
            const kycPill = `<span class="pill ${kycInfo.requiresEnhancedReview ? 'pill-amber' : 'pill-emerald'}">${kycInfo.label}</span>`;

            return `
            <div class="topup-notification-item">
              <div>
                <div style="display:flex;align-items:center;gap:0.4rem;flex-wrap:wrap;">
                  <span class="pill pill-mono" style="font-weight:700;">${t.id}</span>
                  <strong style="color:var(--accent-blue);font-size:0.95rem;">+${formatVND(t.amount)}</strong>
                  <span class="pill pill-blue">MB: 0000000000 • NGUYEN VAN A</span>
                  <span class="pill pill-mono" style="background:#F1F5F9;">Memo: ${t.memo}</span>
                  ${kycPill}
                </div>
                <div style="font-size:0.72rem;color:var(--text-secondary);margin-top:0.25rem;">
                  Nguồn nạp: <strong>${t.clientAccount}</strong> • Thời gian: ${t.time} • Phương thức: ${t.method}
                </div>
              </div>
              <div>${actionHtml}</div>
            </div>`;
          })
          .join('');
      }
    }
  }

  function switchLoginRole(role, bypassAuth = false) {
    if (role === 'arbiter' && !bypassAuth && currentLoginRole !== 'arbiter') {
      if (arbiterAuthModal) {
        if (arbiterPasswordInput) arbiterPasswordInput.value = '';
        if (arbiterAuthErrorEl) {
          arbiterAuthErrorEl.hidden = true;
          arbiterAuthErrorEl.textContent = '';
        }
        arbiterAuthModal.hidden = false;
        setTimeout(() => arbiterPasswordInput?.focus(), 50);
        return false;
      } else {
        const pwd = prompt('Vui lòng nhập Token xác thực Trọng tài (ARBITER_AUTH_TOKEN):');
        if (pwd === null) return false;
        return false;
      }
    }

    currentLoginRole = role || 'client';
    const loginBtns = document.querySelectorAll('[data-login-role]');
    loginBtns.forEach((b) => b.classList.toggle('active', b.getAttribute('data-login-role') === currentLoginRole));
    openFullscreenZone(null);
    renderAllTransactionUI();
    return true;
  }

  bankDashboard = createBankDashboard({
    openZone: openFullscreenZone,
    openContract: openTransactionPopup,
    getState: () => state,
    getRole: () => currentLoginRole
  });
  document.getElementById('bank-guide-shortcut')?.addEventListener('click', () => {
    if (nonTechOnboardingStripEl) {
      nonTechOnboardingStripEl.hidden = false;
      nonTechOnboardingStripEl.scrollIntoView({behavior:'smooth', block:'start'});
    }
  });

  // Khởi tạo giao diện & đồng bộ từ API
  renderAllTransactionUI();
  syncStateWithServer(false).then(() => renderAllTransactionUI());

  // 1. Sự kiện Chuyển đổi 3 Trạng thái Đăng nhập
  const loginRoleBtns = document.querySelectorAll('[data-login-role]');
  loginRoleBtns.forEach((btn) => {
    btn.addEventListener('click', () => {
      switchLoginRole(btn.getAttribute('data-login-role'));
    });
  });

  // 2. Sự kiện Bấm vào 1 trong 3 Nút Vùng Lớn -> Mở Toàn Màn Hình
  zoneLauncherGridEl?.addEventListener('click', (e) => {
    const btn = e.target.closest('[data-open-fullscreen-zone]');
    if (!btn) return;
    openFullscreenZone(btn.getAttribute('data-open-fullscreen-zone'));
  });

  stageBackBtn?.addEventListener('click', () => openFullscreenZone(null));
  backTo3ButtonsTopBtn?.addEventListener('click', () => openFullscreenZone(null));

  fullscreenQuickTabsEl?.addEventListener('click', (e) => {
    const btn = e.target.closest('[data-quick-zone]');
    if (!btn) return;
    openFullscreenZone(btn.getAttribute('data-quick-zone'));
  });

  // 3. Sự kiện Bấm vào Giao dịch -> Mở Popup Chi tiết Giao dịch & Tải File Bằng chứng
  document.addEventListener('click', async (e) => {
    const downloadBtn = e.target.closest('[data-download-evidence]');
    if (downloadBtn) {
      e.stopPropagation();
      const cId = downloadBtn.getAttribute('data-contract-id');
      const evHash = downloadBtn.getAttribute('data-download-evidence');
      const contract = state.contracts.find((c) => c.id === cId);
      if (!contract || !contract.evidences) return;
      const ev = contract.evidences.find(
        (item) => item.hash === evHash || item.id === evHash || item.fileName === evHash
      );
      if (!ev) return;

      downloadEvidenceFile(ev);

      if (popupEvidenceFeedbackEl && txModal && !txModal.hidden) {
        popupEvidenceFeedbackEl.hidden = false;
        popupEvidenceFeedbackEl.className = 'alert-box alert-success';
        popupEvidenceFeedbackEl.textContent = `✓ Đã lưu file bằng chứng "${ev.fileName}" về máy thành công!`;
      }
      return;
    }

    // Sự kiện Chuyển nhanh vai trò đăng nhập từ Vùng thông báo
    const switchRoleBtn = e.target.closest('[data-switch-role]');
    if (switchRoleBtn) {
      e.stopPropagation();
      const targetRole = switchRoleBtn.getAttribute('data-switch-role') || 'arbiter';
      switchLoginRole(targetRole);
      return;
    }

    // Sự kiện Arbiter xác nhận nạp tiền thành công từ mã VietQR MB
    const approveTopupBtn = e.target.closest('[data-approve-topup]');
    if (approveTopupBtn) {
      e.stopPropagation();
      const topupId = approveTopupBtn.getAttribute('data-approve-topup');
      const res = approveTopupByArbiter(state, topupId);
      if (res.ok) {
        await syncStateWithServer(true);
        renderAllTransactionUI();
        const successMsg = `✓ Đã xác nhận lệnh [${topupId}] thành công! ${formatVND(res.entry.netCredited)} đã được nạp vào Segregated Vault cho Client.`;
        if (topupNotificationFeedbackEl) {
          topupNotificationFeedbackEl.hidden = false;
          topupNotificationFeedbackEl.className = 'alert-box alert-success';
          topupNotificationFeedbackEl.textContent = successMsg;
        }
        if (arbiterTopupFeedbackEl) {
          arbiterTopupFeedbackEl.hidden = false;
          arbiterTopupFeedbackEl.className = 'alert-box alert-success';
          arbiterTopupFeedbackEl.textContent = successMsg;
        }
      } else {
        alert(res.error);
      }
      return;
    }

    // Sự kiện Arbiter từ chối lệnh nạp tiền
    const rejectTopupBtn = e.target.closest('[data-reject-topup]');
    if (rejectTopupBtn) {
      e.stopPropagation();
      const topupId = rejectTopupBtn.getAttribute('data-reject-topup');
      const reason = prompt('Nhập lý do từ chối lệnh nạp tiền:', 'Không nhận được tiền biến động số dư VietQR MB 0000000000');
      if (reason === null) return;
      const res = rejectTopupByArbiter(state, topupId, reason || 'Không nhận được tiền');
      if (res.ok) {
        await syncStateWithServer(true);
        renderAllTransactionUI();
        const rejectMsg = `✕ Đã từ chối lệnh nạp tiền [${topupId}].`;
        if (topupNotificationFeedbackEl) {
          topupNotificationFeedbackEl.hidden = false;
          topupNotificationFeedbackEl.className = 'alert-box alert-error';
          topupNotificationFeedbackEl.textContent = rejectMsg;
        }
        if (arbiterTopupFeedbackEl) {
          arbiterTopupFeedbackEl.hidden = false;
          arbiterTopupFeedbackEl.className = 'alert-box alert-error';
          arbiterTopupFeedbackEl.textContent = rejectMsg;
        }
      }
      return;
    }

    const card = e.target.closest('[data-open-tx-popup]');
    if (!card) return;
    openTransactionPopup(card.getAttribute('data-open-tx-popup'));
  });

  closeTxModalBtn?.addEventListener('click', () => {
    if (txModal) txModal.hidden = true;
  });

  if (btnToggleNotifyBody && topupNotificationBodyEl) {
    btnToggleNotifyBody.addEventListener('click', () => {
      const isHidden = topupNotificationBodyEl.hidden;
      topupNotificationBodyEl.hidden = !isHidden;
      btnToggleNotifyBody.textContent = isHidden ? 'Thu gọn ▲' : 'Mở rộng ▼';
    });
  }

  btnToggleOnboardingGuide?.addEventListener('click', () => {
    if (nonTechOnboardingStripEl) {
      nonTechOnboardingStripEl.hidden = !nonTechOnboardingStripEl.hidden;
    }
  });

  btnCloseOnboardingGuide?.addEventListener('click', () => {
    if (nonTechOnboardingStripEl) {
      nonTechOnboardingStripEl.hidden = true;
    }
  });

  btnArbiterCircuitBreaker?.addEventListener('click', async () => {
    if (currentLoginRole !== 'arbiter') return;
    const nextPaused = !state.vaultPaused;
    toggleVaultCircuitBreaker(state, nextPaused, 'Arbiter kích hoạt từ bảng điều khiển');
    await syncStateWithServer(true);
    renderAllTransactionUI();
  });

  // Sự kiện Xác thực Token Trọng tài qua Header (POST /api/auth/arbiter)
  if (arbiterAuthForm) {
    arbiterAuthForm.addEventListener('submit', async (e) => {
      e.preventDefault();
      const token = arbiterPasswordInput?.value || '';
      try {
        const authRes = await verifyArbiterTokenOnServer(token);
        if (authRes.ok) {
          if (arbiterAuthModal) arbiterAuthModal.hidden = true;
          switchLoginRole('arbiter', true);
        } else {
          if (arbiterAuthErrorEl) {
            arbiterAuthErrorEl.hidden = false;
            arbiterAuthErrorEl.textContent = authRes.error || 'Token Trọng tài không chính xác!';
          }
          arbiterPasswordInput?.focus();
        }
      } catch {
        if (arbiterAuthErrorEl) {
          arbiterAuthErrorEl.hidden = false;
          arbiterAuthErrorEl.textContent = 'Không thể kết nối máy chủ để xác thực Trọng tài.';
        }
      }
    });
  }

  btnCloseArbiterAuth?.addEventListener('click', () => {
    if (arbiterAuthModal) arbiterAuthModal.hidden = true;
  });

  btnCancelArbiterAuth?.addEventListener('click', () => {
    if (arbiterAuthModal) arbiterAuthModal.hidden = true;
  });

  arbiterAuthModal?.addEventListener('click', (e) => {
    if (e.target === arbiterAuthModal) arbiterAuthModal.hidden = true;
  });

  txModal?.addEventListener('click', (e) => {
    if (e.target === txModal) txModal.hidden = true;
  });

  txModalRoleActionsEl?.addEventListener('input', (e) => {
    if (e.target.id === 'popup-split-slider') {
      const buyerPct = Number(e.target.value);
      const label = document.getElementById('popup-split-label');
      if (label) label.textContent = `Hoàn ${buyerPct}% Client / Giải ngân ${100 - buyerPct}% Freelancer`;
    }
  });

  txModalRoleActionsEl?.addEventListener('click', async (e) => {
    const btn = e.target.closest('[data-popup-action]');
    if (!btn) return;
    if (e.target.id === 'btn-cancel-revision-form') {
      const revBox = document.getElementById('tx-revision-form-box');
      if (revBox) revBox.hidden = true;
      return;
    }
    if (e.target.id === 'btn-submit-revision-form') {
      const targetCId = e.target.getAttribute('data-id') || activePopupContractId;
      const revInput = document.getElementById('tx-revision-note-input');
      const customReason = (revInput?.value || '').trim() || 'Yêu cầu bổ sung tiêu chí nghiệm thu DoD';
      const res = requestContractRevision(state, targetCId, customReason);
      if (!res.ok) {
        alert(res.error);
        return;
      }
      await syncStateWithServer(true);
      renderAllTransactionUI();
      return;
    }

    const action = btn.getAttribute('data-popup-action');
    const cId = btn.getAttribute('data-id');
    const contract = state.contracts.find((item) => item.id === cId);
    if (!contract) return;

    if (action === 'client-release') {
      releasePartialMilestone(state, cId, 100);
    } else if (action === 'client-partial') {
      releasePartialMilestone(state, cId, 50);
    } else if (action === 'client-revision') {
      const revBox = document.getElementById('tx-revision-form-box');
      if (revBox) {
        revBox.hidden = !revBox.hidden;
        if (!revBox.hidden) {
          const revInput = document.getElementById('tx-revision-note-input');
          if (revInput) revInput.focus();
        }
        return;
      }
      requestContractRevision(state, cId, 'Yêu cầu bổ sung tiêu chí DoD');
    } else if (action === 'open-dispute') {
      const openRes = openDisputeWithEvidence(state, cId, { role: currentLoginRole });
      if (!openRes.ok) {
        alert(openRes.error);
        return;
      }
      let dossier;
      try {
        dossier = await callDynamicApi('/api/agents/fact-finding', 'POST', contract);
      } catch {
        dossier = runFactFindingBailiffAgent(contract);
      }
      contract.recommendedSellerPercent = dossier.recommendedSellerPercent;
      contract.recommendedBuyerPercent = dossier.recommendedBuyerPercent;
      contract.failedStepText = dossier.dossierSections.automatedTestAudit;
      if (dossier.recommendedSellerPercent === 0) {
        contract.aiRecommendation = buildConsistentAgentRecommendation({
          allObjectivePassed: false,
          passedCount: 0,
          totalCount: contract.latestVerification?.failedCriteria?.length || 1,
          failedReasons: contract.latestVerification?.failedCriteria || [dossier.dossierSections.automatedTestAudit]
        }).message;
      } else {
        contract.aiRecommendation = dossier.proposalStatement;
      }
      const proof = computeProofHashAndCid(`${cId}-dispute-${currentLoginRole}`);
      state.ledger.unshift({
        id: `EV-${Math.floor(1000 + Math.random() * 9000)}`,
        contractId: cId,
        time: new Date().toLocaleTimeString('vi-VN'),
        role: currentLoginRole.toUpperCase(),
        type: 'Mở Tranh chấp & Đóng băng Vault',
        detail: `[${cId}] Freeze Vault (Hạn xử lý: 7 ngày) • Khuyến nghị: ${dossier.proposalStatement}`,
        amount: contract.amount,
        auditHash: proof.auditHash
      });
    } else if (action === 'seller-sign') {
      contract.signatures.freelancer = true;
    } else if (action === 'arbiter-ai-bailiff') {
      const recBuyerPct = Number(btn.getAttribute('data-buyer-percent') ?? contract.recommendedBuyerPercent ?? 100);
      const r = resolveDisputeByArbiter(state, cId, 'CUSTOM_SPLIT', recBuyerPct, { role: currentLoginRole });
      if (!r.ok) { alert(r.error); return; }
    } else if (action === 'arbiter-custom-split') {
      const slider = document.getElementById('popup-split-slider');
      const pct = slider ? Number(slider.value) : 35;
      const r = resolveDisputeByArbiter(state, cId, 'CUSTOM_SPLIT', pct, { role: currentLoginRole });
      if (!r.ok) { alert(r.error); return; }
    } else if (action === 'arbiter-release') {
      const r = resolveDisputeByArbiter(state, cId, 'RELEASE_FREELANCER', 0, { role: currentLoginRole });
      if (!r.ok) { alert(r.error); return; }
    } else if (action === 'arbiter-refund') {
      const r = resolveDisputeByArbiter(state, cId, 'REFUND_CLIENT', 100, { role: currentLoginRole });
      if (!r.ok) { alert(r.error); return; }
    }

    await syncStateWithServer(true);
    renderAllTransactionUI();
  });

  // Upload File Bằng chứng trong Popup
  if (popupEvidenceForm) {
    popupEvidenceForm.addEventListener('submit', async (e) => {
      e.preventDefault();
      if (!activePopupContractId) return;

      const actorLabel =
        currentLoginRole === 'client'
          ? 'CLIENT (Buyer)'
          : currentLoginRole === 'freelancer'
          ? 'FREELANCER (Seller)'
          : 'ARBITER (Trọng tài)';
      const note = (popupEvidenceNoteInput?.value || '').trim();
      const files = popupEvidenceFileInput?.files;

      if (!files || files.length === 0) {
        if (popupEvidenceFeedbackEl) {
          popupEvidenceFeedbackEl.hidden = false;
          popupEvidenceFeedbackEl.className = 'alert-box alert-error';
          popupEvidenceFeedbackEl.textContent = '✖ Chưa có file bằng chứng nào được chọn. Vui lòng đính kèm ít nhất 1 file!';
        }
        return;
      }

      for (let i = 0; i < files.length; i++) {
        const f = files[i];
        let dataUrl = null;
        try {
          dataUrl = await new Promise((resolve) => {
            const reader = new FileReader();
            reader.onload = () => resolve(reader.result);
            reader.onerror = () => resolve(null);
            reader.readAsDataURL(f);
          });
        } catch {
          dataUrl = null;
        }

        submitDisputeEvidence(state, activePopupContractId, actorLabel, note, {
          fileName: f.name,
          fileSizeKb: Math.max(1, Math.round(f.size / 1024)),
          fileType: f.type || 'application/octet-stream',
          dataUrl
        });
      }

      if (popupEvidenceFileInput) popupEvidenceFileInput.value = '';
      if (popupEvidenceNoteInput) popupEvidenceNoteInput.value = '';
      await syncStateWithServer(true);
      renderAllTransactionUI();

      if (popupEvidenceFeedbackEl) {
        popupEvidenceFeedbackEl.hidden = false;
        popupEvidenceFeedbackEl.className = 'alert-box alert-success';
        popupEvidenceFeedbackEl.textContent = `✓ Đã tải File Bằng chứng lên thành công!`;
      }
    });
  }

  // Các Form Nghiệp vụ trong từng Vùng
  const contractAmountInput = document.getElementById('contract-amount-input');
  const contractFeePayerInput = document.getElementById('contract-fee-payer-input');
  const previewGrossEl = document.getElementById('preview-gross');
  const previewFeeEl = document.getElementById('preview-fee');
  const previewNetEl = document.getElementById('preview-net');

  function updateContractFeePreview() {
    const payer = contractFeePayerInput?.value || 'FREELANCER';
    const feeInfo = calculateFeeBreakdown(contractAmountInput?.value || 0, 'Escrow', 'VND', payer);
    if (previewGrossEl) previewGrossEl.textContent = formatVND(feeInfo.clientPays);
    if (previewFeeEl) previewFeeEl.textContent = formatVND(feeInfo.totalFee);
    if (previewNetEl) previewNetEl.textContent = formatVND(feeInfo.netPayout);
  }

  contractAmountInput?.addEventListener('input', updateContractFeePreview);
  contractFeePayerInput?.addEventListener('change', updateContractFeePreview);

  const topupForm = document.getElementById('topup-form');
  const topupAccountInput = document.getElementById('topup-account-input');
  const amountInput = document.getElementById('topup-amount');
  const methodSelect = document.getElementById('topup-method');
  const topupFeedbackEl = document.getElementById('topup-feedback');
  const presetBtns = document.querySelectorAll('[data-preset-amount]');
  const confirmModal = document.getElementById('confirm-modal');
  const modalAccountEl = document.getElementById('modal-account');
  const modalAmountEl = document.getElementById('modal-amount');
  const modalMethodEl = document.getElementById('modal-method');
  const modalFeeEl = document.getElementById('modal-fee');
  const modalCancelBtn = document.getElementById('modal-cancel');
  const modalConfirmBtn = document.getElementById('modal-confirm');

  let pendingTopup = null;

  presetBtns.forEach((btn) => {
    btn.addEventListener('click', () => {
      if (amountInput) {
        amountInput.value = btn.getAttribute('data-preset-amount');
        if (topupFeedbackEl) topupFeedbackEl.hidden = true;
      }
    });
  });

  if (topupForm) {
    topupForm.addEventListener('submit', (e) => {
      e.preventDefault();
      const accountNumber = (topupAccountInput?.value || '').trim();
      if (!accountNumber) {
        if (topupFeedbackEl) {
          topupFeedbackEl.hidden = false;
          topupFeedbackEl.className = 'alert-box alert-error';
          topupFeedbackEl.textContent = '✖ Vui lòng nhập số tài khoản ngân hàng hoặc địa chỉ ví nạp tiền.';
        }
        return;
      }

      const result = validateTopupAmount(amountInput?.value);
      if (!result.valid) {
        if (topupFeedbackEl) {
          topupFeedbackEl.hidden = false;
          topupFeedbackEl.className = 'alert-box alert-error';
          topupFeedbackEl.textContent = `✖ ${result.error}`;
        }
        return;
      }

      const method = methodSelect?.value || 'VietQR Pro 24/7 (Fiat - 0% Fee)';
      const gatewayFee = /VietQR/i.test(method) ? 0 : 15000;
      const nextSeq = 101 + ((state.pendingTopups || []).length);
      const memoCode = `NAP ESCROW TOPUP-${nextSeq}`;
      pendingTopup = { amount: result.amount, formatted: result.formatted, method, gatewayFee, accountNumber, memoCode };

      if (topupFeedbackEl) topupFeedbackEl.hidden = true;
      if (modalAccountEl) modalAccountEl.textContent = pendingTopup.accountNumber;
      if (modalAmountEl) modalAmountEl.textContent = pendingTopup.formatted;
      if (modalMethodEl) modalMethodEl.textContent = pendingTopup.method;
      if (modalFeeEl) {
        modalFeeEl.textContent = gatewayFee === 0 ? '0 ₫ (Miễn phí)' : `${formatVND(gatewayFee)} (Gas / Gateway)`;
      }
      if (modalQrAmountEl) modalQrAmountEl.textContent = pendingTopup.formatted;
      if (modalQrMemoEl) modalQrMemoEl.textContent = pendingTopup.memoCode;
      if (confirmModal) confirmModal.hidden = false;
    });
  }

  modalCancelBtn?.addEventListener('click', () => {
    if (confirmModal) confirmModal.hidden = true;
  });

  modalConfirmBtn?.addEventListener('click', async () => {
    if (confirmModal) confirmModal.hidden = true;
    if (!pendingTopup) return;

    // Gửi yêu cầu nạp tiền qua mã VietQR MB của hệ thống (lấy mã TOPUP duy nhất từ server nếu có)
    let serverTopupId;
    try {
      const idRes = await callDynamicApi('/api/topups/id', 'POST');
      if (idRes?.topupId) serverTopupId = idRes.topupId;
    } catch {
      // Fallback sang crypto.randomUUID() cục bộ
    }
    const result = submitClientTopup(state, {
      accountNumber: pendingTopup.accountNumber,
      amount: pendingTopup.amount,
      method: pendingTopup.method,
      topupId: serverTopupId
    });

    if (result.ok) {
      await syncStateWithServer(true);
      renderAllTransactionUI();
      if (topupFeedbackEl) {
        topupFeedbackEl.hidden = false;
        topupFeedbackEl.className = 'alert-box alert-warning';
        topupFeedbackEl.innerHTML = `
          <div><strong>⏳ Đã gửi Lệnh Nạp Tiền [${result.entry.id}] (${result.entry.formatted})!</strong></div>
          <div style="margin-top:0.3rem;">Vui lòng chuyển khoản đúng số tiền tới mã VietQR <strong>MB: 0000000000 — NGUYEN VAN A</strong> (Nội dung: <code>${result.entry.memo}</code>).</div>
          <div style="margin-top:0.3rem;font-size:0.75rem;color:var(--text-secondary);">Hệ thống đã gửi thông báo đối soát tới <strong>Trọng tài (Arbiter)</strong>. Tiền sẽ được nạp vào Segregated Vault ngay sau khi Arbiter xác nhận biến động số dư thành công.</div>
        `;
      }
    }
  });

  // CLIENT VÙNG 3: Khởi tạo Hợp đồng + Nút Tạo hợp đồng mới bên cạnh & Mã hợp đồng
  const createContractForm = document.getElementById('create-contract-form');
  const contractCodeInput = document.getElementById('contract-code-input');
  const contractTitleInput = document.getElementById('contract-title-input');
  const contractFreelancerInput = document.getElementById('contract-freelancer-input');
  const contractMilestonesInput = document.getElementById('contract-milestones-input');
  const contractInspectionInput = document.getElementById('contract-inspection-input');
  const contractCriteriaInput = document.getElementById('contract-criteria-input');
  const contractSigInput = document.getElementById('contract-sig-input');
  const clientContractFeedbackEl = document.getElementById('client-contract-feedback');
  const refineCriteriaBtn = document.getElementById('btn-refine-criteria');
  const refinedComparisonBoxEl = document.getElementById('refined-criteria-comparison-box');
  const newContractBesideBtn = document.getElementById('btn-new-contract-beside');
  const resetNewContractBtn = document.getElementById('btn-reset-new-contract');
  const jumpNewContractBtn = document.getElementById('btn-jump-new-contract');

  function prepareNewContractForm() {
    const nextCode = `ESC-${101 + state.contracts.length}`;
    if (contractCodeInput) contractCodeInput.value = nextCode;
    if (contractTitleInput) {
      contractTitleInput.value = '';
      contractTitleInput.placeholder = 'Nhập tên hợp đồng mới...';
      contractTitleInput.focus();
    }
    if (contractAmountInput) contractAmountInput.value = '3000000';
    if (contractCriteriaInput) {
      contractCriteriaInput.value = 'API chạy nhanh\nCode không lỗi\nGiao diện đẹp';
    }
    if (clientContractFeedbackEl) clientContractFeedbackEl.hidden = true;
    if (clientAgentFailureBoxEl) clientAgentFailureBoxEl.hidden = true;
    if (refinedComparisonBoxEl) refinedComparisonBoxEl.hidden = true;
  }

  refineCriteriaBtn?.addEventListener('click', async () => {
    const contractTitle = (contractTitleInput?.value || '').trim() || 'Xây dựng API Thanh toán & Tích hợp Webhook';
    const rawLines = String(contractCriteriaInput?.value || '')
      .split(/\r?\n|;/)
      .map((s) => s.trim())
      .filter(Boolean);
    const rawCriteria = rawLines.length > 0 ? rawLines : ['API chạy nhanh', 'Code không lỗi', 'Giao diện đẹp'];

    const origBtnText = refineCriteriaBtn.textContent;
    refineCriteriaBtn.disabled = true;
    refineCriteriaBtn.textContent = '⏳ Agent đang chuẩn hóa...';
    if (refinedComparisonBoxEl) {
      refinedComparisonBoxEl.hidden = false;
      refinedComparisonBoxEl.innerHTML = '<div>⏳ AI Agent đang đối chiếu Historical Baselines và chuẩn hóa tiêu chí nghiệm thu...</div>';
    }

    try {
      let data;
      try {
        data = await callDynamicApi('/api/agreements/refine-criteria', 'POST', { contractTitle, rawCriteria });
      } catch {
        data = {
          contractTitle,
          totalWeight: 100,
          criteria: rawCriteria.map((text, idx) => ({
            id: `OBJ-0${idx + 1}`,
            originalText: text,
            type: /đẹp|giao diện/i.test(text) ? 'SUBJECTIVE' : 'DETERMINISTIC',
            metric: /nhanh/i.test(text) ? 'api_latency_ms' : (/đẹp|giao diện/i.test(text) ? null : 'unit_test_pass_rate'),
            operator: /nhanh/i.test(text) ? '<=' : (/đẹp|giao diện/i.test(text) ? null : '=='),
            expectedValue: /nhanh/i.test(text) ? 250 : (/đẹp|giao diện/i.test(text) ? null : 100),
            requiresHitl: /đẹp|giao diện/i.test(text),
            weight: idx === rawCriteria.length - 1 ? 100 - Math.floor(100 / rawCriteria.length) * (rawCriteria.length - 1) : Math.floor(100 / rawCriteria.length),
            clarifiedDescription: /nhanh/i.test(text)
              ? 'Thời gian phản hồi API đạt api_latency_ms <= 250ms'
              : (/đẹp|giao diện/i.test(text) ? `Đánh giá cảm quan (HITL): ${text}` : 'Tỷ lệ vượt qua kiểm thử tự động đạt unit_test_pass_rate == 100%')
          }))
        };
      }

      const items = Array.isArray(data?.criteria) ? data.criteria : [];
      if (!refinedComparisonBoxEl) return;

      const rowsHtml = items
        .map((c, idx) => {
          const metricBadge = c.type === 'DETERMINISTIC'
            ? `<span class="pill pill-emerald" style="font-size:0.7rem;">DETERMINISTIC: ${c.metric} ${c.operator} ${c.expectedValue}</span>`
            : `<span class="pill pill-amber" style="font-size:0.7rem;">SUBJECTIVE (HITL duyệt tay)</span>`;
          return `
            <tr style="border-top:1px solid var(--border-color);">
              <td style="padding:0.5rem;vertical-align:top;width:34%;font-size:0.8rem;color:var(--text-secondary);">
                <strong>#${idx + 1}.</strong> "${c.originalText}"
              </td>
              <td style="padding:0.5rem;vertical-align:top;">
                <div style="display:flex;justify-content:space-between;align-items:center;gap:0.4rem;margin-bottom:0.3rem;flex-wrap:wrap;">
                  ${metricBadge}
                  <label style="font-size:0.75rem;display:inline-flex;align-items:center;gap:0.25rem;">
                    Trọng số (%):
                    <input type="number" class="form-input refined-weight-input" data-idx="${idx}" value="${c.weight}" min="1" max="100" style="width:64px;padding:0.15rem 0.35rem;min-height:28px;font-size:0.78rem;" />
                  </label>
                </div>
                <input type="text" class="form-input refined-desc-input" data-idx="${idx}" data-metric="${c.type === 'DETERMINISTIC' ? `${c.metric} ${c.operator} ${c.expectedValue}` : 'HITL'}" value="${String(c.clarifiedDescription || '').replace(/"/g, '&quot;')}" style="font-size:0.8rem;padding:0.3rem 0.5rem;min-height:32px;" />
              </td>
            </tr>
          `;
        })
        .join('');

      refinedComparisonBoxEl.innerHTML = `
        <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:0.45rem;flex-wrap:wrap;gap:0.4rem;">
          <strong style="font-size:0.84rem;">🪄 Bảng đối chiếu Chuẩn hóa Tiêu chí (RAG Historical Baselines)</strong>
          <span class="pill pill-blue" style="font-size:0.72rem;">Tổng trọng số: 100%</span>
        </div>
        <div style="overflow-x:auto;">
          <table style="width:100%;border-collapse:collapse;background:#fff;border:1px solid var(--border-color);border-radius:6px;">
            <thead>
              <tr style="background:var(--bg-secondary);font-size:0.75rem;text-align:left;">
                <th style="padding:0.45rem 0.5rem;">Tiêu chí gốc (Mơ hồ)</th>
                <th style="padding:0.45rem 0.5rem;">Tiêu chí Agent đề xuất sửa (Đo lường được + Metric + Trọng số %)</th>
              </tr>
            </thead>
            <tbody>${rowsHtml}</tbody>
          </table>
        </div>
        <div style="margin-top:0.55rem;display:flex;justify-content:flex-end;gap:0.5rem;">
          <button type="button" class="btn btn-primary btn-xs" id="btn-apply-refined-table">
            ✓ Áp dụng vào Tiêu chí Nghiệm thu trước khi Khóa Baseline
          </button>
        </div>
      `;

      document.getElementById('btn-apply-refined-table')?.addEventListener('click', () => {
        const descInputs = [...refinedComparisonBoxEl.querySelectorAll('.refined-desc-input')];
        const weightInputs = [...refinedComparisonBoxEl.querySelectorAll('.refined-weight-input')];
        const combined = descInputs.map((el, i) => {
          const w = Number(weightInputs[i]?.value || 0);
          const metricTag = el.getAttribute('data-metric') || '';
          return `[${w}% | ${metricTag}] ${el.value.trim()}`;
        });
        if (contractCriteriaInput && combined.length > 0) {
          contractCriteriaInput.value = combined.join('\n');
        }
        if (clientAgentFailureBoxEl) clientAgentFailureBoxEl.hidden = true;
        if (clientContractFeedbackEl) {
          clientContractFeedbackEl.hidden = false;
          clientContractFeedbackEl.className = 'alert-box alert-success';
          clientContractFeedbackEl.textContent = '✓ Đã áp dụng bộ tiêu chí nghiệm thu chuẩn hóa (Tổng trọng số 100%). Bạn có thể ký kết hợp đồng ngay.';
        }
      });
    } finally {
      refineCriteriaBtn.disabled = false;
      refineCriteriaBtn.textContent = origBtnText;
    }
  });

  newContractBesideBtn?.addEventListener('click', prepareNewContractForm);
  resetNewContractBtn?.addEventListener('click', prepareNewContractForm);
  jumpNewContractBtn?.addEventListener('click', () => {
    openFullscreenZone('view-client-zone-3');
    prepareNewContractForm();
  });

  if (createContractForm) {
    createContractForm.addEventListener('submit', async (e) => {
      e.preventDefault();
      const customCode = (contractCodeInput?.value || '').trim().toUpperCase();
      const title = (contractTitleInput?.value || '').trim();
      const freelancer = contractFreelancerInput?.value || 'Minh Tuấn (Fullstack Dev)';
      const rawCriteria = (contractCriteriaInput?.value || '').trim();
      const validation = validateTopupAmount(contractAmountInput?.value);

      // 1. Kiểm tra tính hợp lệ và ý nghĩa của tên hợp đồng (Agent Tầng 1: không là ký hiệu linh tinh)
      const titleValidation = validateContractTitle(title);
      if (!titleValidation.valid) {
        if (clientContractFeedbackEl) {
          clientContractFeedbackEl.hidden = false;
          clientContractFeedbackEl.className = 'alert-box alert-error';
          clientContractFeedbackEl.textContent = `✖ Tên hợp đồng không hợp lệ: ${titleValidation.error}`;
        }
        if (clientAgentFailureBoxEl) {
          clientAgentFailureBoxEl.hidden = false;
          clientAgentFailureBoxEl.innerHTML = `
            <div><strong>⚠️ Tên Hợp đồng không hợp lệ (Agent Tầng 1):</strong> "${title || 'Trống'}" — ${titleValidation.error}</div>
            <div style="margin-top:0.25rem;"><strong>💡 Khuyến nghị của AI Agent:</strong> Đặt tên hợp đồng mô tả công việc cụ thể (ví dụ: <code>Phát triển API thanh toán VietQR</code>, <code>Thiết kế hệ thống White UI</code>).</div>
          `;
        }
        return;
      }

      if (!validation.valid || validation.amount > state.clientBalance) {
        if (clientContractFeedbackEl) {
          clientContractFeedbackEl.hidden = false;
          clientContractFeedbackEl.className = 'alert-box alert-error';
          clientContractFeedbackEl.textContent = `✖ ${validation.error || 'Số dư không đủ.'}`;
        }
        return;
      }

      const submitBtn = createContractForm.querySelector('button[type="submit"]');
      const originalBtnHtml = submitBtn ? submitBtn.innerHTML : '';
      if (submitBtn) {
        submitBtn.disabled = true;
        submitBtn.textContent = '⏳ Agent đang phân tích...';
      }
      if (clientAgentFailureBoxEl) clientAgentFailureBoxEl.hidden = true;
      if (clientContractFeedbackEl) {
        clientContractFeedbackEl.hidden = false;
        clientContractFeedbackEl.className = 'alert-box';
        clientContractFeedbackEl.textContent = '⏳ AI Agent đang phân tích hợp đồng và chuẩn hóa tiêu chí nghiệm thu...';
      }

      try {
        // Kiểm tra xem tiêu chí nghiệm thu có định lượng (số %, ms, màn hình, schema...) hay đang mơ hồ ("đẹp, mượt")
        const hasMeasurableMetric = /\d+|%|ms|figma|schema|coverage|hash/i.test(rawCriteria);
        if (!hasMeasurableMetric) {
          let decomp;
          try {
            decomp = await callDynamicApi('/api/agents/scope-decompose', 'POST', { brief: title });
          } catch {
            decomp = runScopeDecomposerAgent(title);
          }

          if (clientContractFeedbackEl) clientContractFeedbackEl.hidden = true;
          if (clientAgentFailureBoxEl) {
            const recommendedCriteria = 'Coverage > 80%, API /api/payment < 200ms, Xuất đủ 5 màn hình Figma chuẩn';
            clientAgentFailureBoxEl.hidden = false;
            clientAgentFailureBoxEl.innerHTML = `
              <div><strong>⚠️ Không đạt bước Kiểm tra Tiêu chí Nghiệm thu (Brief mơ hồ):</strong> Tiêu chí <em>"${rawCriteria || 'Trống'}"</em> thiếu thông số kỹ thuật định lượng, dễ dẫn đến tranh chấp.</div>
              <div style="margin-top:0.25rem;"><strong>💡 Khuyến nghị của AI Agent:</strong> Chuẩn hóa thành Checklist định lượng: <code>${recommendedCriteria}</code> (Hash: <code>${decomp.checklistHash}</code>).</div>
              <div style="margin-top:0.45rem;">
                <button type="button" class="btn btn-primary btn-xs" id="btn-apply-agent-criteria" data-rec="${recommendedCriteria}">
                  ✓ Áp dụng Khuyến nghị của Agent &amp; Tiếp tục
                </button>
              </div>
            `;
            document.getElementById('btn-apply-agent-criteria')?.addEventListener('click', () => {
              if (contractCriteriaInput) contractCriteriaInput.value = recommendedCriteria;
              clientAgentFailureBoxEl.hidden = true;
            });
          }
          return;
        }

        let decomp;
        try {
          decomp = await callDynamicApi('/api/agents/scope-decompose', 'POST', { brief: title });
        } catch {
          decomp = runScopeDecomposerAgent(title);
        }

        const [inspDays, maxRev] = (contractInspectionInput?.value || '3|3').split('|').map(Number);
        const milestoneCount = Number(contractMilestonesInput?.value || 2);
        const sigType = contractSigInput?.value || 'EIP-712 Wallet Sig';
        const feePayer = contractFeePayerInput?.value || 'FREELANCER';
        const feePreview = calculateFeeBreakdown(validation.amount, 'Escrow', 'VND', feePayer);
        const newId = customCode && !state.contracts.some((c) => c.id === customCode)
          ? customCode
          : `ESC-${101 + state.contracts.length}`;

        state.clientBalance -= feePreview.clientPays;
        state.reputation.client.totalVolume += feePreview.clientPays;

        state.contracts.unshift({
          id: newId,
          title,
          freelancer,
          amount: validation.amount,
          feePayer,
          releasedSoFar: 0,
          status: 'IN_PROGRESS',
          vaultAddress: `0xVault${101 + state.contracts.length}...${decomp.onChainAnchorTx.slice(2, 6).toUpperCase()}`,
          acceptanceCriteria: rawCriteria,
          signatureScheme: `${sigType} (${decomp.onChainAnchorTx})`,
          signatures: { client: true, freelancer: false, arbiter: false },
          milestones: buildContractMilestones(validation.amount, milestoneCount),
          inspectionDays: inspDays,
          timelockRemaining: `${inspDays} ngày sau khi nộp`,
          revisionsUsed: 0,
          maxRevisions: maxRev,
          deliverableUrl: '',
          commitHash: '',
          deliverableNote: '',
          proofHash: decomp.checklistHash,
          ipfsCid: '',
          ciVerified: true,
          failedStepText: null,
          aiRecommendation: null,
          vaultFrozen: false,
          disputeReason: null,
          evidences: []
        });

        state.ledger.unshift({
          id: `EV-${Math.floor(1000 + Math.random() * 9000)}`,
          contractId: newId,
          time: new Date().toLocaleTimeString('vi-VN'),
          role: 'CLIENT',
          type: 'Khởi tạo Hợp đồng & Khóa Vault',
          detail: `Mã HĐ [${newId}] "${title}" (${validation.formatted} • Bên chịu phí: ${feePayer})`,
          amount: feePreview.clientPays,
          auditHash: decomp.onChainAnchorTx
        });

        if (contractCodeInput) {
          contractCodeInput.value = `ESC-${101 + state.contracts.length}`;
        }

        await syncStateWithServer(true);
        renderAllTransactionUI();
        if (clientContractFeedbackEl) {
          clientContractFeedbackEl.hidden = false;
          clientContractFeedbackEl.className = 'alert-box alert-success';
          clientContractFeedbackEl.textContent = `✓ Đã khởi tạo hợp đồng Mã [${newId}] và khóa ${validation.formatted} vào Multi-Sig Vault!`;
        }
      } finally {
        if (submitBtn) {
          submitBtn.disabled = false;
          submitBtn.innerHTML = originalBtnHtml;
        }
      }
    });
  }

  // FREELANCER VÙNG 1: Nộp Bàn giao
  // Chạy API kiểm thử ngầm; nếu Pass 100% -> chỉ báo thành công gọn gàng. Nếu KHÔNG PASS ở bước nào -> mới hiện thông báo bước lỗi & khuyến nghị của Agent!
  const freelancerSubmitForm = document.getElementById('freelancer-submit-form');
  const deliverableUrlInput = document.getElementById('freelancer-deliverable-url');
  const commitInput = document.getElementById('freelancer-commit-input');
  const simScenarioSelect = document.getElementById('freelancer-sim-scenario');
  const deliverableNoteInput = document.getElementById('freelancer-deliverable-note');
  const freelancerSubmitFeedbackEl = document.getElementById('freelancer-submit-feedback');
  const verifyGithubMilestoneBtn = document.getElementById('btn-verify-github-milestone');
  const githubVerificationReportBoxEl = document.getElementById('github-verification-report-box');
  let lastVerifiedGithubKey = null;
  let lastVerifiedGithubReport = null;

  verifyGithubMilestoneBtn?.addEventListener('click', async () => {
    const contractId = freelancerSelectEl?.value || state.contracts[0]?.id || 'ESC-101';
    const contract = state.contracts.find((c) => c.id === contractId);
    const repoUrl = (deliverableUrlInput?.value || '').trim();
    const commitSha = (commitInput?.value || '').trim() || 'HEAD';

    if (!isValidGitHubUrl(repoUrl)) {
      lastVerifiedGithubKey = null;
      lastVerifiedGithubReport = null;
      if (freelancerSubmitFeedbackEl) {
        freelancerSubmitFeedbackEl.hidden = false;
        freelancerSubmitFeedbackEl.className = 'alert-box alert-error';
        freelancerSubmitFeedbackEl.textContent = `✖ Link "${repoUrl}" không phải định dạng GitHub hợp lệ (https://github.com/owner/repo).`;
      }
      return;
    }

    const origBtnText = verifyGithubMilestoneBtn.textContent;
    verifyGithubMilestoneBtn.disabled = true;
    verifyGithubMilestoneBtn.textContent = '⏳ Agent đang kiểm tra GitHub...';

    if (githubVerificationReportBoxEl) {
      githubVerificationReportBoxEl.hidden = false;
      githubVerificationReportBoxEl.innerHTML =
        '<div>⏳ AI Agent đang lấy changedFiles từ GitHub API, clone mã nguồn vào Sandbox và chạy kiểm thử theo Baseline...</div>';
    }

    try {
      const res = await callDynamicApi(`/api/milestones/${encodeURIComponent(contractId)}/verify-github`, 'POST', {
        agreementId: contractId,
        contractTitle: contract?.title || '',
        acceptanceCriteria: contract?.acceptanceCriteria || '',
        repoUrl,
        commitSha,
        testCommand: 'node --test'
      });

      if (!githubVerificationReportBoxEl || !res?.evaluation) return;
      const ev = res.evaluation;
      const sb = res.sandbox || {};
      const gh = res.github || {};

      const isEmptyOrInvalid = Boolean(ev.blocked || !gh.validUrl || sb.cloned === false || (sb.deliveredFilesCount || 0) === 0);
      const verifiedScore = isEmptyOrInvalid ? 0 : Math.max(0, Math.min(100, Number(ev.deterministicScore ?? 0)));
      const passedCriteria = (ev.deterministicResults || []).filter((r) => r.passed).map((r) => `${r.id} (${r.metric})`);
      const failedCriteria =
        isEmptyOrInvalid && !(ev.deterministicResults || []).some((r) => !r.passed)
          ? ['Repo GitHub rỗng, không tồn tại hoặc không có tệp kiểm thử hợp lệ']
          : (ev.deterministicResults || [])
              .filter((r) => !r.passed)
              .map((r) => `${r.id} (${r.metric}: ${r.actualValue} vs ${r.operator} ${r.expectedValue})`);

      if (contract) {
        contract.latestVerification = {
          verifiedScore,
          passedCriteria,
          failedCriteria,
          isEmptyOrInvalid,
          recommendation: ev.recommendation,
          testReportHash: res.testReportHash,
          evaluatedAt: new Date().toISOString()
        };
      }

      if (!ev.blocked && gh.validUrl !== false) {
        lastVerifiedGithubKey = `${contractId}|${repoUrl}|${commitSha}`;
        lastVerifiedGithubReport = res;
        if (freelancerSubmitFeedbackEl) {
          freelancerSubmitFeedbackEl.hidden = false;
          freelancerSubmitFeedbackEl.className = 'alert-box alert-success';
          freelancerSubmitFeedbackEl.textContent = `✓ Đã kiểm tra GitHub cho [${contractId}]. Bạn đã đủ điều kiện bấm "📤 Gửi Bàn giao & Kiểm tra Nghiệm thu".`;
        }
      } else {
        lastVerifiedGithubKey = null;
        lastVerifiedGithubReport = null;
      }

      const critRows = (ev.deterministicResults || [])
        .map(
          (r) => `
          <tr style="border-top:1px solid var(--border-color);">
            <td style="padding:0.4rem 0.5rem;font-family:var(--font-mono);font-size:0.76rem;">${r.id} (${r.metric})</td>
            <td style="padding:0.4rem 0.5rem;font-size:0.76rem;">Thực tế: <code>${r.actualValue}</code> | Yêu cầu: <code>${r.operator} ${r.expectedValue}</code></td>
            <td style="padding:0.4rem 0.5rem;font-size:0.76rem;">${r.weight}%</td>
            <td style="padding:0.4rem 0.5rem;">
              <span class="pill ${r.passed ? 'pill-emerald' : 'pill-rose'}" style="font-size:0.7rem;">${r.passed ? '✓ PASS' : '✖ FAIL'}</span>
            </td>
          </tr>`
        )
        .join('');

      const hitlRows = (ev.pendingHitlCriteria || [])
        .map(
          (h) => `
          <tr style="border-top:1px solid var(--border-color);">
            <td style="padding:0.4rem 0.5rem;font-family:var(--font-mono);font-size:0.76rem;">${h.id} (SUBJECTIVE)</td>
            <td style="padding:0.4rem 0.5rem;font-size:0.76rem;">${h.description}</td>
            <td style="padding:0.4rem 0.5rem;font-size:0.76rem;">${h.weight}%</td>
            <td style="padding:0.4rem 0.5rem;"><span class="pill pill-amber" style="font-size:0.7rem;">⏳ Chờ HITL duyệt</span></td>
          </tr>`
        )
        .join('');

      const violationAlert =
        Array.isArray(ev.forbiddenViolations) && ev.forbiddenViolations.length > 0
          ? `<div class="alert-box alert-error" style="margin-bottom:0.5rem;">🚨 <strong>Vi phạm Forbidden Paths:</strong> ${ev.forbiddenViolations.map((v) => `${v.file} (${v.matchedRule})`).join(', ')}</div>`
          : '';

      const hasFailedCriteria =
        ev.blocked ||
        ev.recommendation === 'REQUEST_REVISION' ||
        (ev.deterministicResults || []).some((r) => !r.passed);
      let disputeRecHtml = '';
      if (hasFailedCriteria) {
        try {
          const settlement = await callDynamicApi(`/api/milestones/${encodeURIComponent(contractId)}/dispute-recommendation`, 'POST', {
            agreementId: contractId,
            frozenAmount: contract ? Math.max(0, Number(contract.amount || 0) - Number(contract.releasedSoFar || 0)) : 3000000,
            evaluationReport: ev
          });
          disputeRecHtml = renderDisputeSettlementPanelHtml(
            contract || { id: contractId, amount: 3000000, releasedSoFar: 0 },
            settlement
          );
        } catch {
          disputeRecHtml = '';
        }
      }

      const fuji = res.fujiAnchor || {};
      const snowtraceHtml = fuji.txHash
        ? `<div style="margin-bottom:0.45rem;font-size:0.75rem;">⛓️ <strong>Avalanche Fuji ProofRegistry:</strong> <a href="${escapeHtml(fuji.snowtraceUrl || `https://testnet.snowtrace.io/tx/${fuji.txHash}`)}" target="_blank" rel="noopener noreferrer" style="color:var(--accent-blue);font-weight:700;text-decoration:underline;">Xem giao dịch trên Snowtrace (${escapeHtml(String(fuji.txHash).slice(0, 14))}…) ↗</a></div>`
        : `<div style="margin-bottom:0.45rem;font-size:0.74rem;color:var(--text-muted);">⛓️ <strong>Avalanche Fuji ProofRegistry:</strong> ${escapeHtml(fuji.reason || 'Chưa deploy contract lên Fuji (off-chain hash sẵn sàng)')}</div>`;

      if (ev.blocked || res.autoFrozen) {
        applyCircuitBreakerFreeze(state, contractId, 'Vi phạm phạm vi file cấm (forbidden_paths)');
        renderAllTransactionUI();
      }

      const friendlyStatusBanner = ev.blocked || res.autoFrozen
        ? `<div class="alert-box alert-error" style="margin-bottom:0.5rem;">🚨 <strong>Circuit Breaker đã tự động đóng băng quỹ:</strong> Phát hiện sửa file nằm ngoài phạm vi cho phép. Bộ đếm Timelock đã tạm dừng.</div>`
        : ev.recommendation === 'READY_FOR_CLIENT_REVIEW'
        ? `<div class="alert-box alert-success" style="margin-bottom:0.5rem;">✅ <strong>Đã kiểm tra tự động: Đạt ${ev.deterministicScore}% tiêu chí kỹ thuật</strong> • ⏳ Đang chờ Khách hàng duyệt giao diện / cảm quan.</div>`
        : ev.recommendation === 'AUTO_RECOMMEND_RELEASE'
        ? `<div class="alert-box alert-success" style="margin-bottom:0.5rem;">✅ <strong>Đã kiểm tra tự động: Đạt 100% tiêu chí kỹ thuật</strong> — Đủ điều kiện nghiệm thu &amp; giải ngân.</div>`
        : `<div class="alert-box alert-warning" style="margin-bottom:0.5rem;">⚠️ <strong>Chưa đạt đủ tiêu chí kỹ thuật (${ev.deterministicScore}%):</strong> Cần chỉnh sửa theo bảng chi tiết bên dưới.</div>`;

      githubVerificationReportBoxEl.innerHTML = `
        <div style="display:flex;justify-content:space-between;align-items:center;gap:0.5rem;margin-bottom:0.5rem;flex-wrap:wrap;">
          <strong style="font-size:0.84rem;">🔍 Kết quả Kiểm tra Nghiệm thu [${escapeHtml(contractId)}]</strong>
          <span class="pill ${ev.recommendation === 'REQUEST_REVISION' || ev.blocked ? 'pill-rose' : 'pill-emerald'}" style="font-size:0.72rem;">
            Điểm kỹ thuật: ${ev.deterministicScore}%
          </span>
        </div>
        ${friendlyStatusBanner}
        ${violationAlert}
        ${snowtraceHtml}
        <div style="overflow-x:auto;margin-bottom:0.5rem;">
          <table style="width:100%;border-collapse:collapse;background:#fff;border:1px solid var(--border-color);border-radius:6px;">
            <thead>
              <tr style="background:var(--bg-secondary);font-size:0.74rem;text-align:left;">
                <th style="padding:0.4rem 0.5rem;">Tiêu chí / Metric</th>
                <th style="padding:0.4rem 0.5rem;">Đối chiếu Giá trị</th>
                <th style="padding:0.4rem 0.5rem;">Trọng số</th>
                <th style="padding:0.4rem 0.5rem;">Kết quả</th>
              </tr>
            </thead>
            <tbody>${critRows}${hitlRows}</tbody>
          </table>
        </div>
        <details>
          <summary style="font-size:0.76rem;font-weight:700;cursor:pointer;margin-bottom:0.25rem;">🛠️ Xem chi tiết kỹ thuật (Dành cho Dev)</summary>
          <div style="font-size:0.74rem;color:var(--text-secondary);margin:0.35rem 0;">
            Repo: <code>${escapeHtml(gh.owner || '-')}/${escapeHtml(gh.repo || '-')}</code> • Commit: <code>${escapeHtml(String(gh.commitSha || commitSha).slice(0, 10))}</code> • Sandbox: <strong>${sb.executionTimeMs || 0}ms</strong> • Files: <strong>${sb.deliveredFilesCount || 0}</strong> • Report Hash: <code>${escapeHtml(String(res.testReportHash || ''))}</code>
          </div>
          <pre style="background:#0F172A;color:#F8FAFC;padding:0.55rem;border-radius:6px;font-size:0.72rem;max-height:180px;overflow:auto;white-space:pre-wrap;">${String(sb.testLog || '').replace(/[&<>]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' }[c]))}</pre>
        </details>
        ${disputeRecHtml}
      `;
    } catch (err) {
      if (githubVerificationReportBoxEl) {
        githubVerificationReportBoxEl.innerHTML = `<div style="color:var(--accent-rose);">✖ Lỗi khi kiểm tra GitHub: ${err.message}</div>`;
      }
    } finally {
      verifyGithubMilestoneBtn.disabled = false;
      verifyGithubMilestoneBtn.textContent = origBtnText;
    }
  });

  freelancerSelectEl?.addEventListener('change', () => {
    const revBox = document.getElementById('freelancer-contract-revision-box');
    if (!revBox) return;
    const selId = freelancerSelectEl?.value;
    const selContract = state.contracts.find((c) => c.id === selId);
    if (selContract && selContract.clientRevisionComment && selContract.status === 'REVISION_REQUESTED') {
      revBox.hidden = false;
      revBox.innerHTML = `
        <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:0.25rem;">
          <strong style="color:#92400E;">📝 Yêu cầu Sửa đổi từ Khách hàng (Lần ${selContract.revisionsUsed}/${selContract.maxRevisions}):</strong>
          <span class="pill pill-amber">Cần sửa</span>
        </div>
        <div style="font-size:0.83rem;font-weight:700;color:var(--text-primary);background:#FFFFFF;padding:0.5rem 0.65rem;border-radius:var(--radius-sm);border:1px solid #FDE68A;margin:0.25rem 0;">
          "${selContract.clientRevisionComment}"
        </div>
        <div style="font-size:0.72rem;color:var(--text-secondary);">
          Vui lòng hoàn thiện mã nguồn theo đúng mô tả trên của khách hàng rồi nộp lại link GitHub &amp; commit mới bên dưới.
        </div>
      `;
    } else {
      revBox.hidden = true;
    }
  });

  document.addEventListener('click', async (e) => {
    const hitlBtn = e.target?.closest?.('[data-sign-hitl-settlement]');
    if (!hitlBtn) return;
    e.stopPropagation();
    const cId = hitlBtn.getAttribute('data-sign-hitl-settlement');
    const clientPct = Number(hitlBtn.getAttribute('data-client-percent') ?? 50);
    if (!cId) return;

    const res = resolveDisputeByArbiter(state, cId, 'CUSTOM_SPLIT', clientPct, { role: currentLoginRole });
    if (!res.ok) {
      alert(res.error);
      return;
    }
    await syncStateWithServer(true);
    renderAllTransactionUI();
    const arbiterFeedbackEl = document.getElementById('arbiter-feedback');
    if (arbiterFeedbackEl) {
      arbiterFeedbackEl.hidden = false;
      arbiterFeedbackEl.className = 'alert-box alert-success';
      arbiterFeedbackEl.textContent = `⚖️ Trọng tài đã ký phán quyết (HITL) cho [${cId}]: Freelancer ${100 - clientPct}% / Hoàn Client ${clientPct}%.`;
    }
  });

  if (freelancerSubmitForm) {
    freelancerSubmitForm.addEventListener('submit', async (e) => {
      e.preventDefault();
      const contractId = freelancerSelectEl?.value;
      const contract = state.contracts.find((c) => c.id === contractId);
      if (!contract) return;

      const url = (deliverableUrlInput?.value || '').trim();
      const rawCommit = (commitInput?.value || '').trim();
      const commit = rawCommit || 'commit#9f8c2a1';
      const note = (deliverableNoteInput?.value || '').trim();
      const scenario = simScenarioSelect?.value || 'PASS_100';

      // Bắt buộc kiểm tra GitHub trước khi gửi bàn giao
      const expectedKey = `${contractId}|${url}|${rawCommit || 'HEAD'}`;
      if (lastVerifiedGithubKey !== expectedKey) {
        if (freelancerAgentFailureBoxEl) freelancerAgentFailureBoxEl.hidden = true;
        if (freelancerSubmitFeedbackEl) {
          freelancerSubmitFeedbackEl.hidden = false;
          freelancerSubmitFeedbackEl.className = 'alert-box alert-error';
          freelancerSubmitFeedbackEl.textContent =
            '⚠️ Bắt buộc kiểm tra GitHub trước khi bàn giao: Vui lòng bấm nút "🔍 Agent Kiểm tra GitHub & Nghiệm thu" trước khi gửi bàn giao!';
        }
        return;
      }

      const submitBtn = freelancerSubmitForm.querySelector('button[type="submit"]');
      const originalBtnHtml = submitBtn ? submitBtn.innerHTML : '';
      if (submitBtn) {
        submitBtn.disabled = true;
        submitBtn.textContent = '⏳ Agent đang phân tích...';
      }
      if (freelancerAgentFailureBoxEl) freelancerAgentFailureBoxEl.hidden = true;
      if (freelancerSubmitFeedbackEl) {
        freelancerSubmitFeedbackEl.hidden = false;
        freelancerSubmitFeedbackEl.className = 'alert-box';
        freelancerSubmitFeedbackEl.textContent = '⏳ AI Agent đang phân tích mã nguồn bàn giao và chạy kiểm thử tự động...';
      }

      try {
        let report;
        try {
          report = await callDynamicApi('/api/agents/verify-assess', 'POST', {
            submission: { deliverableUrl: url, commitHash: commit, deliverableNote: note },
            scenario
          });
        } catch {
          report = runAutonomousVerificationAndAssessor(
            { deliverableUrl: url, commitHash: commit, deliverableNote: note },
            scenario
          );
        }

        const failedStep = report.toolchainSteps.find((s) => s.status !== 'PASSED');
        const ghEval = lastVerifiedGithubReport?.evaluation;
        const ghSandbox = lastVerifiedGithubReport?.sandbox;
        const isEmptyOrInvalid = ghEval
          ? Boolean(ghEval.blocked || ghSandbox?.cloned === false || (ghSandbox?.deliveredFilesCount || 0) === 0)
          : Boolean(!report.isGitHubValid || report.passRatePercent === 0);
        const verifiedScore = isEmptyOrInvalid
          ? 0
          : Number(ghEval ? ghEval.deterministicScore : report.passRatePercent ?? 0);

        if (!contract.latestVerification) {
          contract.latestVerification = {
            verifiedScore,
            passedCriteria: (report.toolchainSteps || []).filter((s) => s.status === 'PASSED').map((s) => s.tool),
            failedCriteria: failedStep ? [`Bước ${failedStep.step} (${failedStep.tool}): ${failedStep.log}`] : [],
            isEmptyOrInvalid,
            testReportHash: lastVerifiedGithubReport?.testReportHash || report.testReportHash,
            evaluatedAt: new Date().toISOString()
          };
        }

        const effectivePassed = report.allObjectivePassed && !isEmptyOrInvalid && verifiedScore > 0;
        const consistentRec = buildConsistentAgentRecommendation({
          allObjectivePassed: effectivePassed,
          passedCount: contract.latestVerification?.passedCriteria?.length || (effectivePassed ? 4 : 0),
          totalCount:
            (contract.latestVerification?.passedCriteria?.length || 0) +
              (contract.latestVerification?.failedCriteria?.length || 0) || 4,
          failedReasons: contract.latestVerification?.failedCriteria?.length
            ? contract.latestVerification.failedCriteria
            : failedStep
            ? [`Bước ${failedStep.step} (${failedStep.tool}): ${failedStep.log}`]
            : ['Chưa đạt 100% tiêu chí kỹ thuật']
        });

        contract.deliverableUrl = url;
        contract.commitHash = commit;
        contract.deliverableNote = note;
        contract.proofHash = report.testReportHash;
        contract.ipfsCid = report.ipfsReportCid;
        contract.ciVerified = effectivePassed;
        contract.failedStepText = effectivePassed
          ? null
          : failedStep
          ? `Bước ${failedStep.step} (${failedStep.tool}): ${failedStep.log}`
          : (contract.latestVerification?.failedCriteria || []).join('; ');
        contract.aiRecommendation = effectivePassed ? null : consistentRec.message;
        contract.signatures.freelancer = true;
        contract.status = effectivePassed ? 'SUBMITTED' : 'REVISION_REQUESTED';
        contract.timelockRemaining = effectivePassed
          ? `Còn ${contract.inspectionDays} ngày (Auto-Release)`
          : 'Tạm dừng chờ sửa lỗi theo khuyến nghị';

        state.ledger.unshift({
          id: `EV-${Math.floor(1000 + Math.random() * 9000)}`,
          contractId: contract.id,
          time: new Date().toLocaleTimeString('vi-VN'),
          role: 'FREELANCER',
          type: effectivePassed ? 'Nộp Bàn giao (Pass 100%)' : 'Nộp Bàn giao (Không Pass Kiểm thử)',
          detail: `[${contract.id}] ${consistentRec.message}`,
          amount: contract.amount,
          auditHash: report.testReportHash.slice(7, 17)
        });

        await syncStateWithServer(true);
        renderAllTransactionUI();

        if (report.allObjectivePassed) {
          // Nếu PASS -> Ẩn hộp cảnh báo Agent, chỉ hiện thông báo thành công ngắn gọn
          if (freelancerAgentFailureBoxEl) freelancerAgentFailureBoxEl.hidden = true;
          if (freelancerSubmitFeedbackEl) {
            freelancerSubmitFeedbackEl.hidden = false;
            freelancerSubmitFeedbackEl.className = 'alert-box alert-success';
            freelancerSubmitFeedbackEl.textContent = `✓ Đã nộp bàn giao cho [${contract.id}] thành công (Proof: ${report.testReportHash}).`;
          }
        } else {
          // Nếu KHÔNG PASS ở bước nào -> Hiện rõ bước lỗi và khuyến nghị của Agent!
          if (freelancerSubmitFeedbackEl) freelancerSubmitFeedbackEl.hidden = true;
          if (freelancerAgentFailureBoxEl) {
            freelancerAgentFailureBoxEl.hidden = false;
            freelancerAgentFailureBoxEl.innerHTML = `
              <div><strong>⚠️ Không Pass ở ${
                failedStep ? `Bước ${failedStep.step} — ${failedStep.tool}` : 'Pipeline Kiểm thử'
              }:</strong></div>
              <div style="font-family:var(--font-mono);font-size:0.72rem;margin:0.2rem 0;">${
                failedStep ? failedStep.log : ''
              }</div>
              <div><strong>💡 Khuyến nghị của AI Agent:</strong> "${report.recommendation.message}"</div>
            `;
          }
        }
      } finally {
        if (submitBtn) {
          submitBtn.disabled = false;
          submitBtn.innerHTML = originalBtnHtml;
        }
      }
    });
  }

  const freelancerWithdrawForm = document.getElementById('freelancer-withdraw-form');
  const freelancerWithdrawAccountInput = document.getElementById('freelancer-withdraw-account');
  const freelancerWithdrawInput = document.getElementById('freelancer-withdraw-amount');
  const freelancerWithdrawChannel = document.getElementById('freelancer-withdraw-channel');
  const freelancerWithdrawFeedbackEl = document.getElementById('freelancer-withdraw-feedback');

  if (freelancerWithdrawForm) {
    freelancerWithdrawForm.addEventListener('submit', async (e) => {
      e.preventDefault();
      const withdrawAccount = (freelancerWithdrawAccountInput?.value || '').trim();
      if (!withdrawAccount) {
        if (freelancerWithdrawFeedbackEl) {
          freelancerWithdrawFeedbackEl.hidden = false;
          freelancerWithdrawFeedbackEl.className = 'alert-box alert-error';
          freelancerWithdrawFeedbackEl.textContent = '✖ Vui lòng nhập số tài khoản nhận tiền hoặc địa chỉ ví.';
        }
        return;
      }

      const check = validateTopupAmount(freelancerWithdrawInput?.value);
      if (!check.valid || check.amount > state.freelancerBalance) {
        if (freelancerWithdrawFeedbackEl) {
          freelancerWithdrawFeedbackEl.hidden = false;
          freelancerWithdrawFeedbackEl.className = 'alert-box alert-error';
          freelancerWithdrawFeedbackEl.textContent = `✖ ${check.error || 'Số dư khả dụng không đủ.'}`;
        }
        return;
      }

      const channel = freelancerWithdrawChannel?.value || 'Techcombank 24/7 (Fiat)';
      state.freelancerBalance -= check.amount;
      const proof = computeProofHashAndCid(`withdraw-${withdrawAccount}-${check.amount}-${channel}`);

      state.ledger.unshift({
        id: `EV-${Math.floor(1000 + Math.random() * 9000)}`,
        time: new Date().toLocaleTimeString('vi-VN'),
        role: 'FREELANCER',
        type: 'Rút Quỹ Đa Phương thức',
        detail: `Rút thù lao về STK/Ví [${withdrawAccount}] (${channel})`,
        amount: check.amount,
        auditHash: proof.auditHash
      });

      await syncStateWithServer(true);
      renderAllTransactionUI();
      if (freelancerWithdrawFeedbackEl) {
        freelancerWithdrawFeedbackEl.hidden = false;
        freelancerWithdrawFeedbackEl.className = 'alert-box alert-success';
        freelancerWithdrawFeedbackEl.textContent = `✓ Đã rút ${check.formatted} về STK/Ví [${withdrawAccount}] (${channel})!`;
      }
    });
  }

  const evidenceForm = document.getElementById('evidence-upload-form');
  const evidenceFileInput = document.getElementById('evidence-file-input');
  const evidenceActorSelect = document.getElementById('evidence-actor-select');
  const evidenceContentInput = document.getElementById('evidence-content-input');
  const evidenceFeedbackEl = document.getElementById('evidence-feedback');

  if (evidenceForm) {
    evidenceForm.addEventListener('submit', async (e) => {
      e.preventDefault();
      const contractId = evidenceContractSelectEl?.value;
      const actor = evidenceActorSelect?.value || 'CLIENT (Buyer)';
      const content = (evidenceContentInput?.value || '').trim();
      const file = evidenceFileInput?.files?.[0];

      let fileMeta = null;
      if (file) {
        let dataUrl = null;
        try {
          dataUrl = await new Promise((resolve) => {
            const reader = new FileReader();
            reader.onload = () => resolve(reader.result);
            reader.onerror = () => resolve(null);
            reader.readAsDataURL(file);
          });
        } catch {
          dataUrl = null;
        }
        fileMeta = {
          fileName: file.name,
          fileSizeKb: Math.max(1, Math.round(file.size / 1024)),
          fileType: file.type || 'application/octet-stream',
          dataUrl
        };
      } else if (!content) {
        if (evidenceFeedbackEl) {
          evidenceFeedbackEl.hidden = false;
          evidenceFeedbackEl.className = 'alert-box alert-error';
          evidenceFeedbackEl.textContent = '✖ Vui lòng nhập mô tả hoặc chọn file bằng chứng đính kèm!';
        }
        return;
      }

      const res = submitDisputeEvidence(state, contractId, actor, content, fileMeta);
      if (res.ok) {
        if (evidenceFileInput) evidenceFileInput.value = '';
        await syncStateWithServer(true);
        renderAllTransactionUI();
        if (evidenceFeedbackEl) {
          evidenceFeedbackEl.hidden = false;
          evidenceFeedbackEl.className = 'alert-box alert-success';
          evidenceFeedbackEl.textContent = `✓ Đã ghi nhận chứng cứ (${res.entry.hash})! Arbiter có thể lưu file về máy.`;
        }
      }
    });
  }

  /* ========================================================================
     POPUP 4 TẦNG AI AGENTS (Mở khi bấm nút "🤖 AI Agents (4 Tầng)" cạnh Guardrails trên Topbar)
     ======================================================================== */
  const aiAgentsModal = document.getElementById('ai-agents-modal');
  const openAiAgentsBtn = document.getElementById('btn-open-ai-agents-modal');
  const closeAiAgentsBtn = document.getElementById('btn-close-ai-agents-modal');
  const agentTabBtns = document.querySelectorAll('[data-agent-tab]');
  const agentPanels = document.querySelectorAll('[data-agent-panel]');

  const modalTier1Input = document.getElementById('modal-tier1-brief-input');
  const modalRunTier1Btn = document.getElementById('btn-modal-run-tier1');
  const modalTier1ResultBox = document.getElementById('modal-tier1-result-box');

  const modalTier23Scenario = document.getElementById('modal-tier23-scenario');
  const modalRunTier23Btn = document.getElementById('btn-modal-run-tier23');
  const modalTier23ResultBox = document.getElementById('modal-tier23-result-box');

  const modalRunTier4Btn = document.getElementById('btn-modal-run-tier4');
  const modalTier4ResultBox = document.getElementById('modal-tier4-result-box');

  async function renderModalTier1() {
    if (!modalTier1ResultBox) return;
    const brief = modalTier1Input?.value || 'Làm web bán hàng đẹp, mượt';
    let res;
    try {
      res = await callDynamicApi('/api/agents/scope-decompose', 'POST', { brief });
    } catch {
      res = runScopeDecomposerAgent(brief);
    }
    modalTier1ResultBox.innerHTML = `
      <div class="contract-subbox" style="margin-bottom:0.5rem;">
        <div style="display:flex;justify-content:space-between;">
          <strong>${res.agentName}</strong>
          <span class="pill pill-mono">${res.checklistHash}</span>
        </div>
        <div style="margin-top:0.25rem;">${res.summaryText}</div>
      </div>
      <div style="display:grid;grid-template-columns:1fr 1fr;gap:0.65rem;">
        <div>
          <div style="font-size:0.75rem;font-weight:700;color:var(--accent-blue);margin-bottom:0.3rem;">Deterministic (Khách quan — AI chấm):</div>
          ${res.deterministicItems
            .map(
              (item) => `
            <div class="contract-subbox" style="margin-bottom:0.3rem;">
              <strong>[${item.id}] ${item.category}:</strong> ${item.criterion} (<code>${item.metric}</code>)
            </div>`
            )
            .join('')}
        </div>
        <div>
          <div style="font-size:0.75rem;font-weight:700;color:var(--accent-purple);margin-bottom:0.3rem;">Subjective (Chủ quan — Client duyệt tay):</div>
          ${res.subjectiveItems
            .map(
              (item) => `
            <div class="contract-subbox" style="margin-bottom:0.3rem;">
              <strong>[${item.id}] ${item.category}:</strong> ${item.criterion}
            </div>`
            )
            .join('')}
        </div>
      </div>
    `;
  }

  async function renderModalTier23() {
    if (!modalTier23ResultBox) return;
    const scenario = modalTier23Scenario?.value || 'FAIL_PAYMENT_500';
    let report;
    try {
      report = await callDynamicApi('/api/agents/verify-assess', 'POST', {
        submission: { deliverableUrl: 'https://github.com/vibecode/app/pull/42', commitHash: 'commit#9f8c2a1' },
        scenario
      });
    } catch {
      report = runAutonomousVerificationAndAssessor(
        { deliverableUrl: 'https://github.com/vibecode/app/pull/42', commitHash: 'commit#9f8c2a1' },
        scenario
      );
    }
    modalTier23ResultBox.innerHTML = `
      ${report.toolchainSteps
        .map(
          (s) => `
        <div class="contract-subbox" style="margin-bottom:0.3rem;">
          <div style="display:flex;justify-content:space-between;">
            <strong>Bước ${s.step}: ${s.tool}</strong>
            <span class="badge-status ${s.status === 'PASSED' ? 'badge-passed' : 'badge-failed'}">${s.status}</span>
          </div>
          <div>${s.action} — <code>${s.log}</code></div>
        </div>`
        )
        .join('')}
      <div class="alert-box ${report.allObjectivePassed ? 'alert-success' : 'alert-error'}" style="margin-top:0.5rem;">
        <div><strong>Khuyến nghị của Agent Tầng 3 (${report.proofRegistryOnChainTx}):</strong></div>
        <div>"${report.recommendation.message}"</div>
      </div>
    `;
  }

  async function renderModalTier4() {
    if (!modalTier4ResultBox) return;
    const disputed = state.contracts.find((c) => c.status === 'DISPUTED') || state.contracts[2];
    let dossier;
    try {
      dossier = await callDynamicApi('/api/agents/fact-finding', 'POST', disputed);
    } catch {
      dossier = runFactFindingBailiffAgent(disputed);
    }
    modalTier4ResultBox.innerHTML = `
      <div class="contract-subbox">
        <div style="display:flex;justify-content:space-between;margin-bottom:0.35rem;">
          <strong>${dossier.agentName} — Hợp đồng [${dossier.contractId}]</strong>
          <span class="pill pill-mono">${dossier.dossierHash}</span>
        </div>
        <div>• <strong>Checklist đã ký:</strong> ${dossier.dossierSections.signedChecklistAnchor}</div>
        <div>• <strong>Lịch sử giao hàng:</strong> ${dossier.dossierSections.deliveryAndCommitTimeline}</div>
        <div>• <strong>Nhật ký chạy test:</strong> ${dossier.dossierSections.automatedTestAudit}</div>
        <div>• <strong>Phân tích Scope Creep:</strong> ${dossier.dossierSections.scopeCreepAnalysis}</div>
        <div class="alert-box alert-error" style="margin-top:0.5rem;">
          <strong>💡 Đề xuất tỷ lệ phân chia quỹ cho Trọng tài (HITL):</strong> "${dossier.proposalStatement}"
        </div>
      </div>
    `;
  }

  openAiAgentsBtn?.addEventListener('click', () => {
    if (aiAgentsModal) {
      aiAgentsModal.hidden = false;
      renderModalTier1();
      renderModalTier23();
      renderModalTier4();
    }
  });

  closeAiAgentsBtn?.addEventListener('click', () => {
    if (aiAgentsModal) aiAgentsModal.hidden = true;
  });

  aiAgentsModal?.addEventListener('click', (e) => {
    if (e.target === aiAgentsModal) aiAgentsModal.hidden = true;
  });

  agentTabBtns.forEach((btn) => {
    btn.addEventListener('click', () => {
      const target = btn.getAttribute('data-agent-tab');
      agentTabBtns.forEach((b) => b.classList.toggle('active', b === btn));
      agentPanels.forEach((p) => {
        p.hidden = p.getAttribute('data-agent-panel') !== target;
      });
    });
  });

  modalRunTier1Btn?.addEventListener('click', renderModalTier1);
  modalRunTier23Btn?.addEventListener('click', renderModalTier23);
  modalRunTier4Btn?.addEventListener('click', renderModalTier4);

  /* ========================================================================
     POPUP CHI TIẾT HỆ THỐNG, GUARDRAILS & POWERBATCH
     ======================================================================== */
  const systemModal = document.getElementById('system-details-modal');
  const openSystemModalBtn = document.getElementById('btn-open-system-modal');
  const openGuardrailsShortcutBtn = document.getElementById('btn-open-guardrails-shortcut');
  const closeSystemModalBtn = document.getElementById('btn-close-system-modal');
  const sysTabBtns = document.querySelectorAll('[data-sys-tab]');
  const sysPanels = document.querySelectorAll('[data-sys-panel]');

  openSystemModalBtn?.addEventListener('click', () => {
    if (systemModal) systemModal.hidden = false;
  });

  openGuardrailsShortcutBtn?.addEventListener('click', () => {
    if (systemModal) systemModal.hidden = false;
  });

  closeSystemModalBtn?.addEventListener('click', () => {
    if (systemModal) systemModal.hidden = true;
  });

  systemModal?.addEventListener('click', (e) => {
    if (e.target === systemModal) systemModal.hidden = true;
  });

  window.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') {
      if (txModal && !txModal.hidden) txModal.hidden = true;
      if (aiAgentsModal && !aiAgentsModal.hidden) aiAgentsModal.hidden = true;
      if (systemModal && !systemModal.hidden) systemModal.hidden = true;
      if (confirmModal && !confirmModal.hidden) confirmModal.hidden = true;
    }
  });

  sysTabBtns.forEach((btn) => {
    btn.addEventListener('click', () => {
      const targetTab = btn.getAttribute('data-sys-tab');
      sysTabBtns.forEach((b) => b.classList.toggle('active', b === btn));
      sysPanels.forEach((panel) => {
        panel.hidden = panel.getAttribute('data-sys-panel') !== targetTab;
      });
    });
  });

  const archButtons = document.querySelectorAll('[data-arch-node]');
  const inspectorTitle = document.getElementById('inspector-title');
  const inspectorTag = document.getElementById('inspector-tag');
  const inspectorSummary = document.getElementById('inspector-summary');
  const inspectorFiles = document.getElementById('inspector-files');
  const inspectorSnippet = document.getElementById('inspector-snippet');

  function renderArchNode(nodeKey) {
    const node = ARCHITECTURE_NODES[nodeKey] || ARCHITECTURE_NODES.guardrails;
    archButtons.forEach((btn) => {
      btn.classList.toggle('active', btn.getAttribute('data-arch-node') === node.id);
    });
    if (inspectorTitle) inspectorTitle.textContent = node.title;
    if (inspectorTag) inspectorTag.textContent = node.tag;
    if (inspectorSummary) inspectorSummary.textContent = node.summary;
    if (inspectorFiles) {
      inspectorFiles.innerHTML = node.files
        .map((f) => `<span class="pill pill-mono">${f}</span>`)
        .join(' ');
    }
    if (inspectorSnippet) inspectorSnippet.textContent = node.snippet;
  }

  archButtons.forEach((btn) => {
    btn.addEventListener('click', () => {
      renderArchNode(btn.getAttribute('data-arch-node'));
    });
  });
  renderArchNode('guardrails');

  const batchListEl = document.getElementById('powerbatch-list');
  const terminalLogEl = document.getElementById('powerbatch-terminal');
  const runBatchBtn = document.getElementById('btn-run-powerbatch');
  const simHealBtn = document.getElementById('btn-sim-selfheal');

  function renderBatchItems(items) {
    if (!batchListEl) return;
    batchListEl.innerHTML = items
      .map((item) => {
        const badgeClass =
          item.status === 'PASSED'
            ? 'badge-passed'
            : item.status === 'HEALING'
            ? 'badge-healing'
            : item.status === 'FAILED'
            ? 'badge-failed'
            : 'badge-running';
        return `
        <div class="batch-item">
          <div>
            <strong style="font-size:0.78rem;">[${item.id}] ${item.name}</strong>
            <div style="font-family:var(--font-mono);font-size:0.68rem;color:var(--text-muted);">$ ${item.command}</div>
          </div>
          <span class="badge-status ${badgeClass}">${item.status} (${item.durationMs}ms)</span>
        </div>`;
      })
      .join('');
  }
  renderBatchItems(POWERBATCH_DEFAULT_BATCHES);

  runBatchBtn?.addEventListener('click', async () => {
    if (!terminalLogEl) return;
    terminalLogEl.textContent = `⚡ Khởi chạy PowerBatch Pipeline (.antigravity/test_commands.json)...\n`;
    const current = POWERBATCH_DEFAULT_BATCHES.map((b) => ({ ...b, status: 'RUNNING', durationMs: 0 }));
    renderBatchItems(current);
    for (let i = 0; i < current.length; i++) {
      await new Promise((r) => setTimeout(r, 140));
      current[i].status = 'PASSED';
      current[i].durationMs = POWERBATCH_DEFAULT_BATCHES[i].durationMs;
      renderBatchItems(current);
      terminalLogEl.textContent += `▶ [${current[i].id}] ${current[i].name} ... PASSED (${current[i].durationMs}ms)\n`;
    }
    terminalLogEl.textContent += `✅ 4/4 Batches PASSED. Vercel Preview Ready: true`;
  });

  simHealBtn?.addEventListener('click', async () => {
    if (!terminalLogEl) return;
    const cloned = POWERBATCH_DEFAULT_BATCHES.map((b) => ({ ...b }));
    cloned[2].status = 'FAILED';
    renderBatchItems(cloned);
    terminalLogEl.textContent =
      `✖ [batch-03-unit-tests] FAILED (Exit code 1)\n` +
      `🔄 [Self-Healing Loop - Guardrail G5: Retry 1/3] Đọc stderr từ powerbatch-report.json...\n`;
    await new Promise((r) => setTimeout(r, 340));
    cloned[2].status = 'HEALING';
    renderBatchItems(cloned);
    terminalLogEl.textContent += `🛠  [Coder Agent] Tự động vá logic Escrow & chạy lại PowerBatch...\n`;
    await new Promise((r) => setTimeout(r, 340));
    cloned[2].status = 'PASSED';
    renderBatchItems(cloned);
    terminalLogEl.textContent += `✅ Self-Healing thành công! Toàn bộ 4/4 Batches PASSED.`;
  });

  const guardrailInput = document.getElementById('guardrail-cmd-input');
  const guardrailCheckBtn = document.getElementById('guardrail-check-btn');
  const guardrailResultEl = document.getElementById('guardrail-result');
  const sampleCmdBtns = document.querySelectorAll('[data-sample-cmd]');

  function runGuardrailCheck() {
    if (!guardrailInput || !guardrailResultEl) return;
    const evaluation = evaluateGuardrailCommand(guardrailInput.value);
    guardrailResultEl.hidden = false;
    guardrailResultEl.className = evaluation.allowed
      ? 'alert-box alert-success'
      : 'alert-box alert-error';
    guardrailResultEl.textContent = `[${evaluation.status}] ${evaluation.reason}`;
  }

  guardrailCheckBtn?.addEventListener('click', runGuardrailCheck);
  sampleCmdBtns.forEach((btn) => {
    btn.addEventListener('click', () => {
      if (guardrailInput) {
        guardrailInput.value = btn.getAttribute('data-sample-cmd');
        runGuardrailCheck();
      }
    });
  });
}

if (typeof window !== 'undefined') {
  window.addEventListener('DOMContentLoaded', initBrowserApp);
}
