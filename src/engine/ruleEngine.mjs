import { computeSha256 } from './baselineManager.mjs';

const OPERATORS = {
  '==': (actual, expected) => actual === expected,
  '>=': (actual, expected) => Number(actual) >= Number(expected),
  '<=': (actual, expected) => Number(actual) <= Number(expected),
  '>': (actual, expected) => Number(actual) > Number(expected),
  '<': (actual, expected) => Number(actual) < Number(expected),
  CONTAINS: (actual, expected) =>
    Array.isArray(actual)
      ? actual.includes(expected)
      : String(actual ?? '').includes(String(expected ?? '')),
  NOT_STARTS_WITH: (actual, expected) => !String(actual ?? '').startsWith(String(expected ?? ''))
};

function normalizePath(filePath) {
  return String(filePath || '')
    .trim()
    .replace(/\\/g, '/')
    .replace(/^\.\//, '')
    .replace(/\/+$/, '');
}

function matchesForbiddenRule(changedFile, rule) {
  const file = normalizePath(changedFile);
  const pattern = normalizePath(rule);
  if (!file || !pattern) return false;

  if (pattern.includes('*')) {
    const escaped = pattern
      .replace(/[.+^${}()|[\]\\]/g, '\\$&')
      .replace(/\*\*/g, '.*')
      .replace(/\*/g, '[^/]*');
    return new RegExp(`^${escaped}$`).test(file);
  }

  return file === pattern || file.startsWith(`${pattern}/`);
}

function evaluateDeterministicCriterion(criterion, metrics = {}) {
  const hasMetric = Object.prototype.hasOwnProperty.call(metrics, criterion.metric);
  const actualValue = hasMetric ? metrics[criterion.metric] : undefined;
  const comparator = OPERATORS[criterion.operator];
  const passed =
    hasMetric &&
    actualValue !== undefined &&
    actualValue !== null &&
    typeof comparator === 'function' &&
    comparator(actualValue, criterion.expectedValue);

  return {
    id: criterion.id,
    metric: criterion.metric,
    operator: criterion.operator,
    expectedValue: criterion.expectedValue,
    actualValue: hasMetric ? actualValue : null,
    weight: criterion.weight,
    passed: Boolean(passed)
  };
}

/**
 * Evaluate a freelancer submission against an immutable baseline using deterministic rules.
 * Never executes fund transfers; outputs a recommendation and SHA-256 `testReportHash`.
 */
export function evaluateSubmission(baseline, submissionData = {}) {
  if (!baseline || !Array.isArray(baseline.acceptanceCriteria)) {
    throw new Error('A valid baseline with acceptanceCriteria is required');
  }

  const changedFiles = Array.isArray(submissionData.changedFiles) ? submissionData.changedFiles : [];
  const forbiddenPaths = Array.isArray(baseline.scopeConstraints?.forbiddenPaths)
    ? baseline.scopeConstraints.forbiddenPaths
    : [];

  const forbiddenViolations = [];
  for (const file of changedFiles) {
    const matchedRule = forbiddenPaths.find((rule) => matchesForbiddenRule(file, rule));
    if (matchedRule) {
      forbiddenViolations.push({ file: normalizePath(file), matchedRule });
    }
  }

  const subjectiveCriteria = baseline.acceptanceCriteria
    .filter((c) => c.type === 'SUBJECTIVE')
    .map((c) => ({
      id: c.id,
      description: c.description,
      requiresHitl: true,
      weight: c.weight
    }));

  if (forbiddenViolations.length > 0) {
    const blockedReport = {
      agreementId: baseline.agreementId,
      milestoneId: baseline.milestoneId,
      baselineHash: baseline.baselineHash,
      blocked: true,
      forbiddenViolations,
      deterministicScore: 0,
      deterministicResults: [],
      pendingHitlCriteria: subjectiveCriteria,
      recommendation: 'BLOCK_AND_FLAG',
      evaluatedAt: new Date().toISOString()
    };
    return {
      ...blockedReport,
      testReportHash: computeSha256(blockedReport)
    };
  }

  const deterministicCriteria = baseline.acceptanceCriteria.filter((c) => c.type === 'DETERMINISTIC');
  const metrics = submissionData.metrics && typeof submissionData.metrics === 'object' ? submissionData.metrics : {};
  const deterministicResults = deterministicCriteria.map((c) => evaluateDeterministicCriterion(c, metrics));

  const totalWeight = deterministicResults.reduce((sum, item) => sum + (item.weight || 1), 0);
  const earnedWeight = deterministicResults.reduce((sum, item) => sum + (item.passed ? item.weight || 1 : 0), 0);
  const deterministicScore = totalWeight > 0 ? Math.round((earnedWeight / totalWeight) * 100) : 100;

  const hasDeterministicFailure = deterministicResults.some((item) => !item.passed);

  let recommendation;
  if (hasDeterministicFailure) {
    recommendation = 'REQUEST_REVISION';
  } else if (subjectiveCriteria.length > 0) {
    recommendation = 'READY_FOR_CLIENT_REVIEW';
  } else {
    recommendation = 'AUTO_RECOMMEND_RELEASE';
  }

  const reportPayload = {
    agreementId: baseline.agreementId,
    milestoneId: baseline.milestoneId,
    baselineHash: baseline.baselineHash,
    blocked: false,
    forbiddenViolations: [],
    deterministicScore,
    deterministicResults,
    pendingHitlCriteria: subjectiveCriteria,
    recommendation,
    evaluatedAt: new Date().toISOString()
  };

  return {
    ...reportPayload,
    testReportHash: computeSha256(reportPayload)
  };
}

/**
 * Tính toán tỷ lệ phân chia quỹ tranh chấp dựa trên Công thức Trọng số (Weighted Criteria Formula)
 * và Ma trận 5 kịch bản (Decision Matrix) cho Trọng tài viên (HITL) ký resolveDispute() on-chain.
 *
 * R_freelancer = W_passed + (alpha * W_subjective) - P_penalty
 * R_client = 100 - R_freelancer
 */
export function calculateDisputeSplit(baseline, submissionData = {}, disputeContext = {}) {
  const evaluation = evaluateSubmission(baseline, submissionData);
  const criteria = baseline.acceptanceCriteria || [];
  const totalRawWeight = criteria.reduce((sum, c) => sum + (Number(c.weight) || 0), 0) || 100;
  const normalizeWeight = (w) => ((Number(w) || 0) / totalRawWeight) * 100;

  const resultById = new Map(evaluation.deterministicResults.map((r) => [r.id, r]));

  let wPassed = 0;
  let wFailed = 0;
  let wSubjective = 0;

  for (const c of criteria) {
    const w = normalizeWeight(c.weight);
    if (c.type === 'DETERMINISTIC') {
      if (resultById.get(c.id)?.passed) {
        wPassed += w;
      } else {
        wFailed += w;
      }
    } else if (c.type === 'SUBJECTIVE') {
      wSubjective += w;
    }
  }

  wPassed = Math.round(wPassed * 100) / 100;
  wFailed = Math.round(wFailed * 100) / 100;
  wSubjective = Math.round(wSubjective * 100) / 100;

  const emptyRepo = Boolean(submissionData.emptyRepo || disputeContext.emptyRepo);
  const clientGhosted = Boolean(disputeContext.clientGhosted || disputeContext.inspectionWindowExpired);
  const subjectiveApproved = Boolean(disputeContext.subjectiveApproved);
  const lateDays = Math.max(0, Number(disputeContext.lateDays) || 0);
  const dailyPenaltyPercent = Math.max(0, Number(disputeContext.dailyPenaltyPercent) || 0);
  const explicitPenalty = Math.max(0, Number(disputeContext.penaltyPercent) || 0);
  const penaltyPercent = Math.min(100, Math.round((explicitPenalty + lateDays * dailyPenaltyPercent) * 100) / 100);

  // Kịch bản 1: Vi phạm nghiêm trọng / Gian lận (forbidden_paths, repo rỗng, hoặc 0% test pass)
  if (evaluation.blocked || emptyRepo || wPassed === 0) {
    const splitPayload = {
      agreementId: baseline.agreementId,
      milestoneId: baseline.milestoneId,
      baselineHash: baseline.baselineHash,
      scenarioCode: 'SCENARIO_1_SEVERE_VIOLATION',
      scenarioName: '1. Vi phạm nghiêm trọng / Gian lận',
      weights: { wPassed: 0, wFailed: Math.round(100 - wSubjective), wSubjective },
      alpha: 0,
      penaltyPercent,
      freelancerPercent: 0,
      clientPercent: 100,
      rationale: 'Không có giá trị bàn giao hợp lệ (vi phạm forbidden_paths, repo rỗng hoặc 0% test pass); hoàn toàn bộ tiền cho Client.'
    };
    return {
      ...splitPayload,
      disputeReportHash: computeSha256(splitPayload)
    };
  }

  const allDeterministicPassed = wFailed === 0;

  // Xác định hệ số thiện chí alpha (mặc định 0.5 trong [0, 0.5]; hoặc 1.0 nếu Client ghosting / đã duyệt cảm quan)
  let alpha = 0.5;
  if (clientGhosted || subjectiveApproved) {
    alpha = 1.0;
  } else if (typeof disputeContext.alpha === 'number') {
    alpha = Math.max(0, Math.min(0.5, disputeContext.alpha));
  }

  const rawFreelancer = wPassed + alpha * wSubjective - penaltyPercent;
  const freelancerPercent = Math.max(0, Math.min(100, Math.round(rawFreelancer * 100) / 100));
  const clientPercent = Math.round((100 - freelancerPercent) * 100) / 100;

  let scenarioCode = 'SCENARIO_2_PARTIAL_TECHNICAL';
  let scenarioName = '2. Hoàn thành một phần kỹ thuật';
  let rationale = `Thanh toán đúng theo tỷ lệ khối lượng công việc đã được kiểm chứng (${wPassed}% đạt, ${wFailed}% chưa đạt).`;

  if (allDeterministicPassed && clientGhosted && penaltyPercent === 0) {
    scenarioCode = 'SCENARIO_4_CLIENT_GHOSTING';
    scenarioName = '4. Client "ngâm" duyệt quá hạn (Ghosting)';
    rationale = 'Đạt 100% kỹ thuật và hết cửa sổ kiểm tra (Inspection Window) mà Client không phản hồi; kích hoạt đề xuất giải ngân toàn bộ.';
  } else if (allDeterministicPassed && penaltyPercent > 0 && (wSubjective === 0 || subjectiveApproved || clientGhosted)) {
    scenarioCode = 'SCENARIO_5_LATE_PENALTY';
    scenarioName = '5. Trễ hạn có điều khoản phạt';
    rationale = `Đạt 100% tiêu chí nhưng khấu trừ ${penaltyPercent}% phí phạt chậm tiến độ (${lateDays} ngày x ${dailyPenaltyPercent}%/ngày).`;
  } else if (allDeterministicPassed && wSubjective > 0) {
    scenarioCode = 'SCENARIO_3_SUBJECTIVE_DISPUTE';
    scenarioName = '3. Đạt 100% kỹ thuật nhưng bất đồng thẩm mỹ';
    rationale = `Phần lõi kỹ thuật (${wPassed}%) đã hoạt động đúng cam kết; áp dụng hệ số thiện chí alpha=${alpha} trên ${wSubjective}% phần chủ quan.`;
  }

  const splitPayload = {
    agreementId: baseline.agreementId,
    milestoneId: baseline.milestoneId,
    baselineHash: baseline.baselineHash,
    scenarioCode,
    scenarioName,
    weights: { wPassed, wFailed, wSubjective },
    alpha,
    penaltyPercent,
    freelancerPercent,
    clientPercent,
    rationale
  };

  return {
    ...splitPayload,
    disputeReportHash: computeSha256(splitPayload)
  };
}

