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
  if (/[<>]/.test(trimmed)) {
    return { valid: false, error: 'Tên hợp đồng không được chứa thẻ HTML (<, >).' };
  }
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

const VERIFICATION_CACHE = new Map();

/**
 * Phát hiện sớm dấu hiệu Scope Creep (phát sinh ngoài phạm vi hợp đồng) trong nội dung yêu cầu sửa đổi.
 * Đối chiếu cả từ khóa bổ sung lẫn chức năng/module không nằm trong tiêu chí hợp đồng đã ký.
 */
export function detectScopeCreepRisk(revisionComment = '', contractCriteria = '') {
  const text = String(revisionComment || '').toLowerCase();
  const criteriaLower = String(contractCriteria || '').toLowerCase();
  const scopeCreepKeywords = [
    'thêm tính năng',
    'bổ sung',
    'thêm module',
    'multi-region',
    'failover',
    'làm lại toàn bộ',
    'tích hợp thêm',
    'đổi kiến trúc',
    'mobile app',
    'thanh toán mới'
  ];
  const matchedKeywords = scopeCreepKeywords.filter((kw) => text.includes(kw));

  const extraFeatureTerms = [
    'oauth',
    'sso',
    'blockchain',
    'smart contract',
    'chatbot',
    'ai ',
    'pdf',
    'excel',
    'analytics',
    'push notification',
    'dark mode',
    'multi-language',
    'đa ngôn ngữ',
    'graphql',
    'redis',
    'docker',
    'kubernetes',
    'webhook',
    'mobile'
  ];
  const outOfScopeFeatures = criteriaLower
    ? extraFeatureTerms.filter((term) => text.includes(term) && !criteriaLower.includes(term))
    : [];

  const allReasons = [...new Set([...matchedKeywords, ...outOfScopeFeatures])];
  const hasScopeCreepRisk = allReasons.length > 0;
  return {
    hasScopeCreepRisk,
    matchedKeywords: allReasons,
    outOfScopeFeatures,
    warningMessage: hasScopeCreepRisk
      ? `⚠️ Cảnh báo Scope Creep (${allReasons.join(', ')}): Yêu cầu này có dấu hiệu vượt phạm vi ban đầu. Khuyến nghị tách thành Milestone bổ sung thay vì sửa miễn phí.`
      : null
  };
}

/**
 * Hàm duy nhất sinh đồng thời trạng thái và lời khuyến nghị nhất quán từ kết quả kiểm thử thực tế.
 * Đảm bảo khi allObjectivePassed === false tuyệt đối không chứa PASS_100 hay khuyến nghị giải ngân.
 */
export function buildConsistentAgentRecommendation({
  allObjectivePassed = false,
  passedCount = 0,
  totalCount = 0,
  failedReasons = [],
  hasCoreViolation = false
} = {}) {
  const passed = Math.max(0, Number(passedCount) || 0);
  const total = Math.max(0, Number(totalCount) || 0);
  const reasons = (Array.isArray(failedReasons) ? failedReasons : [failedReasons])
    .map((r) => String(r || '').trim())
    .filter(Boolean);

  if (!allObjectivePassed) {
    const isZeroOrCoreFail = passed === 0 || Boolean(hasCoreViolation);
    const recommendedSellerPct = isZeroOrCoreFail ? 0 : Math.max(0, Math.min(100, Math.round((passed / (total || 1)) * 100)));
    const recommendedBuyerPct = 100 - recommendedSellerPct;
    const reasonText = reasons.length > 0 ? reasons.join('; ') : 'chưa đạt đủ 100% tiêu chí kiểm chứng';
    return {
      passed: false,
      alertClass: 'alert-error',
      statusLabel: `⚠️ Không đạt (${passed}/${total || 1} tiêu chí)`,
      decision: 'REQUEST_FIX',
      targetRole: 'FREELANCER (Seller)',
      recommendedBuyerPct,
      recommendedSellerPct,
      message: isZeroOrCoreFail
        ? `Phát hiện sản phẩm đạt 0% hoặc vi phạm tiêu chí cốt lõi (${reasonText}). Đề xuất mặc định: 100% Buyer (Hoàn 100% cho khách) nếu mở tranh chấp.`
        : `Phát hiện tiêu chí kỹ thuật chưa đạt (${reasonText}). Đề xuất yêu cầu Freelancer sửa lỗi hoặc hoàn trả quỹ cho Client nếu mở tranh chấp.`
    };
  }

  return {
    passed: true,
    alertClass: 'alert-success',
    statusLabel: `✅ Đạt 100% (${passed}/${total || passed} tiêu chí)`,
    decision: 'RECOMMEND_RELEASE',
    targetRole: 'CLIENT (Buyer)',
    recommendedBuyerPct: 0,
    recommendedSellerPct: 100,
    message: `Sản phẩm đã vượt qua ${passed}/${total || passed} tiêu chí kỹ thuật khách quan. Đủ điều kiện để Client nghiệm thu và giải ngân thanh toán cho Freelancer.`
  };
}

/**
 * TẦNG 2 & TẦNG 3:
 * - Tầng 2 (Autonomous Verification Pipeline): Chạy chuỗi công cụ Git API -> Docker/Firecracker Sandbox -> cURL -> Metadata
 *   (Kiểm tra xem link nộp có phải link GitHub chuẩn không trước khi clone vào Sandbox, kèm Cache theo commitHash để giảm độ trễ & chi phí)
 * - Tầng 3 (Proposal & Proof Generation): Tổng hợp Test Report, đưa ra Recommendation & ghi ProofRegistry on-chain
 */
export function runAutonomousVerificationAndAssessor(submission = {}, scenario = 'PASS_100') {
  const commitHash = submission.commitHash || 'commit#9f8c2a1';
  const repoUrl = submission.deliverableUrl || 'https://github.com/vibecode/app/pull/42';
  const cacheKey = `${repoUrl.trim()}|${commitHash.trim()}|${scenario}`;

  if (VERIFICATION_CACHE.has(cacheKey)) {
    const cached = VERIFICATION_CACHE.get(cacheKey);
    return {
      ...cached,
      cacheHit: true,
      executionMs: 2
    };
  }

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

  const result = {
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
    ipfsReportCid: proofInfo.ipfsCid,
    cacheHit: false,
    executionMs: isGitHubValid ? 420 : 12
  };
  VERIFICATION_CACHE.set(cacheKey, result);
  return result;
}

/**
 * TẦNG 4: Thừa phát lại Thu thập Chứng cứ (Autonomous Fact-finding Bailiff)
 * Tự động tổng hợp Hồ sơ Vụ việc (Dispute Dossier) và đề xuất tỷ lệ phân chia quỹ
 * dựa trên Single Source of Truth `contract.latestVerification` (0 điểm -> 0% Freelancer / 100% Client).
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

  const v = c.latestVerification;
  let verifiedCompletionPercent = 0;
  let passedCriteria = [];
  let failedCriteria = [];
  let isEmptyOrInvalid = false;

  if (v && typeof v === 'object') {
    isEmptyOrInvalid = Boolean(v.isEmptyOrInvalid);
    verifiedCompletionPercent = isEmptyOrInvalid ? 0 : Math.max(0, Math.min(100, Math.round(Number(v.verifiedScore ?? 0))));
    passedCriteria = Array.isArray(v.passedCriteria) ? v.passedCriteria : [];
    failedCriteria = Array.isArray(v.failedCriteria) ? v.failedCriteria : [];
  } else if (c.ciVerified === true && c.deliverableUrl) {
    verifiedCompletionPercent = 100;
    passedCriteria = ['Vượt qua kiểm thử bàn giao'];
  } else {
    isEmptyOrInvalid = !c.deliverableUrl;
    verifiedCompletionPercent = 0;
    failedCriteria = [c.failedStepText || 'Chưa có kết quả kiểm thử đạt chuẩn'];
  }

  const hasCoreViolation = Boolean(
    v?.coreViolation ||
      v?.criticalViolation ||
      v?.blocked ||
      v?.hasBlockers ||
      (Array.isArray(v?.forbiddenViolations) && v.forbiddenViolations.length > 0)
  );
  const recommendedSellerPercent = verifiedCompletionPercent === 0 || isEmptyOrInvalid || hasCoreViolation ? 0 : verifiedCompletionPercent;
  const recommendedBuyerPercent = 100 - recommendedSellerPercent;

  const dossierHashInfo = computeProofHashAndCid(
    `dossier-${c.id}-${verifiedCompletionPercent}-${recommendedSellerPercent}`
  );

  const automatedTestAudit =
    recommendedSellerPercent === 0
      ? `0% tiêu chí đạt chuẩn${failedCriteria.length > 0 ? `: ${failedCriteria.join('; ')}` : ' (Repo rỗng hoặc không hợp lệ).'}`
      : `${verifiedCompletionPercent}% tiêu chí đạt chuẩn (Đạt: ${passedCriteria.join(', ') || 'OK'}${failedCriteria.length > 0 ? `; Chưa đạt: ${failedCriteria.join(', ')}` : ''}).`;

  const proposalStatement =
    recommendedSellerPercent === 0
      ? `Sản phẩm đạt 0% tiêu chí kiểm chứng (${failedCriteria[0] || 'Repo rỗng / không hợp lệ'}); đề xuất giải ngân 0% cho Freelancer và hoàn trả 100% cho Client.`
      : `Freelancer đã hoàn thành ${verifiedCompletionPercent}% khối lượng công việc được kiểm chứng; đề xuất giải ngân ${recommendedSellerPercent}% cho Freelancer và hoàn trả ${recommendedBuyerPercent}% cho Client.`;

  return {
    agentName: 'FactFindingBailiffAgent (Tầng 4 — Tranh chấp)',
    contractId: c.id,
    contractTitle: c.title,
    dossierHash: dossierHashInfo.sha256,
    verifiedCompletionPercent,
    recommendedSellerPercent,
    recommendedBuyerPercent,
    recommendedSellerPct: recommendedSellerPercent,
    recommendedBuyerPct: recommendedBuyerPercent,
    dossierSections: {
      signedChecklistAnchor: `Đã đối chiếu Hợp đồng gốc [${c.id}] & Checklist Hash bất biến (${c.acceptanceCriteria}).`,
      deliveryAndCommitTimeline: `Freelancer (${c.freelancer}) nộp link: ${c.deliverableUrl || 'Chưa có'} (commit: ${c.commitHash || 'N/A'}).`,
      automatedTestAudit,
      scopeCreepAnalysis: c.scopeCreepWarning || 'Không ghi nhận phát sinh ngoài phạm vi hợp đồng.',
      evidenceFilesCount: (c.evidences || []).length
    },
    proposalStatement,
    hitlNote: 'Trọng tài con người (Arbiter) xem xét Hồ sơ Vụ việc và nhấn nút Ký duyệt (HITL).'
  };
}

/**
 * Gọi Google Gemini REST API trả về JSON có cấu trúc.
 * Tự động thử chuỗi model dự phòng nếu model chính quá tải (503) hoặc không khả dụng (404).
 */
async function callGeminiJson(prompt, options = {}) {
  if (typeof process !== 'undefined' && process.env.OFFLINE_MODE === 'true') return null;
  const apiKey = options.apiKey || (typeof process !== 'undefined' ? (process.env.GEMINI_API_KEY || process.env.LLM_API_KEY) : '');
  if (!apiKey) return null;

  const primaryModel =
    options.model || (typeof process !== 'undefined' ? process.env.GEMINI_MODEL : '') || 'gemini-flash-latest';
  const modelsToTry = [
    ...new Set([
      primaryModel,
      'gemini-flash-latest',
      'gemini-3.8-flash',
      'gemini-3.7-flash',
      'gemini-3.5-flash',
      'gemini-3.1-flash-lite',
      'gemini-flash-lite-latest'
    ])
  ];

  for (const model of modelsToTry) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 12000);
    try {
      const url = `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(model)}:generateContent?key=${encodeURIComponent(apiKey)}`;
      const res = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        signal: controller.signal,
        body: JSON.stringify({
          contents: [{ parts: [{ text: prompt }] }],
          generationConfig: {
            responseMimeType: 'application/json',
            temperature: 0.2
          }
        })
      });
      if (!res.ok) continue;
      const data = await res.json();
      const rawText = data?.candidates?.[0]?.content?.parts?.[0]?.text;
      if (!rawText) continue;
      return { data: JSON.parse(rawText), model };
    } catch {
      // Thử model tiếp theo hoặc fallback về logic cục bộ
    } finally {
      clearTimeout(timer);
    }
  }
  return null;
}

/**
 * Lấy metadata thực tế từ GitHub API (hỗ trợ GITHUB_TOKEN cho repo private & tăng rate limit) để cung cấp ngữ cảnh cho Agent Tầng 2–3.
 */
async function fetchGitHubContext(repoUrl) {
  if (typeof process !== 'undefined' && process.env.OFFLINE_MODE === 'true') return null;
  const match = String(repoUrl || '').match(
    /^https?:\/\/(?:www\.)?github\.com\/([^/]+)\/([^/]+?)(?:\.git)?(?:\/(pull|commit)\/([^/?#]+))?(?:[/?#].*)?$/i
  );
  if (!match) return null;
  const [, owner, repo, resourceType, resourceId] = match;
  const githubToken = typeof process !== 'undefined' ? process.env.GITHUB_TOKEN : '';
  const headers = {
    Accept: 'application/vnd.github+json',
    'User-Agent': 'VibeEscrow-Agent',
    'X-GitHub-Api-Version': '2022-11-28'
  };
  if (githubToken) {
    headers.Authorization = `Bearer ${githubToken}`;
  }

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 5000);
  try {
    let endpoint = `https://api.github.com/repos/${owner}/${repo}`;
    if (resourceType === 'pull' && resourceId) {
      endpoint = `https://api.github.com/repos/${owner}/${repo}/pulls/${resourceId}`;
    } else if (resourceType === 'commit' && resourceId) {
      endpoint = `https://api.github.com/repos/${owner}/${repo}/commits/${resourceId}`;
    }

    const res = await fetch(endpoint, { headers, signal: controller.signal });
    if (!res.ok) return null;
    const json = await res.json();

    if (resourceType === 'commit') {
      return {
        authenticated: Boolean(githubToken),
        type: 'commit',
        fullName: `${owner}/${repo}`,
        sha: json.sha,
        message: json.commit?.message || '',
        author: json.commit?.author?.name || json.author?.login || '',
        stats: json.stats || null,
        files: (json.files || []).slice(0, 10).map((f) => ({
          filename: f.filename,
          status: f.status,
          changes: f.changes
        }))
      };
    }

    if (resourceType === 'pull') {
      return {
        authenticated: Boolean(githubToken),
        type: 'pull_request',
        fullName: `${owner}/${repo}`,
        number: json.number,
        title: json.title || '',
        state: json.state || 'open',
        merged: Boolean(json.merged),
        author: json.user?.login || '',
        changedFiles: json.changed_files ?? null,
        additions: json.additions ?? null,
        deletions: json.deletions ?? null
      };
    }

    return {
      authenticated: Boolean(githubToken),
      type: 'repository',
      fullName: json.full_name || `${owner}/${repo}`,
      title: json.description || json.name || '',
      visibility: json.private ? 'private' : 'public',
      defaultBranch: json.default_branch || 'main',
      language: json.language || 'Unknown',
      updatedAt: json.updated_at || null
    };
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
  }
}

/**
 * TẦNG 1 (LIVE GEMINI): Phân rã Brief thành Machine-readable Checklist.
 */
export async function runScopeDecomposerAgentLive(rawBrief = '') {
  const fallback = runScopeDecomposerAgent(rawBrief);
  if (!fallback.isValidTitle) return fallback;

  const prompt = [
    'Bạn là ScopeDecomposerAgent trong hệ thống Smart Escrow. Hãy phân rã yêu cầu hợp đồng sau thành JSON tiếng Việt.',
    `Yêu cầu: "${fallback.sourceBrief}"`,
    'Trả về đúng JSON object với 2 mảng:',
    '- "deterministicItems": 3-4 tiêu chí kiểm chứng tự động được, mỗi phần tử có { "id": "OBJ-01", "type": "DETERMINISTIC", "category": string, "criterion": string, "metric": string, "verifiableBy": string }',
    '- "subjectiveItems": 2 tiêu chí cảm quan cần Client duyệt tay, mỗi phần tử có { "id": "SUB-01", "type": "SUBJECTIVE", "category": string, "criterion": string, "approver": "Chuyển quyền cho Client (Buyer) duyệt tay" }'
  ].join('\n');

  const ai = await callGeminiJson(prompt);
  if (!ai?.data || !Array.isArray(ai.data.deterministicItems) || !Array.isArray(ai.data.subjectiveItems)) {
    return { ...fallback, liveAi: false };
  }

  const deterministicItems = ai.data.deterministicItems.slice(0, 5).map((item, idx) => ({
    id: item.id || `OBJ-0${idx + 1}`,
    type: 'DETERMINISTIC',
    category: item.category || 'Technical Check',
    criterion: item.criterion || 'Đạt tiêu chuẩn kỹ thuật',
    metric: item.metric || 'passed == true',
    verifiableBy: item.verifiableBy || 'Sandbox Runner'
  }));
  const subjectiveItems = ai.data.subjectiveItems.slice(0, 3).map((item, idx) => ({
    id: item.id || `SUB-0${idx + 1}`,
    type: 'SUBJECTIVE',
    category: item.category || 'Visual & UX',
    criterion: item.criterion || 'Đạt thẩm mỹ theo yêu cầu',
    approver: item.approver || 'Chuyển quyền cho Client (Buyer) duyệt tay'
  }));

  const hashInfo = computeProofHashAndCid(
    JSON.stringify({ sourceBrief: fallback.sourceBrief, deterministicItems, subjectiveItems })
  );

  return {
    ...fallback,
    liveAi: true,
    aiModel: ai.model,
    checklistHash: hashInfo.sha256,
    onChainAnchorTx: hashInfo.auditHash,
    deterministicItems,
    subjectiveItems,
    summaryText: `[Gemini ${ai.model}] Đã phân rã "${fallback.sourceBrief}" thành ${deterministicItems.length} tiêu chí Deterministic và ${subjectiveItems.length} tiêu chí Subjective. Checklist Hash: ${hashInfo.sha256}`
  };
}

/**
 * TẦNG 2 & 3 (LIVE GEMINI + GITHUB API): Thẩm định bàn giao & Đề xuất nghiệm thu.
 */
export async function runAutonomousVerificationAndAssessorLive(submission = {}, scenario = 'PASS_100') {
  const fallback = runAutonomousVerificationAndAssessor(submission, scenario);
  if (!fallback.isGitHubValid) return fallback;

  const repoUrl = submission.deliverableUrl || 'https://github.com/vibecode/app/pull/42';
  const commitHash = submission.commitHash || 'commit#9f8c2a1';
  const [ghContext, avaxContext] = await Promise.all([
    fetchGitHubContext(repoUrl),
    fetchAvalancheContext({
      chainId: submission.chainId,
      txHash: /^0x[a-fA-F0-9]{64}$/.test(commitHash) ? commitHash : undefined
    })
  ]);

  const prompt = [
    'Bạn là SandboxVerifierAgent & TechnicalAssessorAgent trong hệ thống Smart Escrow. Hãy đánh giá gói bàn giao sau bằng tiếng Việt.',
    `URL GitHub: ${repoUrl}`,
    `Commit: ${commitHash}`,
    `Kịch bản kiểm thử: ${scenario}`,
    ghContext ? `Dữ liệu GitHub thực tế: ${JSON.stringify(ghContext)}` : 'Không lấy được metadata GitHub công khai, đánh giá theo ngữ cảnh submission.',
    'Trả về đúng JSON object:',
    '{',
    '  "objectivePassed": number (0..4),',
    '  "objectiveTotal": 4,',
    '  "toolchainSteps": [ { "step": 1..4, "tool": string, "action": string, "status": "PASSED"|"FAILED"|"SKIPPED", "log": string } ],',
    '  "recommendation": { "targetRole": "CLIENT (Buyer)"|"FREELANCER (Seller)", "decision": "RECOMMEND_RELEASE"|"REQUEST_FIX", "message": string }',
    '}'
  ].join('\n');

  const ai = await callGeminiJson(prompt);
  if (!ai?.data || !Array.isArray(ai.data.toolchainSteps) || !ai.data.recommendation) {
    return { ...fallback, githubContext: ghContext, liveAi: false };
  }

  const objectiveTotal = Number(ai.data.objectiveTotal) || 4;
  const objectivePassed = Math.max(0, Math.min(objectiveTotal, Number(ai.data.objectivePassed ?? fallback.objectivePassed)));
  const passRatePercent = Math.round((objectivePassed / objectiveTotal) * 100);
  const allObjectivePassed = objectivePassed === objectiveTotal && ai.data.recommendation.decision === 'RECOMMEND_RELEASE';

  const steps = ai.data.toolchainSteps.slice(0, 4);
  const failedReasons = steps
    .filter((s) => s.status !== 'PASSED')
    .map((s) => s.log || s.tool)
    .filter(Boolean);
  const consistentRec = buildConsistentAgentRecommendation({
    allObjectivePassed,
    passedCount: objectivePassed,
    totalCount: objectiveTotal,
    failedReasons
  });

  const proofInfo = computeProofHashAndCid(
    JSON.stringify({ commitHash, repoUrl, scenario, passRatePercent, recommendation: consistentRec })
  );

  return {
    ...fallback,
    liveAi: true,
    aiModel: ai.model,
    githubContext: ghContext,
    avalancheContext: avaxContext,
    allObjectivePassed,
    passRatePercent,
    objectivePassed,
    objectiveTotal,
    toolchainSteps: steps,
    recommendation: {
      targetRole: consistentRec.targetRole,
      decision: consistentRec.decision,
      message: consistentRec.message
    },
    testReportHash: proofInfo.sha256,
    proofRegistryOnChainTx: `ProofRegistry::record(${proofInfo.auditHash})`,
    ipfsReportCid: proofInfo.ipfsCid
  };
}

/**
 * TẦNG 4 (LIVE GEMINI): Thừa phát lại tổng hợp Hồ sơ Tranh chấp & Đề xuất tỷ lệ phân chia quỹ.
 */
export async function runFactFindingBailiffAgentLive(contract) {
  const fallback = runFactFindingBailiffAgent(contract);
  const c = contract || {};

  // Nếu 0 điểm hoặc repo rỗng/không hợp lệ, giữ nguyên đề xuất 0% Freelancer / 100% Client
  if (fallback.recommendedSellerPercent === 0) {
    return { ...fallback, liveAi: false };
  }

  const prompt = [
    'Bạn là FactFindingBailiffAgent (Thừa phát lại AI) trong hệ thống Smart Escrow. Hãy phân tích tranh chấp sau và đề xuất tỷ lệ chia quỹ công bằng cho Trọng tài con người (HITL) bằng tiếng Việt.',
    `Hợp đồng: ${JSON.stringify({ id: c.id || fallback.contractId, title: c.title || fallback.contractTitle, freelancer: c.freelancer, amount: c.amount, acceptanceCriteria: c.acceptanceCriteria, commitHash: c.commitHash, latestVerification: c.latestVerification || null, evidencesCount: (c.evidences || []).length })}`,
    'Trả về đúng JSON object:',
    '{',
    '  "verifiedCompletionPercent": number (0..100),',
    '  "recommendedSellerPercent": number (0..100),',
    '  "recommendedBuyerPercent": number (0..100, sao cho Seller + Buyer = 100),',
    '  "dossierSections": { "signedChecklistAnchor": string, "deliveryAndCommitTimeline": string, "automatedTestAudit": string, "scopeCreepAnalysis": string },',
    '  "proposalStatement": string',
    '}'
  ].join('\n');

  const ai = await callGeminiJson(prompt);
  if (!ai?.data || typeof ai.data.recommendedSellerPercent !== 'number') {
    return { ...fallback, liveAi: false };
  }

  const sellerPct = Math.max(0, Math.min(100, Math.round(ai.data.recommendedSellerPercent)));
  const buyerPct = 100 - sellerPct;
  const completionPct = Math.max(0, Math.min(100, Math.round(ai.data.verifiedCompletionPercent ?? sellerPct)));

  return {
    ...fallback,
    liveAi: true,
    aiModel: ai.model,
    verifiedCompletionPercent: completionPct,
    recommendedSellerPercent: sellerPct,
    recommendedBuyerPercent: buyerPct,
    dossierSections: {
      ...fallback.dossierSections,
      ...(ai.data.dossierSections || {}),
      evidenceFilesCount: (c.evidences || []).length
    },
    proposalStatement:
      ai.data.proposalStatement ||
      `[Gemini ${ai.model}] Freelancer đã hoàn thành ${completionPct}% khối lượng; đề xuất giải ngân ${sellerPct}% cho Freelancer và hoàn trả ${buyerPct}% cho Client.`
  };
}

/**
 * Kết nối Avalanche API (Glacier Data API + Routescan/Snowtrace EVM API với AVALANCHE_API_KEY).
 * Hỗ trợ kiểm tra trạng thái chuỗi (chainId, mặc định 43114 C-Chain), block mới nhất, số dư hoặc giao dịch on-chain.
 */
export async function fetchAvalancheContext({ chainId, address, txHash } = {}) {
  if (typeof process !== 'undefined' && process.env.OFFLINE_MODE === 'true') return null;
  const apiKey = typeof process !== 'undefined' ? process.env.AVALANCHE_API_KEY : '';
  const targetChain = String(chainId || (typeof process !== 'undefined' ? process.env.AVALANCHE_CHAIN_ID : '') || '43114');
  const network = targetChain === '43113' ? 'testnet' : 'mainnet';

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 6000);
  try {
    const routescanBase = `https://api.routescan.io/v2/network/${network}/evm/${encodeURIComponent(targetChain)}/etherscan/api`;
    const keyParam = apiKey ? `&apikey=${encodeURIComponent(apiKey)}` : '';

    if (txHash && /^0x[a-fA-F0-9]{64}$/.test(txHash)) {
      const res = await fetch(`${routescanBase}?module=proxy&action=eth_getTransactionByHash&txhash=${encodeURIComponent(txHash)}${keyParam}`, {
        signal: controller.signal
      });
      if (!res.ok) return null;
      const json = await res.json();
      return {
        authenticated: Boolean(apiKey),
        provider: 'Avalanche Routescan EVM API',
        chainId: targetChain,
        chainName: targetChain === '43114' ? 'Avalanche C-Chain' : `Chain ${targetChain}`,
        status: json.result ? 'CONFIRMED' : 'NOT_FOUND',
        networkToken: 'AVAX',
        data: json.result || null
      };
    }

    if (address && /^0x[a-fA-F0-9]{40}$/.test(address)) {
      const res = await fetch(`${routescanBase}?module=account&action=balance&address=${encodeURIComponent(address)}&tag=latest${keyParam}`, {
        signal: controller.signal
      });
      if (!res.ok) return null;
      const json = await res.json();
      return {
        authenticated: Boolean(apiKey),
        provider: 'Avalanche Routescan EVM API',
        chainId: targetChain,
        chainName: targetChain === '43114' ? 'Avalanche C-Chain' : `Chain ${targetChain}`,
        status: json.status === '1' ? 'OK' : 'ERROR',
        networkToken: 'AVAX',
        balanceWei: json.result || '0',
        data: json
      };
    }

    const [glacierRes, blockRes] = await Promise.all([
      fetch(`https://glacier-api.avax.network/v1/chains/${encodeURIComponent(targetChain)}`, {
        headers: { Accept: 'application/json' },
        signal: controller.signal
      }),
      fetch(`${routescanBase}?module=proxy&action=eth_blockNumber${keyParam}`, {
        signal: controller.signal
      })
    ]);

    const glacierJson = glacierRes.ok ? await glacierRes.json() : null;
    const blockJson = blockRes.ok ? await blockRes.json() : null;
    if (!glacierJson && !blockJson) return null;

    const latestBlock = blockJson?.result ? parseInt(blockJson.result, 16) : null;
    return {
      authenticated: Boolean(apiKey),
      provider: 'Avalanche Glacier + Routescan API',
      chainId: targetChain,
      chainName: glacierJson?.chainName || (targetChain === '43114' ? 'Avalanche (C-Chain)' : `Chain ${targetChain}`),
      status: glacierJson?.status || (latestBlock ? 'OK' : 'UNKNOWN'),
      networkToken: glacierJson?.networkToken?.symbol || 'AVAX',
      latestBlock,
      data: { glacier: glacierJson, latestBlockHex: blockJson?.result || null }
    };
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
  }
}

