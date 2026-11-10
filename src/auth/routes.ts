import { Router } from 'express';
import { z } from 'zod';
import type { AdminAuth } from './admin-auth.js';
import { SESSION_COOKIE, readCookie, requireAdmin } from './http.js';

const loginSchema = z.object({
  username: z.string().min(1).max(64),
  password: z.string().min(1).max(256),
});

export interface AuthRouteOptions {
  sessionHours: number;
  cookieSecure: boolean;
}

export function createAuthRouter(auth: AdminAuth, options: AuthRouteOptions): Router {
  const router = Router();
  const cookieOptions = {
    httpOnly: true,
    sameSite: 'strict' as const,
    secure: options.cookieSecure,
    path: '/',
  };

  router.post('/login', async (req, res, next) => {
    const parsed = loginSchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: 'Username and password are required' });
      return;
    }
    try {
      const result = await auth.login(parsed.data.username, parsed.data.password, req.ip ?? 'unknown');
      if (!result.ok) {
        const locked = result.reason === 'locked';
        res.status(locked ? 429 : 401).json({
          error: locked ? 'Too many failed attempts. Try again later.' : 'Invalid username or password',
        });
        return;
      }
      res.cookie(SESSION_COOKIE, result.token, {
        ...cookieOptions,
        maxAge: options.sessionHours * 3_600_000,
      });
      res.json({ admin: result.admin, expiresAt: result.expiresAt });
    } catch (error) {
      next(error);
    }
  });

  router.post('/logout', (req, res) => {
    auth.logout(readCookie(req, SESSION_COOKIE));
    res.clearCookie(SESSION_COOKIE, cookieOptions);
    res.json({ ok: true });
  });

  router.get('/me', requireAdmin(auth), (_req, res) => {
    res.json({ admin: res.locals.admin });
  });

  return router;
}
