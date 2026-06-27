import { Request, Response, NextFunction } from 'express';
import { verifyAccessToken } from '../utils/jwt';
import { supabase } from '../utils/supabase';

declare global {
  // eslint-disable-next-line @typescript-eslint/no-namespace
  namespace Express {
    interface Request {
      userId?: string;
    }
  }
}

export function authenticateToken(req: Request, res: Response, next: NextFunction) {
  const header = req.headers.authorization || '';
  const token = header.startsWith('Bearer ') ? header.slice(7) : null;
  if (!token) return res.status(401).json({ error: 'Missing token' });
  try {
    const payload = verifyAccessToken(token);
    req.userId = payload.userId;
    // Fire-and-forget last_active_at update — no await, no error check
    supabase.from('users').update({ last_active_at: new Date().toISOString() }).eq('id', payload.userId).then(() => {});
    return next();
  } catch {
    return res.status(401).json({ error: 'Invalid or expired token' });
  }
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
