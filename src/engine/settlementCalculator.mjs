import { computeSha256 } from './baselineManager.mjs';

/**
 * Tính toán khuyến nghị chia quỹ đóng băng dựa trên điểm chấm nghiệm thu thực tế từ Rule Engine
 * và các luật bảo vệ (Blocker -> 0% Freelancer / 100% Client; rớt is_critical -> trần tối đa 30%).
 */
export function calculateFrozenFundSplit({
  frozenAmount = 0,
  baseline = {},
  evaluationReport = {},
  hitlDisputeResolutionRatio = 0.5
} = {}) {
  const totalFrozen = Math.max(0, Math.round(Number(frozenAmount) || 0));
  const rawRatio = Number(hitlDisputeResolutionRatio);
  const hitlRatio = Number.isFinite(rawRatio) ? Math.max(0, Math.min(1, rawRatio)) : 0.5;

  const criteria = Array.isArray(baseline?.acceptanceCriteria) ? baseline.acceptanceCriteria : [];
  const totalWeight = criteria.reduce((sum, c) => sum + (Number(c.weight) || 0), 0) || 100;
  const detResults = Array.isArray(evaluationReport?.deterministicResults)
    ? evaluationReport.deterministicResults
    : [];

  const hasBlockers = Boolean(
    evaluationReport?.blocked ||
      (Array.isArray(evaluationReport?.forbiddenViolations) && evaluationReport.forbiddenViolations.length > 0) ||
      (Array.isArray(evaluationReport?.blockers) && evaluationReport.blockers.length > 0)
  );

  let criticalFailure = false;
  let earnedWeightSum = 0;

  const breakdown = criteria.map((c, idx) => {
    const normalizedWeight = Math.round((((Number(c.weight) || 0) / totalWeight) * 100) * 100) / 100;
    const isCritical = Boolean(c.is_critical || c.isCritical);

    if (c.type === 'DETERMINISTIC') {
      const matched = detResults.find((r) => r.id === c.id || (c.metric && r.metric === c.metric));
      const passed = Boolean(matched?.passed);
      if (!passed && isCritical) {
        criticalFailure = true;
      }
      const earnedPercent = hasBlockers ? 0 : passed ? normalizedWeight : 0;
      earnedWeightSum += earnedPercent;

      return {
        id: c.id || `OBJ-${idx + 1}`,
        type: 'DETERMINISTIC',
        metric: c.metric || null,
        isCritical,
        weightPercent: normalizedWeight,
        status: hasBlockers ? 'BLOCKED' : passed ? 'PASSED' : 'FAILED',
        earnedPercent,
        reason: hasBlockers
          ? 'Bị hủy điểm do vi phạm quy tắc chặn (Blockers / Forbidden Paths).'
          : passed
          ? `Đạt chuẩn (${matched?.actualValue ?? 'OK'} ${c.operator || ''} ${c.expectedValue ?? ''}).`
          : isCritical
          ? `Rớt tiêu chí bắt buộc is_critical (${matched?.actualValue ?? 'N/A'} vs ${c.operator || ''} ${c.expectedValue ?? ''}) — kích hoạt trần tối đa 30%.`
          : `Không đạt ngưỡng kỹ thuật (${matched?.actualValue ?? 'N/A'} vs ${c.operator || ''} ${c.expectedValue ?? ''}).`
      };
    }

    const earnedPercent = hasBlockers ? 0 : Math.round(normalizedWeight * hitlRatio * 100) / 100;
    earnedWeightSum += earnedPercent;

    return {
      id: c.id || `SUB-${idx + 1}`,
      type: 'SUBJECTIVE',
      description: c.description || c.clarifiedDescription || 'Đánh giá cảm quan (HITL)',
      isCritical,
      weightPercent: normalizedWeight,
      status: hasBlockers ? 'BLOCKED' : 'PENDING_HITL',
      earnedPercent,
      reason: hasBlockers
        ? 'Bị hủy điểm do vi phạm quy tắc chặn (Blockers).'
        : `Áp dụng tỷ lệ hòa giải HITL (${Math.round(hitlRatio * 100)}%) trên phần cảm quan.`
    };
  });

  const rawScorePercent =
    criteria.length > 0
      ? Math.max(0, Math.min(100, Math.round(earnedWeightSum * 100) / 100))
      : Math.max(0, Math.min(100, Number(evaluationReport?.deterministicScore) || 0));

  let freelancerPercent;
  let ruleApplied;
  let summaryReason;

  if (hasBlockers) {
    freelancerPercent = 0;
    ruleApplied = 'BLOCKER_VIOLATION_REFUND_100';
    summaryReason = 'Phát hiện vi phạm nghiêm trọng (Blockers / Forbidden Paths): hoàn trả 100% quỹ đóng băng cho Client.';
  } else if (criticalFailure) {
    freelancerPercent = Math.min(rawScorePercent, 30);
    ruleApplied = 'CRITICAL_CRITERION_CAP_30';
    summaryReason = `Rớt tiêu chí trọng yếu (is_critical: true): áp dụng trần thanh toán tối đa 30% cho Freelancer (điểm thô: ${rawScorePercent}%).`;
  } else {
    freelancerPercent = rawScorePercent;
    ruleApplied = 'WEIGHTED_SCORE_SPLIT';
    summaryReason = `Phân bổ quỹ theo đúng điểm nghiệm thu đạt chuẩn (${freelancerPercent}% Freelancer / ${Math.round((100 - freelancerPercent) * 100) / 100}% Client).`;
  }

  freelancerPercent = Math.max(0, Math.min(100, Math.round(freelancerPercent * 100) / 100));
  const clientPercent = Math.round((100 - freelancerPercent) * 100) / 100;

  const freelancerAmount = Math.round((totalFrozen * freelancerPercent) / 100);
  const clientAmount = Math.max(0, totalFrozen - freelancerAmount);

  const resultPayload = {
    frozenAmount: totalFrozen,
    productScorePercent: rawScorePercent,
    freelancerPercent,
    clientPercent,
    freelancerAmount,
    clientAmount,
    ruleApplied,
    criticalFailure,
    hasBlockers,
    summaryReason,
    breakdown
  };

  return {
    ...resultPayload,
    testReportHash: evaluationReport?.testReportHash || computeSha256(resultPayload)
  };
}
