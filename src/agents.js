/**
 * Hệ thống 4 Tầng Agentic AI cho Giao dịch Ký quỹ Thông minh (src/agents.js)
 * 1. Tầng khởi tạo (Soạn thảo): ScopeDecomposerAgent — Chuẩn hóa Brief mơ hồ thành Machine-readable Checklist (Deterministic vs Subjective) & Băm Hash
 * 2. Tầng thực thi & Giao nộp (Giao hàng): SandboxVerifierAgent — Autonomous Verification Pipeline (Git API, Docker/Firecracker Sandbox, Test Runner, cURL, Artifact Metadata)
 * 3. Tầng nghiệm thu: TechnicalAssessorAgent — Tổng hợp Test Report, Đề xuất hành động (Pass 100% vs Lỗi 500 input âm) & Ghi nhận ProofRegistry on-chain
 * 4. Tầng giải quyết tranh chấp: FactFindingBailiffAgent — Thừa phát lại tổng hợp Dispute Dossier & Đề xuất tỷ lệ phân chia quỹ (VD: 65% Freelancer / 35% Client) cho Trọng tài (HITL)
 */

import { computeProofHashAndCid } from './app.js';

/**
 * Bảng Tóm tắt Vị trí của Agent trong Toàn bộ Luồng Escrow
 */
export const ESCROW_AGENTS_MATRIX = [
  {
    stage: '1. Soạn thảo (Tầng khởi tạo)',
    role: 'Thư ký phân rã checklist (Scope Decomposer)',
    tools: 'LLM Parser, JSON Schema Validator, SHA-256 Anchor',
    authority: 'Đề xuất (Cần 2 bên Buyer & Seller ký)',
    badgeClass: 'pill-blue'
  },
  {
    stage: '2. Giao hàng (Tầng thực thi & Giao nộp)',
    role: 'Kỹ sư kiểm thử tự động (Autonomous Verifier)',
    tools: 'Git API, Docker / Firecracker Sandbox, Test Runners, cURL, Metadata Reader',
    authority: 'Tự động chạy độc lập trong Sandbox',
    badgeClass: 'pill-emerald'
  },
  {
    stage: '3. Nghiệm thu (Tầng phán quyết kỹ thuật)',
    role: 'Giám định viên kỹ thuật (Technical Assessor)',
    tools: 'Log Aggregator, Hashing Tool, Oracle Relay (ProofRegistry)',
    authority: 'Đề xuất giải ngân & ghi log (Không tự rút tiền Vault)',
    badgeClass: 'pill-amber'
  },
  {
    stage: '4. Tranh chấp (Tầng giải quyết tranh chấp)',
    role: 'Thừa phát lại trích xuất chứng cứ (Fact-finding Bailiff)',
    tools: 'Audit Trail Reader, Git Diff & Scope Creep Analyzer',
    authority: 'Đề xuất phương án chia quỹ cho Trọng tài (HITL)',
    badgeClass: 'pill-purple'
  }
];

/**
 * Kiểm tra xem URL bàn giao có phải link chuẩn của GitHub hay không.
 * Hỗ trợ các định dạng GitHub repository hoặc resource:
 * - https://github.com/:owner/:repo
 * - https://github.com/:owner/:repo/pull/:number
 * - https://github.com/:owner/:repo/commit/:hash
 * - http(s)://(www.)github.com/:owner/:repo...
 */
export function isValidGitHubUrl(url) {
  if (!url || typeof url !== 'string') return false;
  const trimmed = url.trim();
  const githubRegex = /^https?:\/\/(www\.)?github\.com\/[A-Za-z0-9_.-]{1,100}\/[A-Za-z0-9_.-]{1,100}(\/.*)?$/i;
  return githubRegex.test(trimmed);
}

/**
 * Kiểm tra tên hợp đồng phải có ý nghĩa, không là ký hiệu linh tinh.
 * - Độ dài tối thiểu 6 ký tự, tối đa 120 ký tự
 * - Phải chứa ít nhất 4 chữ cái (tiếng Việt hoặc tiếng Anh)
 * - Tỷ lệ chữ cái/chữ số/khoảng trắng hợp lệ >= 70%
 * - Không được là chuỗi lặp ký tự vô nghĩa (aaaaaa, .....) hoặc gõ phím bừa bãi (asdfgh, qwerty, 123456)
 */
export function validateContractTitle(title) {
  if (!title || typeof title !== 'string') {
    return { valid: false, error: 'Vui lòng nhập tên hợp đồng.' };
  }
  const trimmed = title.trim();
  if (trimmed.length < 6) {
    return { valid: false, error: 'Tên hợp đồng quá ngắn (tối thiểu 6 ký tự).' };
  }
  if (trimmed.length > 120) {
    return { valid: false, error: 'Tên hợp đồng không được vượt quá 120 ký tự.' };
  }

  // Chặn toàn ký hiệu đặc biệt hoặc toàn số
  const lettersOnly = trimmed.match(/[a-zA-ZÀ-ỹ]/g) || [];
  if (lettersOnly.length < 4) {
    return { valid: false, error: 'Tên hợp đồng phải chứa từ ngữ có nghĩa (không được chỉ gồm số hoặc ký hiệu linh tinh).' };
  }

  // Tỷ lệ ký tự hợp lệ (chữ cái, chữ số, khoảng trắng) phải chiếm > 70%
  const validChars = (trimmed.match(/[a-zA-ZÀ-ỹ0-9\s]/g) || []).length;
  if (validChars / trimmed.length < 0.7) {
    return { valid: false, error: 'Tên hợp đồng chứa quá nhiều ký hiệu đặc biệt hoặc ký tự lạ vô nghĩa.' };
  }

  // Chặn các chuỗi vô nghĩa hoặc lặp ký tự (ví dụ: aaaaa, asdfgh, qwerty, 111111)
  const lower = trimmed.toLowerCase();
  const gibberishPatterns = [
    /(.)\1{3,}/, // lặp ký tự 4 lần liên tiếp (aaaa, zzzz, ....)
    /^(asdf|qwerty|zxcv|1234|abcd|test1|demo1|aaaa)/i
  ];
  for (const pat of gibberishPatterns) {
    if (pat.test(lower)) {
      return { valid: false, error: 'Tên hợp đồng không được là chuỗi ký tự gõ bừa hoặc ký hiệu linh tinh (ví dụ: "asdfgh", "aaaaaa").' };
    }
  }

  return { valid: true, title: trimmed };
}

/**
 * TẦNG 1: Thư ký Phân rã Checklist (Scope Decomposer Agent)
 * Đọc brief mơ hồ (VD: "làm web bán hàng đẹp, mượt") -> Phân tách thành JSON Schema Checklist
 * gồm Deterministic (Khách quan - AI chấm) và Subjective (Chủ quan - Client duyệt tay) + Băm Checklist Hash.
 */
export function runScopeDecomposerAgent(rawBrief = '') {
  const briefText = (rawBrief || 'Làm web bán hàng đẹp, mượt, thanh toán nhanh').trim();
  const titleValidation = validateContractTitle(briefText);
  const deterministicItems = [
    {
      id: 'OBJ-01',
      type: 'DETERMINISTIC',
      category: 'Unit & Integration Test',
      criterion: 'Có bộ kiểm thử tự động với Test Coverage > 80% (0 test failed)',
      metric: 'coverage >= 80%',
      verifiableBy: 'Sandbox Test Runner'
    },
    {
      id: 'OBJ-02',
      type: 'DETERMINISTIC',
      category: 'API Performance & Schema',
      criterion: 'Endpoint /api/payment phản hồi p95 < 200ms và trả đúng JSON Schema chuẩn',
      metric: 'p95_latency_ms < 200 && status == 200',
      verifiableBy: 'Sandbox cURL Prober'
    },
    {
      id: 'OBJ-03',
      type: 'DETERMINISTIC',
      category: 'Design & Artifact Metadata',
      criterion: 'Xuất đủ 5 màn hình Figma chuẩn kích thước (Desktop 1440px & Mobile 390px)',
      metric: 'artboards_count >= 5',
      verifiableBy: 'Artifact Metadata Reader'
    },
    {
      id: 'OBJ-04',
      type: 'DETERMINISTIC',
      category: 'Database & Security',
      criterion: 'Database đúng lược đồ Schema, xử lý an toàn khi nhận input âm tại /api/payment',
      metric: 'schema_valid == true && negative_input_safe == true',
      verifiableBy: 'Integration Suite'
    }
  ];

  const subjectiveItems = [
    {
      id: 'SUB-01',
      type: 'SUBJECTIVE',
      category: 'Visual & Aesthetic',
      criterion: 'Phối màu hợp mắt trên nền trắng tinh khiết (#FFFFFF), bố cục thoáng',
      approver: 'Chuyển quyền cho Client (Buyer) duyệt tay'
    },
    {
      id: 'SUB-02',
      type: 'SUBJECTIVE',
      category: 'Brand Copywriting',
      criterion: 'Phong cách hành văn (microcopy) đúng vibe thương hiệu thân thiện, chuyên nghiệp',
      approver: 'Chuyển quyền cho Client (Buyer) duyệt tay'
    }
  ];

  const schemaPayload = JSON.stringify({
    sourceBrief: briefText,
    deterministicItems,
    subjectiveItems
  });
  const hashInfo = computeProofHashAndCid(schemaPayload);

  return {
    agentName: 'ScopeDecomposerAgent (Tầng 1 — Soạn thảo)',
    sourceBrief: briefText,
    isValidTitle: titleValidation.valid,
    validationError: titleValidation.valid ? null : titleValidation.error,
    checklistHash: hashInfo.sha256,
    onChainAnchorTx: hashInfo.auditHash,
    deterministicItems,
    subjectiveItems,
    summaryText: titleValidation.valid
      ? `Đã phân rã "${briefText}" thành ${deterministicItems.length} tiêu chí Deterministic (Khách quan - AI chấm) và ${subjectiveItems.length} tiêu chí Subjective (Chủ quan - Client duyệt tay). Checklist Hash neo bất biến: ${hashInfo.sha256}`
      : `⚠️ Tên hợp đồng không hợp lệ: ${titleValidation.error}. Khuyến nghị đặt tên công việc cụ thể (ví dụ: "Phát triển API thanh toán QR").`
  };
}

/**
 * TẦNG 2 & TẦNG 3:
 * - Tầng 2 (Autonomous Verification Pipeline): Chạy chuỗi công cụ Git API -> Docker/Firecracker Sandbox -> cURL -> Metadata
 *   (Kiểm tra xem link nộp có phải link GitHub chuẩn không trước khi clone vào Sandbox)
 * - Tầng 3 (Proposal & Proof Generation): Tổng hợp Test Report, đưa ra Recommendation & ghi ProofRegistry on-chain
 */
export function runAutonomousVerificationAndAssessor(submission = {}, scenario = 'PASS_100') {
  const commitHash = submission.commitHash || 'commit#9f8c2a1';
  const repoUrl = submission.deliverableUrl || 'https://github.com/vibecode/app/pull/42';
  const isGitHubValid = isValidGitHubUrl(repoUrl);
  const isPassScenario = isGitHubValid && scenario !== 'FAIL_PAYMENT_500';

  // Chuỗi công cụ (Tool Chain) Tầng 2
  const toolchainSteps = [
    {
      step: 1,
      tool: 'GitHub API + Firecracker microVM',
      action: `Kiểm tra định dạng GitHub & clone code từ ${repoUrl} (${commitHash}) vào Sandbox`,
      status: isGitHubValid ? 'PASSED' : 'FAILED',
      log: isGitHubValid
        ? 'Cloned repository into isolated microVM sandbox-vm-09a2 in 420ms.'
        : `LỖI ĐỊNH DẠNG: URL bàn giao "${repoUrl}" không phải là link chuẩn của GitHub (yêu cầu dạng: https://github.com/{owner}/{repo}/...).`
    },
    {
      step: 2,
      tool: 'Pipeline Test Runner (Linter + Unit/Integration)',
      action: 'Cài đặt dependencies, chạy ESLint, Unit Tests & Integration Tests',
      status: isGitHubValid ? 'PASSED' : 'SKIPPED',
      log: isGitHubValid
        ? 'Test Coverage đạt 88.5% (> 80% yêu cầu). Linter: 0 errors.'
        : 'Bỏ qua do bước 1 (Kiểm tra định dạng GitHub & Clone Repo) không thành công.'
    },
    {
      step: 3,
      tool: 'Sandbox Local Server + cURL Prober',
      action: 'Dựng server trong sandbox (:3000), gọi curl kiểm tra /api/payment với JSON chuẩn & input âm',
      status: !isGitHubValid ? 'SKIPPED' : (isPassScenario ? 'PASSED' : 'FAILED'),
      log: !isGitHubValid
        ? 'Bỏ qua do không có mã nguồn từ GitHub hợp lệ.'
        : (isPassScenario
          ? 'GET/POST /api/payment -> 200 OK (p95 = 138ms < 200ms, JSON Schema hợp lệ, chặn đúng input âm).'
          : 'POST /api/payment {"amount": -50000} -> HTTP 500 Internal Server Error (UnhandledNegativeAmountError).')
    },
    {
      step: 4,
      tool: 'Artifact Metadata Inspector',
      action: 'Đọc metadata file thiết kế Figma & tài liệu API đối chiếu số lượng artboard/component',
      status: isGitHubValid ? 'PASSED' : 'SKIPPED',
      log: isGitHubValid
        ? 'Xác thực đủ 5/5 màn hình Figma chuẩn kích thước và 18 UI components.'
        : 'Bỏ qua do link bàn giao không hợp lệ.'
    }
  ];

  // Tầng 3: Giám định viên kỹ thuật (Proposal & Proof Generation)
  const objectiveTotal = 4;
  const objectivePassed = !isGitHubValid ? 0 : (isPassScenario ? 4 : 3);
  const passRatePercent = Math.round((objectivePassed / objectiveTotal) * 100);

  let recommendation;
  if (!isGitHubValid) {
    recommendation = {
      targetRole: 'FREELANCER (Seller)',
      decision: 'REQUEST_FIX',
      message: `Link bàn giao "${repoUrl}" không phải là link chuẩn của GitHub. Vui lòng cung cấp link repository hoặc Pull Request GitHub hợp lệ (dạng https://github.com/{owner}/{repo}) để AI Sandbox clone code và chạy kiểm thử tự động.`
    };
  } else if (!isPassScenario) {
    recommendation = {
      targetRole: 'FREELANCER (Seller)',
      decision: 'REQUEST_FIX',
      message:
        'Endpoint /api/payment bị lỗi 500 khi test với input âm, vui lòng sửa lại để tiếp tục nghiệm thu.'
    };
  } else {
    recommendation = {
      targetRole: 'CLIENT (Buyer)',
      decision: 'RECOMMEND_RELEASE',
      message:
        'Sản phẩm đã vượt qua mọi bài test kỹ thuật (4/4 tiêu chí Deterministic đạt 100%, Coverage 88.5%, API p95 = 138ms). Nhấn xác nhận để giải ngân milestone.'
    };
  }

  const reportPayload = JSON.stringify({ commitHash, repoUrl, scenario, passRatePercent, recommendation });
  const proofInfo = computeProofHashAndCid(reportPayload);

  return {
    tier2Agent: 'SandboxVerifierAgent (Tầng 2 — Giao hàng)',
    tier3Agent: 'TechnicalAssessorAgent (Tầng 3 — Nghiệm thu)',
    scenario,
    isGitHubValid,
    allObjectivePassed: isPassScenario,
    passRatePercent,
    objectivePassed,
    objectiveTotal,
    toolchainSteps,
    recommendation,
    testReportHash: proofInfo.sha256,
    proofRegistryOnChainTx: `ProofRegistry::record(${proofInfo.auditHash})`,
    ipfsReportCid: proofInfo.ipfsCid
  };
}

/**
 * TẦNG 4: Thừa phát lại Thu thập Chứng cứ (Autonomous Fact-finding Bailiff)
 * Tự động tổng hợp Hồ sơ Vụ việc (Dispute Dossier) và đề xuất tỷ lệ phân chia quỹ
 * (VD: Hoàn thành 70% khối lượng công việc được kiểm chứng -> đề xuất 65% Freelancer / 35% Client)
 */
export function runFactFindingBailiffAgent(contract) {
  const c = contract || {
    id: 'ESC-103',
    title: 'Tối ưu Tốc độ Edge & Tích hợp Bot Tự động',
    freelancer: 'Hoàng Nam (AI Engineer)',
    amount: 3000000,
    acceptanceCriteria: 'p95 Latency < 200ms trên Vercel Edge, 0 lỗi runtime',
    commitHash: 'commit#3e1b804',
    evidences: []
  };

  const verifiedCompletionPercent = 70;
  const recommendedSellerPercent = 65;
  const recommendedBuyerPercent = 35;

  const dossierHashInfo = computeProofHashAndCid(
    `dossier-${c.id}-${verifiedCompletionPercent}-${recommendedSellerPercent}`
  );

  return {
    agentName: 'FactFindingBailiffAgent (Tầng 4 — Tranh chấp)',
    contractId: c.id,
    contractTitle: c.title,
    dossierHash: dossierHashInfo.sha256,
    verifiedCompletionPercent,
    recommendedSellerPercent,
    recommendedBuyerPercent,
    dossierSections: {
      signedChecklistAnchor: `Đã đối chiếu Hợp đồng gốc [${c.id}] & Checklist Hash bất biến (${c.acceptanceCriteria}).`,
      deliveryAndCommitTimeline: `Freelancer (${c.freelancer}) đã nộp 6 commits (mới nhất: ${c.commitHash || 'commit#3e1b804'}) đúng hạn mốc Milestone 1 & 2.`,
      automatedTestAudit: `70% tiêu chí Deterministic đã vượt qua trong Sandbox (Pass: UI Kit, DB Schema, Staging Latency p95=165ms; Chưa đạt trọn vẹn: Stress Test tải đột biến 10.000 req/s).`,
      scopeCreepAnalysis: `Phát hiện yêu cầu sửa đổi lần thứ 3 của Client ("Thêm cụm multi-region failover") vượt quá phạm vi cam kết ban đầu (Scope Creep).`,
      evidenceFilesCount: (c.evidences || []).length
    },
    proposalStatement: `Freelancer đã hoàn thành ${verifiedCompletionPercent}% khối lượng công việc được kiểm chứng; đề xuất giải ngân ${recommendedSellerPercent}% cho Freelancer và hoàn trả ${recommendedBuyerPercent}% cho Client.`,
    hitlNote: 'Trọng tài con người (Arbiter) chỉ cần xem xét tính hợp lý của Hồ sơ Vụ việc và nhấn nút Ký duyệt (HITL).'
  };
}

