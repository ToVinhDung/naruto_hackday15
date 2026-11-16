import test from 'node:test';
import assert from 'node:assert/strict';
import { ALLOWED_METRICS, ALLOWED_OPERATORS, enforceAntiHallucination } from '../src/engine/schemaGuard.mjs';
import { createBaseline } from '../src/engine/baselineManager.mjs';

test('1. enforceAntiHallucination: tự động hạ cấp metric giả (fake_ai_score) về SUBJECTIVE (HITL) và gắn cảnh báo', () => {
  assert.deepEqual(ALLOWED_METRICS, [
    'unit_test_pass_rate',
    'build_exit_code',
    'api_latency_ms',
    'code_coverage',
    'security_critical_issues',
    'delivered_docs_valid'
  ]);
  assert.deepEqual(ALLOWED_OPERATORS, [
    '==',
    '>=',
    '<=',
    '>',
    '<',
    'CONTAINS',
    'NOT_STARTS_WITH'
  ]);

  const rawCriteria = [
    {
      id: 'OBJ-01',
      type: 'DETERMINISTIC',
      metric: 'unit_test_pass_rate',
      operator: '==',
      expectedValue: 100,
      weight: 30
    },
    {
      id: 'OBJ-FAKE',
      type: 'DETERMINISTIC',
      metric: 'fake_ai_score',
      operator: '>=',
      expectedValue: 99,
      weight: 30,
      description: 'Điểm AI tự bịa ra phải >= 99'
    }
  ];

  const guarded = enforceAntiHallucination(rawCriteria);
  assert.equal(guarded.length, 2);

  // Tổng trọng số luôn bằng đúng 100
  const totalWeight = guarded.reduce((sum, c) => sum + c.weight, 0);
  assert.equal(totalWeight, 100);

  // Tiêu chí hợp lệ giữ nguyên DETERMINISTIC
  assert.equal(guarded[0].type, 'DETERMINISTIC');
  assert.equal(guarded[0].metric, 'unit_test_pass_rate');
  assert.equal(guarded[0].requiresHitl, false);

  // Tiêu chí dùng fake_ai_score bị hạ cấp về SUBJECTIVE + requiresHitl: true + có cảnh báo
  const downgraded = guarded[1];
  assert.equal(downgraded.id, 'OBJ-FAKE');
  assert.equal(downgraded.type, 'SUBJECTIVE');
  assert.equal(downgraded.requiresHitl, true);
  assert.equal(downgraded.metric, null);
  assert.equal(downgraded.downgradedByGuard, true);
  assert.match(downgraded.warning, /fake_ai_score/);
});

test('2. enforceAntiHallucination: lọc bỏ tham chiếu file ảo giác không tồn tại trong knownFiles từ GitHub', () => {
  const knownFiles = ['src/server.mjs', 'src/app.js', 'tests/system.test.mjs'];
  const rawCriteria = [
    {
      id: 'OBJ-01',
      type: 'DETERMINISTIC',
      metric: 'security_critical_issues',
      operator: '==',
      expectedValue: 0,
      weight: 45,
      referencedFiles: ['src/server.mjs', 'src/hallucinated/ghostPayment.mjs'],
      description: 'Kiểm tra bảo mật tại src/server.mjs và src/fake/secretModule.mjs'
    }
  ];

  const guarded = enforceAntiHallucination(rawCriteria, knownFiles);
  assert.equal(guarded[0].weight, 100);
  assert.deepEqual(guarded[0].referencedFiles, ['src/server.mjs']);
  assert.ok(guarded[0].removedFileRefs.includes('src/hallucinated/ghostPayment.mjs'));
  assert.ok(guarded[0].removedFileRefs.includes('src/fake/secretModule.mjs'));
  assert.ok(!guarded[0].description.includes('src/fake/secretModule.mjs'));
});

test('3. Tích hợp với createBaseline: metric giả hoặc operator sai bị hạ cấp trước khi đóng băng & băm SHA-256', () => {
  const baseline = createBaseline({
    agreementId: 'AGR-GUARD-01',
    milestoneId: 'MS-1',
    persist: false,
    acceptanceCriteria: [
      {
        id: 'OBJ-VALID',
        type: 'DETERMINISTIC',
        metric: 'api_latency_ms',
        operator: '<=',
        expectedValue: 250,
        weight: 10
      },
      {
        id: 'OBJ-HALLUCINATED',
        type: 'DETERMINISTIC',
        metric: 'fake_ai_score',
        operator: '>=',
        expectedValue: 95,
        weight: 10,
        description: 'Tiêu chí ảo giác từ LLM'
      }
    ]
  });

  assert.equal(baseline.frozen, true);
  assert.match(baseline.baselineHash, /^[a-f0-9]{64}$/);
  assert.equal(
    baseline.acceptanceCriteria.reduce((s, c) => s + c.weight, 0),
    100
  );

  const downgradedInBaseline = baseline.acceptanceCriteria.find((c) => c.id === 'OBJ-HALLUCINATED');
  assert.equal(downgradedInBaseline.type, 'SUBJECTIVE');
  assert.equal(downgradedInBaseline.requiresHitl, true);
  assert.equal(downgradedInBaseline.downgradedByGuard, true);
});

