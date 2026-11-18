import test from 'node:test';
import assert from 'node:assert/strict';
import { createBaseline } from '../src/engine/baselineManager.mjs';
import { evaluateSubmission } from '../src/engine/ruleEngine.mjs';
import { calculateFrozenFundSplit } from '../src/engine/settlementCalculator.mjs';

test('1. calculateFrozenFundSplit: chia tiền theo điểm PASSED/FAILED thực tế + hitlDisputeResolutionRatio và xuất breakdown', () => {
  const baseline = createBaseline({
    agreementId: 'AGR-SET-1',
    milestoneId: 'MS-1',
    persist: false,
    acceptanceCriteria: [
      { id: 'OBJ-1', type: 'DETERMINISTIC', metric: 'unit_test_pass_rate', operator: '==', expectedValue: 100, weight: 50 },
      { id: 'OBJ-2', type: 'DETERMINISTIC', metric: 'api_latency_ms', operator: '<=', expectedValue: 200, weight: 30 },
      { id: 'SUB-1', type: 'SUBJECTIVE', description: 'UI/UX đạt chuẩn', requiresHitl: true, weight: 20 }
    ]
  });

  const evaluationReport = evaluateSubmission(baseline, {
    changedFiles: ['src/api/payment.mjs'],
    metrics: { unit_test_pass_rate: 100, api_latency_ms: 450 }
  });

  // OBJ-1 pass (50%) + OBJ-2 fail (0%) + SUB-1 * 0.5 (10%) = 60% Freelancer / 40% Client
  const split = calculateFrozenFundSplit({
    frozenAmount: 10000000,
    baseline,
    evaluationReport,
    hitlDisputeResolutionRatio: 0.5
  });

  assert.equal(split.productScorePercent, 60);
  assert.equal(split.freelancerPercent, 60);
  assert.equal(split.clientPercent, 40);
  assert.equal(split.freelancerAmount, 6000000);
  assert.equal(split.clientAmount, 4000000);
  assert.equal(split.ruleApplied, 'WEIGHTED_SCORE_SPLIT');
  assert.equal(split.breakdown.length, 3);
  assert.equal(split.breakdown[0].status, 'PASSED');
  assert.equal(split.breakdown[1].status, 'FAILED');
  assert.equal(split.breakdown[2].status, 'PENDING_HITL');
  assert.match(split.testReportHash, /^[a-f0-9]{64}$/);
});

test('2. calculateFrozenFundSplit: rớt tiêu chí is_critical: true -> giới hạn trần thanh toán tối đa 30%', () => {
  const baseline = createBaseline({
    agreementId: 'AGR-SET-2',
    milestoneId: 'MS-1',
    persist: false,
    acceptanceCriteria: [
      { id: 'OBJ-SEC', type: 'DETERMINISTIC', metric: 'security_critical_issues', operator: '==', expectedValue: 0, weight: 20, is_critical: true },
      { id: 'OBJ-TEST', type: 'DETERMINISTIC', metric: 'unit_test_pass_rate', operator: '==', expectedValue: 100, weight: 80 }
    ]
  });

  const evaluationReport = evaluateSubmission(baseline, {
    changedFiles: ['src/api/payment.mjs'],
    metrics: { security_critical_issues: 2, unit_test_pass_rate: 100 }
  });

  // Điểm thô = 80%, nhưng rớt OBJ-SEC (is_critical: true) -> trần tối đa 30%
  const split = calculateFrozenFundSplit({
    frozenAmount: 5000000,
    baseline,
    evaluationReport
  });

  assert.equal(split.criticalFailure, true);
  assert.equal(split.productScorePercent, 80);
  assert.equal(split.freelancerPercent, 30);
  assert.equal(split.clientPercent, 70);
  assert.equal(split.freelancerAmount, 1500000);
  assert.equal(split.clientAmount, 3500000);
  assert.equal(split.ruleApplied, 'CRITICAL_CRITERION_CAP_30');
});

test('3. calculateFrozenFundSplit: vi phạm blockers / forbiddenPaths -> hoàn 100% cho Client', () => {
  const baseline = createBaseline({
    agreementId: 'AGR-SET-3',
    milestoneId: 'MS-1',
    persist: false,
    scopeConstraints: { forbiddenPaths: ['.env'] },
    acceptanceCriteria: [
      { id: 'OBJ-1', type: 'DETERMINISTIC', metric: 'unit_test_pass_rate', operator: '==', expectedValue: 100, weight: 100 }
    ]
  });

  const evaluationReport = evaluateSubmission(baseline, {
    changedFiles: ['.env'],
    metrics: { unit_test_pass_rate: 100 }
  });

  const split = calculateFrozenFundSplit({
    frozenAmount: 8000000,
    baseline,
    evaluationReport
  });

  assert.equal(split.hasBlockers, true);
  assert.equal(split.freelancerPercent, 0);
  assert.equal(split.clientPercent, 100);
  assert.equal(split.freelancerAmount, 0);
  assert.equal(split.clientAmount, 8000000);
  assert.equal(split.ruleApplied, 'BLOCKER_VIOLATION_REFUND_100');
});

