import { Request, Response, NextFunction } from 'express';
import { supabase } from '../utils/supabase';

/**
 * Gates a route behind admin access.
 *
 * Resolution order:
 *   1. ENV whitelist (`ADMIN_USER_IDS=uuid1,uuid2`) — instant, no DB hit.
 *      Use this for the founding team; cheap + always works.
 *   2. DB column `users.is_admin` if it exists — falls back gracefully if
 *      the column hasn't been added yet (Supabase returns column-not-found
 *      and we treat that as "not admin").
 *
 * Must be used after `authenticateToken`.
 */
export async function requireAdmin(req: Request, res: Response, next: NextFunction) {
  const userId = req.userId;
  if (!userId) return res.status(401).json({ error: 'Unauthorized' });

  // 1. ENV whitelist
  const whitelist = (process.env.ADMIN_USER_IDS || '')
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);
  if (whitelist.includes(userId)) return next();

  // 2. DB lookup (graceful on missing column)
  try {
    const { data, error } = await supabase
      .from('users')
      .select('is_admin')
      .eq('id', userId)
      .maybeSingle();
    if (!error && data && (data as { is_admin?: boolean }).is_admin === true) {
      return next();
    }
  } catch {
    // ignore — fall through to 403
  }

  return res.status(403).json({ error: 'Admin access required' });
}
