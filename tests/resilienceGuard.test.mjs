import test from 'node:test';
import assert from 'node:assert/strict';
import {
  executeWithFallback,
  buildSanitizedChildEnv,
  sanitizeSandboxLog
} from '../src/engine/resilienceGuard.mjs';
import { createPreviewServer } from '../src/server.mjs';

test('1. executeWithFallback: trả về LLM_ONLINE khi LLM thành công và hợp lệ', async () => {
  const res = await executeWithFallback(
    async () => ({
      llmEnhanced: true,
      criteria: [
        { id: 'OBJ-1', type: 'DETERMINISTIC', metric: 'unit_test_pass_rate', operator: '==', expectedValue: 100, weight: 100 }
      ]
    }),
    () => ({ llmEnhanced: false, criteria: [] }),
    2000
  );

  assert.equal(res.resilienceMode, 'LLM_ONLINE');
  assert.equal(res.fallbackReason, null);
  assert.equal(res.criteria.length, 1);
});

test('2. executeWithFallback: tự động chuyển sang RULE_FALLBACK_ACTIVE khi LLM timeout hoặc lỗi HTTP 429/500', async () => {
  const timeoutRes = await executeWithFallback(
    () => new Promise((resolve) => setTimeout(() => resolve({ llmEnhanced: true }), 500)),
    () => ({ llmEnhanced: false, source: 'rule-fallback-timeout' }),
    120
  );
  assert.equal(timeoutRes.resilienceMode, 'RULE_FALLBACK_ACTIVE');
  assert.equal(timeoutRes.source, 'rule-fallback-timeout');
  assert.match(timeoutRes.fallbackReason, /timeout/i);

  const errRes = await executeWithFallback(
    async () => {
      throw new Error('HTTP 429 Too Many Requests');
    },
    () => ({ llmEnhanced: false, source: 'rule-fallback-429' }),
    1000
  );
  assert.equal(errRes.resilienceMode, 'RULE_FALLBACK_ACTIVE');
  assert.equal(errRes.source, 'rule-fallback-429');
});

test('3. buildSanitizedChildEnv & sanitizeSandboxLog: lọc bỏ secrets và đường dẫn hệ thống', () => {
  const cleanEnv = buildSanitizedChildEnv({
    PATH: '/usr/bin',
    DEPLOYER_PRIVATE_KEY: '0xsecret',
    GITHUB_TOKEN: 'ghp_secret',
    GEMINI_API_KEY: 'AIza_secret',
    ARBITER_AUTH_TOKEN: 'naruto',
    NODE_ENV: 'test'
  });

  assert.equal(cleanEnv.DEPLOYER_PRIVATE_KEY, undefined);
  assert.equal(cleanEnv.GITHUB_TOKEN, undefined);
  assert.equal(cleanEnv.GEMINI_API_KEY, undefined);
  assert.equal(cleanEnv.ARBITER_AUTH_TOKEN, undefined);
  assert.equal(cleanEnv.CI, 'true');
  assert.equal(cleanEnv.NODE_ENV, 'test');

  const log = sanitizeSandboxLog('Error at C:\\Users\\Admin\\AppData\\Local\\Temp\\escrow-gh-sandbox-1\\src\\app.js', 'C:\\Users\\Admin\\AppData\\Local\\Temp\\escrow-gh-sandbox-1');
  assert.equal(log.includes('C:\\Users\\Admin'), false);
  assert.ok(log.includes('<sandbox>'));
});

test('4. Endpoint /api/agreements/refine-criteria và /api/agreements/suggest-criteria trả về resilienceMode', async () => {
  const server = createPreviewServer();
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const { port } = server.address();
  try {
    const refineRes = await fetch(`http://127.0.0.1:${port}/api/agreements/refine-criteria`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ contractTitle: 'Xây dựng API Thanh toán', rawCriteria: ['API chạy nhanh'] })
    }).then((r) => r.json());
    assert.equal(refineRes.ok, true);
    assert.ok(['LLM_ONLINE', 'RULE_FALLBACK_ACTIVE'].includes(refineRes.resilienceMode));

    const suggestRes = await fetch(`http://127.0.0.1:${port}/api/agreements/suggest-criteria`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ contractTitle: 'Xây dựng API Thanh toán' })
    }).then((r) => r.json());
    assert.equal(suggestRes.ok, true);
    assert.ok(['LLM_ONLINE', 'RULE_FALLBACK_ACTIVE'].includes(suggestRes.resilienceMode));
  } finally {
    server.close();
  }
});
