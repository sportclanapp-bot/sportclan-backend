/**
 * Audit #19 (11 Oct 2026): refresh tokens were stored in plain text and never
 * changed for 30 days. Sessions are now found by a SHA-256 hash of the token
 * (migration 145; 146 clears the plain copies after the deploy), and a refresh
 * can hand out a NEW refresh token (rotation) to an app that says it keeps it.
 */
import crypto from 'crypto';
import { supabase } from './supabase';

export const hashRefreshToken = (token: string): string => crypto.createHash('sha256').update(token, 'utf8').digest('hex');

/** How long an already-rotated token is still answered (a lost response, a retry). */
export const ROTATION_GRACE_MS = 60_000;

export type SessionRow = { id: string; user_id: string; revoked: boolean; token_hash?: string | null; prev_token_hash?: string | null; rotated_at?: string | null };

/**
 * The session a refresh token belongs to. `reused` = the token is the one a
 * rotation replaced (presented again after the grace window: a stolen copy, or
 * a phone that lost the new one — the session is ended either way).
 */
export async function findSessionByToken(token: string): Promise<{ row: SessionRow; reused: boolean; inGrace: boolean } | null> {
  const h = hashRefreshToken(token);
  const cols = 'id, user_id, revoked, token_hash, prev_token_hash, rotated_at';
  const { data: cur, error } = await supabase.from('refresh_tokens').select(cols).eq('token_hash', h).maybeSingle();
  if (!error && cur) return { row: cur as SessionRow, reused: false, inGrace: false };
  if (error) {
    // Before migration 145 (no token_hash column): the old plain-text lookup.
    const { data: old } = await supabase.from('refresh_tokens').select('id, user_id, revoked').eq('token', token).maybeSingle();
    return old ? { row: old as SessionRow, reused: false, inGrace: false } : null;
  }
  const { data: prev } = await supabase.from('refresh_tokens').select(cols).eq('prev_token_hash', h).maybeSingle();
  if (prev) {
    const at = (prev as SessionRow).rotated_at ? Date.parse(String((prev as SessionRow).rotated_at)) : 0;
    return { row: prev as SessionRow, reused: true, inGrace: Date.now() - at <= ROTATION_GRACE_MS };
  }
  // A row hashed by neither path yet (none after 145's backfill): the plain column.
  const { data: plain } = await supabase.from('refresh_tokens').select(cols).eq('token', token).maybeSingle();
  return plain ? { row: plain as SessionRow, reused: false, inGrace: false } : null;
}
