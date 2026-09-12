class RateLimiterStore {
  constructor() {
    this.hits = new Map();
  }

  recordHit(key, windowMs) {
    const now = Date.now();
    const entry = this.hits.get(key);

    if (!entry || now > entry.resetTime) {
      const resetTime = now + windowMs;
      this.hits.set(key, { count: 1, resetTime });
      return { count: 1, resetTime };
    }

    entry.count += 1;
    return { count: entry.count, resetTime: entry.resetTime };
  }

  reset() {
    this.hits.clear();
  }
}

export const rateLimiterStore = new RateLimiterStore();

export function createRateLimiter({ windowMs, max, message, keyGenerator }) {
  return (req, res, next) => {
    const key = keyGenerator ? keyGenerator(req) : `${req.ip}_${req.baseUrl}${req.path}`;
    const { count, resetTime } = rateLimiterStore.recordHit(key, windowMs);
    const retryAfterSeconds = Math.ceil((resetTime - Date.now()) / 1000);

    res.setHeader('X-RateLimit-Limit', max);
    res.setHeader('X-RateLimit-Remaining', Math.max(0, max - count));
    res.setHeader('X-RateLimit-Reset', Math.ceil(resetTime / 1000));

    if (count > max) {
      res.setHeader('Retry-After', retryAfterSeconds);
      return res.status(429).json({
        success: false,
        error: message || 'Too many requests. Please try again later.',
        retryAfter: retryAfterSeconds,
      });
    }

    next();
  };
}

// Rate limit checkout initiation
export const checkoutLimiter = createRateLimiter({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 5,                   // 5 checkout attempts per 15 min
  message: 'Too many checkout attempts initiated. Please wait before trying again.',
  keyGenerator: (req) => `checkout_${req.ip}_${req.user?.id || ''}`,
});
