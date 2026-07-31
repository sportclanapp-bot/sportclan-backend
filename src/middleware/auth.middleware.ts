import { Request, Response, NextFunction } from 'express';
import { verifyAccessToken } from '../utils/jwt';
import { supabase } from '../utils/supabase';
import { isTokenRevoked } from '../utils/sessionRevocation';

declare global {
  // eslint-disable-next-line @typescript-eslint/no-namespace
  namespace Express {
    interface Request {
      userId?: string;
    }
  }
}

export async function authenticateToken(req: Request, res: Response, next: NextFunction) {
  const header = req.headers.authorization || '';
  const token = header.startsWith('Bearer ') ? header.slice(7) : null;
  if (!token) return res.status(401).json({ error: 'Missing token' });
  let payload;
  try {
    payload = verifyAccessToken(token);
  } catch {
    return res.status(401).json({ error: 'Invalid or expired token' });
  }
  // SC-384: a valid signature is not enough. Deleting a device's refresh token
  // stops it renewing but says nothing about the access token already in its
  // hands, which stays valid for its full 15-minute life — so "sign out other
  // devices" left a signed-out device with full API access for that long.
  // Reject anything minted before the user last revoked.
  if (await isTokenRevoked(payload.userId, payload.iat)) {
    return res.status(401).json({ error: 'Session revoked. Please sign in again.', code: 'SESSION_REVOKED' });
  }
  req.userId = payload.userId;
  // Fire-and-forget last_active_at update — no await, no error check
  supabase.from('users').update({ last_active_at: new Date().toISOString() }).eq('id', payload.userId).then(() => {});
  return next();
}

/**
 * Like authenticateToken, but never rejects: if a valid Bearer token is
 * present, populate req.userId; otherwise continue anonymously. Use on public
 * endpoints that still want viewer-relative fields (e.g. isFollowing on a
 * profile) when a logged-in user views them.
 */
export function optionalAuth(req: Request, _res: Response, next: NextFunction) {
  const header = req.headers.authorization || '';
  const token = header.startsWith('Bearer ') ? header.slice(7) : null;
  if (token) {
    try {
      req.userId = verifyAccessToken(token).userId;
    } catch {
      // Invalid token → treat as anonymous, don't fail the request.
    }
  }
  return next();
}
