import { createHash, timingSafeEqual } from 'node:crypto';
import type { NextFunction, Request, RequestHandler, Response } from 'express';
import type { AdminAuth } from './admin-auth.js';

export const SESSION_COOKIE = 'cosmiq_admin';
export const WEBHOOK_SECRET_HEADER = 'x-webhook-secret';

export function readCookie(req: Request, name: string): string | undefined {
  const header = req.headers.cookie;
  if (!header) return undefined;
  for (const part of header.split(';')) {
    const index = part.indexOf('=');
    if (index > 0 && part.slice(0, index).trim() === name) return part.slice(index + 1).trim();
  }
  return undefined;
}

export function requireAdmin(auth: AdminAuth): RequestHandler {
  return (req: Request, res: Response, next: NextFunction) => {
    auth
      .resolve(readCookie(req, SESSION_COOKIE))
      .then((admin) => {
        if (!admin) {
          res.status(401).json({ error: 'Admin login required' });
          return;
        }
        res.locals.admin = admin;
        next();
      })
      .catch(next);
  };
}

export function requireWebhookSecret(secret: string | undefined): RequestHandler {
  return (req: Request, res: Response, next: NextFunction) => {
    if (!secret) {
      res.status(503).json({ error: 'Channel webhooks are disabled until CHANNEL_WEBHOOK_SECRET is set' });
      return;
    }
    const provided = req.get(WEBHOOK_SECRET_HEADER) ?? '';
    if (!sameSecret(provided, secret)) {
      res.status(401).json({ error: 'Invalid webhook secret' });
      return;
    }
    next();
  };
}

function sameSecret(a: string, b: string): boolean {
  const hashA = createHash('sha256').update(a).digest();
  const hashB = createHash('sha256').update(b).digest();
  return timingSafeEqual(hashA, hashB) && a === b;
}
