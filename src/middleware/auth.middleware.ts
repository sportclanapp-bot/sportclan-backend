import { Request, Response, NextFunction } from 'express';
import { verifyAccessToken } from '../utils/jwt';
import { supabase } from '../utils/supabase';
import { isTokenRevoked } from '../utils/sessionRevocation';
import { isSessionDenied } from '../utils/sessionDeny';

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
  // Decision 15: …and one device signed out on its own (Active sessions,
  // Log out) is refused from its next request, by the session id it carries.
  if (await isTokenRevoked(payload.userId, payload.iat) || await isSessionDenied(payload.sid)) {
    return res.status(401).json({ error: 'Session revoked. Please sign in again.', code: 'SESSION_REVOKED' });
  }
  req.userId = payload.userId;
  // Fire-and-forget last_active_at update — no await, no error check. Audit
  // #95: at most once every PRESENCE_WRITE_MS per person (it wrote the database
  // on every request; the online window is minutes, not seconds).
  if (shouldWritePresence(payload.userId)) {
    supabase.from('users').update({ last_active_at: new Date().toISOString() }).eq('id', payload.userId).then(() => {});
  }
  return next();
}

/** Audit #95: how often one person's request writes last_active_at. */
export const PRESENCE_WRITE_MS = 30_000;
const lastPresenceWrite = new Map<string, number>();
export function shouldWritePresence(userId: string, now = Date.now()): boolean {
  const last = lastPresenceWrite.get(userId) ?? 0;
  if (now - last < PRESENCE_WRITE_MS) return false;
  lastPresenceWrite.set(userId, now);
  if (lastPresenceWrite.size > 50_000) { // keep the map small: drop entries older than the window
    for (const [k, v] of lastPresenceWrite) if (now - v >= PRESENCE_WRITE_MS) lastPresenceWrite.delete(k);
  }
  return true;
}

/**
 * Like authenticateToken, but never rejects: if a valid Bearer token is
 * present, populate req.userId; otherwise continue anonymously. Use on public
 * endpoints that still want viewer-relative fields (e.g. isFollowing on a
 * profile) when a logged-in user views them.
 */
export async function optionalAuth(req: Request, _res: Response, next: NextFunction) {
  const header = req.headers.authorization || '';
  const token = header.startsWith('Bearer ') ? header.slice(7) : null;
  if (token) {
    try {
      const payload = verifyAccessToken(token);
      // Audit #28: a signed-out (revoked) session is anonymous here too, as it
      // is refused by authenticateToken. (No route uses this since audit #7,
      // but it must not hand a revoked token a viewer's view.)
      if (!(await isTokenRevoked(payload.userId, payload.iat)) && !(await isSessionDenied(payload.sid))) {
        req.userId = payload.userId;
      }
    } catch {
      // Invalid token → treat as anonymous, don't fail the request.
    }
  }
  return next();
}
