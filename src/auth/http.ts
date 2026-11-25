import { createHash, createHmac, timingSafeEqual } from 'node:crypto';
import type { NextFunction, Request, RequestHandler, Response } from 'express';
import type { AdminAuth } from './admin-auth.js';

export const SESSION_COOKIE = 'cosmiq_admin';
export const WEBHOOK_SECRET_HEADER = 'x-webhook-secret';
export const WHATSAPP_SIGNATURE_HEADER = 'x-hub-signature-256';

export interface RequestWithRawBody extends Request {
  rawBody?: Buffer;
}

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

export function verifyWhatsAppSignature(
  rawBody: Buffer | undefined,
  signatureHeader: string | undefined,
  appSecret: string,
): boolean {
  if (!rawBody || !signatureHeader || !signatureHeader.startsWith('sha256=')) {
    return false;
  }
  const providedHex = signatureHeader.slice('sha256='.length).trim();
  if (!/^[a-f0-9]{64}$/i.test(providedHex)) {
    return false;
  }
  const expected = createHmac('sha256', appSecret).update(rawBody).digest();
  const provided = Buffer.from(providedHex, 'hex');
  return expected.length === provided.length && timingSafeEqual(expected, provided);
}

export function requireWhatsAppSignature(appSecret: string | undefined): RequestHandler {
  return (req: Request, res: Response, next: NextFunction) => {
    if (!appSecret) {
      console.warn('[whatsapp-webhook] Rejected POST (503): WHATSAPP_APP_SECRET is not configured.');
      res.status(503).json({ error: 'WhatsApp webhook is disabled until WHATSAPP_APP_SECRET is set' });
      return;
    }
    const rawBody = (req as RequestWithRawBody).rawBody;
    const signature = req.get(WHATSAPP_SIGNATURE_HEADER);
    if (!verifyWhatsAppSignature(rawBody, signature, appSecret)) {
      const reason = !rawBody
        ? 'missing_raw_body'
        : !signature
          ? 'missing_signature_header'
          : !signature.startsWith('sha256=')
            ? 'invalid_header_format'
            : 'hmac_mismatch';
      console.warn(
        `[whatsapp-webhook] Rejected POST (401): ${reason} (rawBodyBytes=${rawBody?.length ?? 0}, secretLen=${appSecret.length})`,
      );
      res.status(401).json({ error: 'Invalid WhatsApp webhook signature' });
      return;
    }
    next();
  };
}

export function sameSecret(a: string, b: string): boolean {
  const hashA = createHash('sha256').update(a).digest();
  const hashB = createHash('sha256').update(b).digest();
  return timingSafeEqual(hashA, hashB) && a === b;
}
