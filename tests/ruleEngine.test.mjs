import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createBaseline, loadBaseline } from '../src/engine/baselineManager.mjs';
import { evaluateSubmission, calculateDisputeSplit } from '../src/engine/ruleEngine.mjs';
import { refineVagueCriteria, SEED_HISTORICAL_BASELINES } from '../src/engine/criteriaRefiner.mjs';
import { parseGitHubUrl, runSandboxTests } from '../src/tools/githubVerifier.mjs';

const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'escrow-baselines-'));

test.after(() => {
  fs.rmSync(tmpDir, { recursive: true, force: true });
});

function buildSampleBaseline(agreementId, milestoneId) {
  return createBaseline({
    agreementId,
    milestoneId,
    baseDir: tmpDir,
    scopeConstraints: {
      allowedPaths: ['src/api/**', 'tests/**'],
      forbiddenPaths: ['.env', 'src/contracts/EscrowVault.sol', 'config/secrets']
    },
    acceptanceCriteria: [
      {
        id: 'OBJ-01',
        type: 'DETERMINISTIC',
        metric: 'unit_test_pass_rate',
        operator: '==',
        expectedValue: 100,
        weight: 40
      },
      {
        id: 'OBJ-02',
        type: 'DETERMINISTIC',
        metric: 'code_coverage',
        operator: '>=',
        expectedValue: 80,
        weight: 40
      },
      {
        id: 'SUB-01',
        type: 'SUBJECTIVE',
        description: 'Giao diện thanh toán gọn, dễ nhìn trên nền trắng',
        requiresHitl: true,
        weight: 20
      }
    ]
  });
}

test('1. Vi phạm forbiddenPaths -> dừng ngay và trả về BLOCK_AND_FLAG kèm danh sách file vi phạm', () => {
  const baseline = buildSampleBaseline('AGR-001', 'MS-1');
  assert.equal(baseline.frozen, true);
  assert.match(baseline.baselineHash, /^[a-f0-9]{64}$/);

  const persisted = loadBaseline('AGR-001', 'MS-1', { baseDir: tmpDir });
  assert.equal(persisted.baselineHash, baseline.baselineHash);

  assert.throws(
    () => buildSampleBaseline('AGR-001', 'MS-1'),
    /already frozen/i
  );

  const report = evaluateSubmission(baseline, {
    changedFiles: ['src/api/payment.mjs', 'src/contracts/EscrowVault.sol', '.env'],
    metrics: { unit_test_pass_rate: 100, code_coverage: 95 }
  });

  assert.equal(report.blocked, true);
  assert.equal(report.recommendation, 'BLOCK_AND_FLAG');
  assert.equal(report.forbiddenViolations.length, 2);
  assert.deepEqual(
    report.forbiddenViolations.map((v) => v.file),
    ['src/contracts/EscrowVault.sol', '.env']
  );
  assert.match(report.testReportHash, /^[a-f0-9]{64}$/);
});

test('2. Fail unit test -> trả về REQUEST_REVISION và testReportHash hợp lệ', () => {
  const baseline = buildSampleBaseline('AGR-002', 'MS-1');

  const report = evaluateSubmission(baseline, {
    changedFiles: ['src/api/payment.mjs', 'tests/payment.test.mjs'],
    metrics: { unit_test_pass_rate: 70, code_coverage: 88 }
  });

  assert.equal(report.blocked, false);
  assert.equal(report.deterministicScore, 50);
  assert.equal(report.recommendation, 'REQUEST_REVISION');
  assert.equal(report.deterministicResults.find((r) => r.id === 'OBJ-01')?.passed, false);
  assert.equal(report.deterministicResults.find((r) => r.id === 'OBJ-02')?.passed, true);
  assert.match(report.testReportHash, /^[a-f0-9]{64}$/);
});

test('3. Pass 100% kỹ thuật & còn tiêu chí subjective -> READY_FOR_CLIENT_REVIEW và gom pendingHitlCriteria', () => {
  const baseline = buildSampleBaseline('AGR-003', 'MS-1');

  const report = evaluateSubmission(baseline, {
    changedFiles: ['src/api/payment.mjs', 'tests/payment.test.mjs'],
    metrics: { unit_test_pass_rate: 100, code_coverage: 92 }
  });

  assert.equal(report.blocked, false);
  assert.equal(report.deterministicScore, 100);
  assert.equal(report.recommendation, 'READY_FOR_CLIENT_REVIEW');
  assert.equal(report.pendingHitlCriteria.length, 1);
  assert.equal(report.pendingHitlCriteria[0].id, 'SUB-01');
  assert.equal(report.pendingHitlCriteria[0].requiresHitl, true);
  assert.match(report.testReportHash, /^[a-f0-9]{64}$/);
});

test('4. Decision Matrix (5 kịch bản phân chia quỹ tranh chấp theo Weighted Criteria Formula)', () => {
  // Kịch bản 1: Vi phạm nghiêm trọng (sửa file cấm hoặc 0% test pass) -> 0% / 100%
  const base1 = buildSampleBaseline('AGR-DM-1', 'MS-1');
  const split1 = calculateDisputeSplit(base1, {
    changedFiles: ['.env'],
    metrics: { unit_test_pass_rate: 100, code_coverage: 95 }
  });
  assert.equal(split1.scenarioCode, 'SCENARIO_1_SEVERE_VIOLATION');
  assert.equal(split1.freelancerPercent, 0);
  assert.equal(split1.clientPercent, 100);

  // Kịch bản 2: Hoàn thành một phần kỹ thuật (Pass 60%, Fail 40%, 0% subjective) -> 60% / 40%
  const base2 = createBaseline({
    agreementId: 'AGR-DM-2',
    milestoneId: 'MS-1',
    baseDir: tmpDir,
    acceptanceCriteria: [
      { id: 'OBJ-1', type: 'DETERMINISTIC', metric: 'unit_test_pass_rate', operator: '==', expectedValue: 100, weight: 60 },
      { id: 'OBJ-2', type: 'DETERMINISTIC', metric: 'api_latency_ms', operator: '<=', expectedValue: 200, weight: 40 }
    ]
  });
  const split2 = calculateDisputeSplit(base2, {
    changedFiles: ['src/api/payment.mjs'],
    metrics: { unit_test_pass_rate: 100, api_latency_ms: 500 }
  });
  assert.equal(split2.scenarioCode, 'SCENARIO_2_PARTIAL_TECHNICAL');
  assert.equal(split2.freelancerPercent, 60);
  assert.equal(split2.clientPercent, 40);

  // Kịch bản 3: Đạt 100% kỹ thuật (80% trọng số) nhưng cãi nhau về thẩm mỹ (20% trọng số, alpha = 0.5) -> 90% / 10%
  const base3 = createBaseline({
    agreementId: 'AGR-DM-3',
    milestoneId: 'MS-1',
    baseDir: tmpDir,
    acceptanceCriteria: [
      { id: 'OBJ-1', type: 'DETERMINISTIC', metric: 'unit_test_pass_rate', operator: '==', expectedValue: 100, weight: 80 },
      { id: 'SUB-1', type: 'SUBJECTIVE', description: 'UI/UX thẩm mỹ', requiresHitl: true, weight: 20 }
    ]
  });
  const split3 = calculateDisputeSplit(
    base3,
    { changedFiles: ['src/ui.mjs'], metrics: { unit_test_pass_rate: 100 } },
    { alpha: 0.5 }
  );
  assert.equal(split3.scenarioCode, 'SCENARIO_3_SUBJECTIVE_DISPUTE');
  assert.equal(split3.freelancerPercent, 90);
  assert.equal(split3.clientPercent, 10);

  // Kịch bản 4: Client "ngâm" duyệt quá hạn (Ghosting) -> 100% / 0%
  const split4 = calculateDisputeSplit(
    base3,
    { changedFiles: ['src/ui.mjs'], metrics: { unit_test_pass_rate: 100 } },
    { clientGhosted: true }
  );
  assert.equal(split4.scenarioCode, 'SCENARIO_4_CLIENT_GHOSTING');
  assert.equal(split4.freelancerPercent, 100);
  assert.equal(split4.clientPercent, 0);

  // Kịch bản 5: Trễ hạn có điều khoản phạt (Đạt 100% tiêu chí, phạt 2%/ngày x 5 ngày = 10%) -> 90% / 10%
  const split5 = calculateDisputeSplit(
    base2,
    { changedFiles: ['src/api/payment.mjs'], metrics: { unit_test_pass_rate: 100, api_latency_ms: 150 } },
    { lateDays: 5, dailyPenaltyPercent: 2 }
  );
  assert.equal(split5.scenarioCode, 'SCENARIO_5_LATE_PENALTY');
  assert.equal(split5.freelancerPercent, 90);
  assert.equal(split5.clientPercent, 10);
});

test('5. Agent chuẩn hóa tiêu chí mơ hồ (refineVagueCriteria) kế thừa Historical Baselines & tổng weight = 100', async () => {
  const refined = await refineVagueCriteria(
    'Xây dựng API Thanh toán & Tích hợp Webhook',
    ['API chạy nhanh', 'Code không lỗi', 'Bảo mật cao', 'Giao diện đẹp'],
    SEED_HISTORICAL_BASELINES,
    { useLlm: false }
  );

  assert.equal(refined.totalWeight, 100);
  assert.equal(refined.criteria.length, 4);

  const [speedCrit, bugCrit, secCrit, uiCrit] = refined.criteria;
  assert.equal(speedCrit.type, 'DETERMINISTIC');
  assert.equal(speedCrit.metric, 'api_latency_ms');
  assert.equal(speedCrit.operator, '<=');
  assert.equal(speedCrit.expectedValue, 200); // kế thừa từ HIST-API-01

  assert.equal(bugCrit.type, 'DETERMINISTIC');
  assert.equal(bugCrit.metric, 'unit_test_pass_rate');
  assert.equal(bugCrit.operator, '==');
  assert.equal(bugCrit.expectedValue, 100);

  assert.equal(secCrit.type, 'DETERMINISTIC');
  assert.equal(secCrit.metric, 'security_critical_issues');
  assert.equal(secCrit.operator, '==');
  assert.equal(secCrit.expectedValue, 0);

  assert.equal(uiCrit.type, 'SUBJECTIVE');
  assert.equal(uiCrit.requiresHitl, true);
});

test('6. GitHub Verifier (parseGitHubUrl & runSandboxTests + evaluateSubmission)', async () => {
  const parsed = parseGitHubUrl('https://github.com/vercel/next.js/commit/abc1234');
  assert.equal(parsed.valid, true);
  assert.equal(parsed.owner, 'vercel');
  assert.equal(parsed.repo, 'next.js');
  assert.equal(parsed.commitSha, 'abc1234');

  const invalid = parseGitHubUrl('https://example.com/not-github');
  assert.equal(invalid.valid, false);

  // Kiểm thử runSandboxTests với URL không tồn tại trả về metrics fail an toàn & dọn dẹp thư mục tạm
  const failedSandbox = await runSandboxTests({
    repoUrl: path.join(tmpDir, 'non-existent-repo'),
    commitSha: 'HEAD',
    testCommand: 'node --test',
    timeoutMs: 3000
  });
  assert.equal(failedSandbox.cloned, false);
  assert.equal(failedSandbox.metrics.build_exit_code, 1);
  assert.equal(failedSandbox.metrics.unit_test_pass_rate, 0);
});

