/**
 * B15 (V072, D17) · which device a session is, so Active sessions can say
 * "Pixel 7 · Android 14 · SportClan 2.0.0 (3)" instead of "Mobile device".
 *
 * The app sends three headers with every request (api/client.ts); they are
 * stored on the refresh token at sign-in. Free text from the client, so each is
 * trimmed and capped — it is only ever shown back to the same user.
 */
import type { Request } from 'express';
import { supabase } from './supabase';

const clean = (v: unknown): string | null => {
  if (typeof v !== 'string') return null;
  const t = v.replace(/[\u0000-\u001f]/g, '').trim();
  return t ? t.slice(0, 80) : null;
};

export function deviceFields(req: Pick<Request, 'headers'>): { device_name: string | null; device_os: string | null; app_version: string | null } {
  return {
    device_name: clean(req.headers['x-device-name']),
    device_os: clean(req.headers['x-device-os']),
    app_version: clean(req.headers['x-app-version']),
  };
}

/**
 * Store a new refresh token with its device. If migration 100 has not been
 * applied yet (the columns are missing), store it the old way — a sign-in
 * must never fail over a label.
 *
 * Returns the row's id — the session id (`sid`) the access tokens for this
 * sign-in carry (decision 15) — or null if it couldn't be read back, in which
 * case the tokens simply go without one.
 */
export async function insertRefreshToken(userId: string, token: string, req: Pick<Request, 'headers'>): Promise<string | null> {
  const now = new Date().toISOString();
  const first = await supabase.from('refresh_tokens').insert({ user_id: userId, token, ...deviceFields(req), last_used_at: now }).select('id').maybeSingle();
  if (!first.error) return (first.data as { id?: string } | null)?.id ?? null;
  const fallback = await supabase.from('refresh_tokens').insert({ user_id: userId, token }).select('id').maybeSingle();
  return (fallback.data as { id?: string } | null)?.id ?? null;
}

/** "Pixel 7 · Android 14 · SportClan 2.0.0 (3)", or "Unknown device" for an old session. */
export function sessionLabel(row: { device_name?: string | null; device_os?: string | null; app_version?: string | null }): string {
  const parts = [row.device_name, row.device_os, row.app_version ? `SportClan ${row.app_version}` : null].filter(Boolean);
  return parts.length ? parts.join(' · ') : 'Unknown device';
}
