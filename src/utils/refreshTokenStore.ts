/**
 * Audit #19 (11 Oct 2026): refresh tokens were stored in plain text and never
 * changed for 30 days. Sessions are now found by a SHA-256 hash of the token
 * (migration 145; 146 clears the plain copies after the deploy), and a refresh
 * can hand out a NEW refresh token (rotation) to an app that says it keeps it.
 */
import crypto from 'crypto';
import { supabase } from './supabase';

export const hashRefreshToken = (token: string): string => crypto.createHash('sha256').update(token, 'utf8').digest('hex');

/** A session lookup the database couldn't answer (not "no such session"): the refresh says "try again". */
export class SessionLookupError extends Error {}
/** Postgres "undefined column": the database is from before migration 145 (no token_hash). */
const NO_COLUMN = '42703';

export type SessionRow = { id: string; user_id: string; revoked: boolean; token_hash?: string | null; prev_token_hash?: string | null; rotated_at?: string | null };

/**
 * The session a refresh token belongs to. `reused` = the token is the one the
 * latest rotation replaced. Rotation always moves prev_token_hash to the token
 * just presented, so presenting it again means the new token was never used:
 * the reply that carried it was lost (2.16.0 release pass, 12 Oct 2026 — a
 * dropped reply plus a minute offline used to end the whole sign-in). Older
 * tokens match neither column and are refused. Throws SessionLookupError when
 * the database can't answer, so a hiccup is never mistaken for a dead session.
 */
export async function findSessionByToken(token: string): Promise<{ row: SessionRow; reused: boolean } | null> {
  const h = hashRefreshToken(token);
  const cols = 'id, user_id, revoked, token_hash, prev_token_hash, rotated_at';
  const { data: cur, error } = await supabase.from('refresh_tokens').select(cols).eq('token_hash', h).maybeSingle();
  if (!error && cur) return { row: cur as SessionRow, reused: false };
  if (error) {
    if ((error as { code?: string }).code !== NO_COLUMN) throw new SessionLookupError(error.message);
    // Before migration 145 (no token_hash column): the old plain-text lookup.
    const { data: old, error: oldErr } = await supabase.from('refresh_tokens').select('id, user_id, revoked').eq('token', token).maybeSingle();
    if (oldErr) throw new SessionLookupError(oldErr.message);
    return old ? { row: old as SessionRow, reused: false } : null;
  }
  const { data: prev, error: prevErr } = await supabase.from('refresh_tokens').select(cols).eq('prev_token_hash', h).maybeSingle();
  if (prevErr) throw new SessionLookupError(prevErr.message);
  if (prev) return { row: prev as SessionRow, reused: true };
  // A row hashed by neither path yet (none after 145's backfill): the plain column.
  const { data: plain, error: plainErr } = await supabase.from('refresh_tokens').select(cols).eq('token', token).maybeSingle();
  if (plainErr) throw new SessionLookupError(plainErr.message);
  return plain ? { row: plain as SessionRow, reused: false } : null;
}
