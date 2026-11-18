import { enforceAntiHallucination } from './schemaGuard.mjs';

const SENSITIVE_ENV_KEYS = new Set([
  'DEPLOYER_PRIVATE_KEY',
  'AGENT_RELAY_PRIVATE_KEY',
  'GITHUB_TOKEN',
  'GEMINI_API_KEY',
  'AVALANCHE_API_KEY',
  'ARBITER_AUTH_TOKEN'
]);

/**
 * Lọc bỏ các biến môi trường nhạy cảm khỏi `env` của tiến trình con chạy Sandbox.
 */
export function buildSanitizedChildEnv(baseEnv = process.env) {
  const cleanEnv = {};
  for (const [key, val] of Object.entries(baseEnv || {})) {
    const upper = key.toUpperCase();
    if (
      SENSITIVE_ENV_KEYS.has(upper) ||
      upper.includes('PRIVATE_KEY') ||
      upper.includes('SECRET') ||
      upper.includes('API_KEY') ||
      upper.includes('TOKEN')
    ) {
      continue;
    }
    cleanEnv[key] = val;
  }
  cleanEnv.CI = 'true';
  return cleanEnv;
}

/**
 * Loại bỏ đường dẫn hệ thống / thư mục tạm nhạy cảm khỏi log lỗi trả về cho người dùng.
 */
export function sanitizeSandboxLog(rawLog = '', tmpDir = '') {
  let text = String(rawLog || '');
  if (tmpDir) {
    const escapedTmp = tmpDir.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    text = text.replace(new RegExp(escapedTmp, 'gi'), '<sandbox>');
  }
  text = text.replace(/[A-Za-z]:\\[^\s'":]+/g, (m) => {
    const base = m.split('\\').pop();
    return `<sandbox>/${base || 'file'}`;
  });
  text = text.replace(/\/(?:tmp|var|Users|home)\/[^\s'":]+/g, (m) => {
    const base = m.split('/').pop();
    return `<sandbox>/${base || 'file'}`;
  });
  return text;
}

/**
 * Tự động dự phòng LLM API (LLM Fallback & Timeout Guard):
 * - Giới hạn thời gian gọi LLM bằng AbortController (mặc định 8000ms).
 * - Nếu LLM timeout, gặp HTTP 429/500 hoặc trả sai cấu trúc JSON -> tự động chuyển sang ruleBasedFallbackFn.
 * - Trả về trạng thái `LLM_ONLINE` hoặc `RULE_FALLBACK_ACTIVE`.
 */
export async function executeWithFallback(llmTaskFn, ruleBasedFallbackFn, timeoutMs = 8000) {
  const limitMs = Math.max(100, Number(timeoutMs) || 8000);
  const controller = new AbortController();
  let timerId = null;

  const timeoutPromise = new Promise((_, reject) => {
    timerId = setTimeout(() => {
      controller.abort();
      const err = new Error(`LLM API timeout sau ${limitMs}ms`);
      err.code = 'LLM_TIMEOUT';
      reject(err);
    }, limitMs);
  });

  try {
    const llmResult = await Promise.race([
      Promise.resolve().then(() => llmTaskFn({ signal: controller.signal })),
      timeoutPromise
    ]);

    if (!llmResult || typeof llmResult !== 'object') {
      throw new Error('LLM trả về dữ liệu rỗng hoặc không phải JSON object.');
    }
    if (llmResult.llmEnhanced === false) {
      throw new Error('LLM không phản hồi hoặc đang bận (503/429).');
    }

    if (Array.isArray(llmResult.criteria)) {
      llmResult.criteria = enforceAntiHallucination(llmResult.criteria);
    }

    return {
      ...llmResult,
      resilienceMode: 'LLM_ONLINE',
      fallbackReason: null
    };
  } catch (err) {
    const fallbackResult = await Promise.resolve().then(() => ruleBasedFallbackFn(err));
    return {
      ...(fallbackResult && typeof fallbackResult === 'object' ? fallbackResult : {}),
      resilienceMode: 'RULE_FALLBACK_ACTIVE',
      fallbackReason: err?.message || 'LLM unavailable'
    };
  } finally {
    if (timerId) clearTimeout(timerId);
  }
}
