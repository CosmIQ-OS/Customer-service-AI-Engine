import type { Request, Response, NextFunction } from 'express';

export interface RateLimitOptions {
  windowMs: number;
  max: number;
  message?: string;
}

export function createRateLimiter(options: RateLimitOptions) {
  const requests = new Map<string, { count: number; resetAt: number }>();

  // Periodically sweep expired entries so memory remains tiny
  const interval = setInterval(() => {
    const now = Date.now();
    for (const [ip, entry] of requests.entries()) {
      if (now > entry.resetAt) {
        requests.delete(ip);
      }
    }
  }, Math.max(options.windowMs, 10_000));
  interval.unref();

  return (req: Request, res: Response, next: NextFunction) => {
    const ip =
      (req.headers['x-forwarded-for'] as string)?.split(',')[0]?.trim() ||
      req.ip ||
      req.socket.remoteAddress ||
      'unknown-ip';

    const now = Date.now();
    const entry = requests.get(ip);

    if (!entry || now > entry.resetAt) {
      requests.set(ip, { count: 1, resetAt: now + options.windowMs });
      return next();
    }

    entry.count += 1;
    if (entry.count > options.max) {
      res.setHeader('Retry-After', Math.ceil((entry.resetAt - now) / 1000));
      return res.status(429).json({
        error: options.message || 'Too many requests from this IP. Please try again later.',
      });
    }

    next();
  };
}
