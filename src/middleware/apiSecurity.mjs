/**
 * Middleware bảo mật API & Rate Limiter cho VibeEscrow Server
 */

export function createRateLimiter(options = {}) {
  const buckets = new Map();
  const windowMs = Number(options.windowMs) > 0 ? Number(options.windowMs) : 60000;

  return function checkRateLimit(req, urlPath) {
    const isHeavy = /\/(verify-github|refine-criteria|suggest-criteria)$/.test(urlPath);
    const envHeavy = Number(process.env.RATE_LIMIT_MAX_HEAVY);
    const envDefault = Number(process.env.RATE_LIMIT_MAX_DEFAULT);
    const heavyLimit = Number(options.heavyLimit) > 0
      ? Number(options.heavyLimit)
      : Number.isFinite(envHeavy) && envHeavy > 0
      ? envHeavy
      : 30;
    const defaultLimit = Number(options.defaultLimit) > 0
      ? Number(options.defaultLimit)
      : Number.isFinite(envDefault) && envDefault > 0
      ? envDefault
      : 60;

    const limit = isHeavy ? heavyLimit : defaultLimit;
    const ip = req.socket?.remoteAddress || '127.0.0.1';
    const key = `${ip}:${isHeavy ? 'heavy' : 'api'}`;
    const now = Date.now();
    const entries = (buckets.get(key) || []).filter((ts) => now - ts < windowMs);

    if (entries.length >= limit) {
      const oldestTs = entries[0] || now;
      const retryAfterSeconds = Math.max(1, Math.ceil((oldestTs + windowMs - now) / 1000));
      return {
        allowed: false,
        limit,
        retryAfterSeconds,
        error: `Bạn thao tác quá nhanh, vui lòng thử lại sau ${retryAfterSeconds} giây.`
      };
    }

    entries.push(now);
    buckets.set(key, entries);
    return { allowed: true, limit };
  };
}
