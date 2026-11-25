import type { Request, Response, NextFunction } from 'express';

export interface RateLimitOptions {
  windowMs: number;
  max: number;
  message?: string;
  maxEntries?: number;
}

export function createRateLimiter(options: RateLimitOptions) {
  const requests = new Map<string, { count: number; resetAt: number }>();
  const maxEntries = options.maxEntries ?? 10_000;

  const pruneExpired = (now: number) => {
    for (const [ip, entry] of requests.entries()) {
      if (now > entry.resetAt) {
        requests.delete(ip);
      }
    }
  };

  // Periodically sweep expired entries so memory remains tiny
  const interval = setInterval(() => {
    pruneExpired(Date.now());
  }, Math.max(options.windowMs, 10_000));
  interval.unref();

  return (req: Request, res: Response, next: NextFunction) => {
    // Rely on Express's req.ip (respects `trust proxy` configuration) instead of raw X-Forwarded-For
    const ip = req.ip || req.socket.remoteAddress || 'unknown-ip';

    const now = Date.now();
    const entry = requests.get(ip);

    if (!entry || now > entry.resetAt) {
      if (!entry && requests.size >= maxEntries) {
        pruneExpired(now);
        while (requests.size >= maxEntries) {
          const oldest = requests.keys().next().value;
          if (oldest === undefined) break;
          requests.delete(oldest);
        }
      }
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
