import { Request, Response } from 'express';
import { supabase } from '../utils/supabase';
import { revokeSessionsNow } from '../utils/sessionRevocation';
import { generateAccessToken } from '../utils/jwt';

// POST /account/delete — FINAL delete: immediate PII scrub + login lockout,
// hard-purged after a 30-day retention window.
//
// Privacy posture: deletion is permanent — there is NO self-service restore.
// We scrub identifiable fields immediately (Play Data Safety / DPDP "delete on
// request") and set deleted_at, which (a) blocks all further login for the
// account (see isDeleted in auth.controller) and (b) marks the row for
// hard-delete by /account/purge-expired (cron-callable) after 30 days. The
// 30-day window is a retention/audit buffer, NOT a user-facing grace period —
// the scrub is destructive (originals are overwritten, not archived).
//
// Scrubbed-now (so they vanish from any UI surface immediately):
//   name → "Deleted User"
//   username → "deleted_<short-uuid>" (preserves DB uniqueness constraint)
//   email → null
//   profile_picture_url → null
//   bio → null
//   gender, dob → null
//
// phone: kept on the dead row so login stays locked out during the grace; it is
// released (renamed to a sentinel) only if the same number re-registers, which
// creates a brand-new account (never a restore of the old one).
//
// Kept until permanent purge: user-id references on content (so threads don't
// lose their structure during the retention window).
// SC-79: a captain deleting their account must not strand their teams with a
// (soon-hidden) deleted captain. At delete time, for every team the user
// captains: promote the vice-captain if one exists, else the oldest remaining
// member (min joined_at, tie-break user_id), and demote the departing captain
// to 'player' (single-captain invariant; the row is then hidden by the roster
// read-filter). If the captain was the SOLE member, remove their membership and
// leave the team inert (0 members) — the empty team is cascade-purged at 30d.
// Runs best-effort (non-fatal): account deletion must succeed regardless.
async function resolveCaptainciesOnDelete(userId: string): Promise<void> {
  const { data: captainRows } = await supabase
    .from('team_members')
    .select('team_id')
    .eq('user_id', userId)
    .eq('role', 'captain');

  for (const { team_id } of captainRows || []) {
    const { data: others } = await supabase
      .from('team_members')
      .select('user_id, role, joined_at')
      .eq('team_id', team_id)
      .neq('user_id', userId)
      .order('joined_at', { ascending: true })
      .order('user_id', { ascending: true });

    const list = others || [];
    if (list.length === 0) {
      // Sole member — remove the membership; the team goes inert.
      await supabase.from('team_members').delete().eq('team_id', team_id).eq('user_id', userId);
      continue;
    }
    // Vice-captain succeeds first; otherwise the oldest remaining member.
    const successor = list.find((m) => m.role === 'vice_captain') ?? list[0];
    await supabase.from('team_members').update({ role: 'captain' })
      .eq('team_id', team_id).eq('user_id', successor.user_id);
    await supabase.from('team_members').update({ role: 'player' })
      .eq('team_id', team_id).eq('user_id', userId);
  }
}

export async function deleteAccount(req: Request, res: Response) {
  const userId = req.userId!;
  const { confirmation } = req.body || {};

  if (confirmation !== 'DELETE') {
    return res.status(400).json({ error: 'Type "DELETE" to confirm' });
  }

  // Scrub identifiable fields immediately.
  const shortId = userId.slice(0, 8);
  const { error } = await supabase.from('users').update({
    deleted_at: new Date().toISOString(),
    is_premium: false,
    name: 'Deleted User',
    username: `deleted_${shortId}`,
    email: null,
    profile_picture_url: null,
    bio: null,
    gender: null,
    dob: null,
  }).eq('id', userId);

  if (error) return res.status(500).json({ error: 'Could not deactivate account' });

  // Revoke all sessions so the user can't keep using the app on other devices
  // during the 30-day grace.
  await supabase.from('refresh_tokens').delete().eq('user_id', userId);
  // SC-384: and stop the access tokens they already hold. Deleting the refresh
  // rows alone left a just-deleted account able to keep calling the API for the
  // remaining 15 minutes of its current token.
  await revokeSessionsNow(userId);
  // Also remove push tokens — no more notifications. Best-effort: don't fail
  // account deactivation if this cleanup errors. (Supabase builders are
  // PromiseLike with no `.catch()`, so await inside try/catch.)
  try {
    await supabase.from('push_tokens').delete().eq('user_id', userId);
  } catch {
    // ignore push-token cleanup failures
  }

  // SC-79: transfer captaincy of any teams this user captained. Best-effort —
  // deletion has already succeeded; a transfer hiccup must not fail the request
  // (the roster read-filter hides the deleted captain regardless).
  // Primary path is the ATOMIC RPC finalize_captaincy_on_delete (migration 046):
  // the whole transfer runs in one transaction, so a process death mid-run can
  // never leave a team headless/two-captained. The JS loop is a transitional
  // fallback for the window before 046 is applied (same rule, non-atomic) and
  // can be removed once 046 is live.
  try {
    const { error: rpcErr } = await supabase.rpc('finalize_captaincy_on_delete', { p_user_id: userId });
    if (rpcErr) throw rpcErr;
  } catch {
    try {
      await resolveCaptainciesOnDelete(userId);
    } catch {
      // ignore captaincy-transfer failures
    }
  }

  return res.json({
    success: true,
    message: 'Your account has been permanently deleted and your personal data scrubbed. This cannot be undone. Any remaining records are purged after 30 days.',
  });
}

// POST /account/purge-expired — cron-callable endpoint (must include
// X-Cron-Secret header matching CRON_SECRET env). Hard-deletes accounts
// whose deleted_at is older than 30 days.
//
// Production: hook this up to a Render cron job or Supabase pg_cron to run
// daily.
// Core purge logic, callable BOTH from the cron endpoint and the in-process
// hourly sweep (SC-217 — the endpoint alone never ran because CRON_SECRET is
// unset). Only ever hard-deletes rows whose deleted_at is a real timestamp older
// than 30 days (the `.not deleted_at is null` guard makes it impossible to touch
// a live account). Idempotent — a second run finds nothing.
export async function purgeExpiredAccountsCore(): Promise<{ purged: number; ids: string[] }> {
  const cutoff = new Date(Date.now() - 30 * 86400000).toISOString();

  const { data: expired, error: fetchErr } = await supabase
    .from('users')
    .select('id')
    .lt('deleted_at', cutoff)
    .not('deleted_at', 'is', null);
  if (fetchErr) throw new Error(fetchErr.message);
  if (!expired || expired.length === 0) return { purged: 0, ids: [] };

  const ids = expired.map((u: { id: string }) => u.id);
  // Hard-delete the user rows. FK cascades on user_id should clear content
  // automatically; anything that's set to SET NULL will detach.
  const { error: delErr } = await supabase.from('users').delete().in('id', ids);
  if (delErr) throw new Error(delErr.message);
  return { purged: ids.length, ids };
}

export async function purgeExpiredAccounts(req: Request, res: Response) {
  const secret = req.headers['x-cron-secret'];
  if (!process.env.CRON_SECRET || secret !== process.env.CRON_SECRET) {
    return res.status(403).json({ error: 'Forbidden' });
  }
  try {
    return res.json(await purgeExpiredAccountsCore());
  } catch (err: any) {
    return res.status(500).json({ error: err?.message || 'Purge failed' });
  }
}

// GET /account/sessions — returns the caller's active sessions, deduped
// per device.
//
// refresh_tokens accumulates a new row every time the app rotates its
// token (which happens on every login and on every silent refresh), so a
// single device can easily have dozens of rows. We read all rows for the
// user ordered newest-first, then keep only the MOST RECENT row for each
// unique device. The device key is `device_info`/`device_name`/`user_agent`
// if any of them exist, else the last 8 chars of the token as a stable
// fallback. Capped at 10 sessions.
export async function getSessions(req: Request, res: Response) {
  const userId = req.userId!;
  const currentRefreshToken =
    (req.headers['x-refresh-token'] as string | undefined) ?? null;

  // Try the rich schema first. If some of the optional columns don't
  // exist, fall back to the minimal id/token/created_at set.
  let rows: any[] = [];
  {
    const rich = await supabase
      .from('refresh_tokens')
      .select('id, token, created_at, user_agent, device_name, device_info, last_used_at')
      .eq('user_id', userId)
      .order('created_at', { ascending: false });
    if (!rich.error) {
      rows = rich.data ?? [];
    } else {
      const fallback = await supabase
        .from('refresh_tokens')
        .select('id, token, created_at')
        .eq('user_id', userId)
        .order('created_at', { ascending: false });
      if (fallback.error) return res.status(500).json({ error: fallback.error.message });
      rows = fallback.data ?? [];
    }
  }

  // Dedup newest-first per device key. We iterate in order (already desc
  // by created_at) and keep the first occurrence for each device.
  const seen = new Set<string>();
  const deduped: any[] = [];
  for (const row of rows) {
    const deviceKey: string =
      (row.device_info && String(row.device_info)) ||
      (row.device_name && String(row.device_name)) ||
      (row.user_agent && String(row.user_agent)) ||
      // Fallback: use the last 8 chars of the token. Unique enough per
      // device since tokens are 100+ chars and rotate frequently.
      `tok_${String(row.token ?? '').slice(-8) || row.id}`;
    if (seen.has(deviceKey)) continue;
    seen.add(deviceKey);
    deduped.push({ ...row, _deviceKey: deviceKey });
    if (deduped.length >= 10) break;
  }

  const sessions = deduped.map((row) => ({
    id: row.id,
    device_name:
      row.device_info ?? row.device_name ?? row.user_agent ?? 'Mobile device',
    device_os: null,
    ip_address: null,
    location: null,
    is_current: currentRefreshToken ? row.token === currentRefreshToken : false,
    last_active: row.last_used_at ?? row.created_at,
    created_at: row.created_at,
  }));

  // If we couldn't identify "this device" by the refresh token header, mark
  // the most recently used row as current — that's almost always the
  // session the user is sitting in right now.
  if (!sessions.some((s) => s.is_current) && sessions.length > 0) {
    sessions[0].is_current = true;
  }

  return res.json({ sessions });
}

// DELETE /account/sessions/:sessionId — delete a single refresh_tokens row.
export async function revokeSession(req: Request, res: Response) {
  const userId = req.userId!;
  const { sessionId } = req.params;

  const { data: deleted, error } = await supabase
    .from('refresh_tokens')
    .delete()
    .eq('id', sessionId)
    .eq('user_id', userId)
    .select('id');

  if (error) return res.status(500).json({ error: error.message });
  // SC-32: a 0-row delete (not your session, or missing) must 404.
  if (!deleted || deleted.length === 0) {
    return res.status(404).json({ error: 'Session not found' });
  }
  return res.json({ success: true });
}

// DELETE /account/sessions/all — revoke all other refresh tokens.
// The caller's current token (X-Refresh-Token header) is preserved so they
// stay logged in on this device.
export async function revokeAllSessions(req: Request, res: Response) {
  const userId = req.userId!;
  const currentRefreshToken =
    (req.headers['x-refresh-token'] as string | undefined) ?? null;

  let query = supabase
    .from('refresh_tokens')
    .delete()
    .eq('user_id', userId);
  if (currentRefreshToken) {
    query = query.neq('token', currentRefreshToken);
  }
  const { error } = await query;
  if (error) return res.status(500).json({ error: error.message });

  // SC-384: deleting the refresh tokens only stops those devices RENEWING. The
  // access token each one already holds stays valid for its full 15-minute life,
  // so without this the device the user just signed out kept full API access for
  // a quarter of an hour — exactly the window that matters when the reason for
  // tapping this is a lost or stolen phone. Stamping sessions_revoked_at makes
  // every token minted before now fail on its next request.
  await revokeSessionsNow(userId);

  // That stamp would also kill the caller's own token, so hand this device a
  // replacement minted after the cutoff. Returning it keeps the promise the UI
  // makes — other devices out, this one still signed in.
  const accessToken = generateAccessToken(userId);
  return res.json({
    success: true,
    message: 'All other sessions revoked',
    accessToken,
  });
}

// POST /account/export-data — DPDP Act right-to-portability.
// Assembles a JSON bundle of everything we store about the authenticated user
// that they've actually produced (profile, posts, matches, messages, txns,
// social graph). Inline, no background job yet — dataset sizes are small.
/**
 * GET /account/export — "Download everything we store about you (JSON)".
 *
 * SC-383 rewrite. The old version made three promises it did not keep:
 *   · messages were capped at 100 and every other section was UNPAGED, so a
 *     busy account silently exported a PostgREST page rather than its data —
 *     the same "page length passed off as the total" class this app has
 *     shipped repeatedly;
 *   · whole categories the app stores were simply absent (teams, tournaments,
 *     notifications, gifts, badges, blocks, reviews, coin ledger, ...);
 *   · nothing stopped stored markup from travelling verbatim into a file that
 *     might later be opened as HTML.
 *
 * What it must NEVER contain is equally explicit: no credentials. otp_codes,
 * refresh_tokens and push_tokens are not read at all, and `sessions` is read by
 * an explicit column list so `sessions.refresh_token` cannot leak — a select('*')
 * here would hand every device's refresh token to anyone who got the file.
 */

/** Read every row of a user-owned slice, paging so nothing is silently capped. */
async function exportAll(
  table: string,
  columns: string,
  filter: (q: any) => any,
): Promise<{ rows: any[]; error: unknown }> {
  const PAGE = 1000;
  const rows: any[] = [];
  for (let from = 0; ; from += PAGE) {
    const { data, error } = await filter(
      supabase.from(table).select(columns),
    ).range(from, from + PAGE - 1);
    if (error) return { rows, error };
    rows.push(...(data ?? []));
    if (!data || data.length < PAGE) break;
  }
  return { rows, error: null };
}

export async function exportData(req: Request, res: Response) {
  const userId = req.userId!;

  const slices: Array<[string, Promise<{ rows: any[]; error: unknown }>]> = [
    ['sport_profiles', exportAll('user_sport_profiles', 'sport_id, rating, matches_played, wins, losses, draws, last_match_at', (q) => q.eq('user_id', userId))],
    ['sports', exportAll('user_sports', '*', (q) => q.eq('user_id', userId))],
    ['posts', exportAll('community_posts', 'id, content, image_url, created_at', (q) => q.eq('author_id', userId))],
    ['profile_posts', exportAll('profile_posts', '*', (q) => q.eq('author_id', userId))],
    ['matches', exportAll('match_participants', 'match_id, team_side, role, match:matches(id, sport_id, scheduled_at, status, winner_team_id)', (q) => q.eq('user_id', userId))],
    ['messages', exportAll('messages', 'id, chat_id, content, created_at', (q) => q.eq('sender_id', userId))],
    ['transactions', exportAll('transactions', 'id, type, amount_inr, coins, description, status, created_at', (q) => q.eq('user_id', userId))],
    ['coin_ledger', exportAll('coin_events', 'id, event_type, coins, created_at', (q) => q.eq('user_id', userId))],
    ['followers', exportAll('follow_relationships', 'follower_id, created_at', (q) => q.eq('following_id', userId))],
    ['following', exportAll('follow_relationships', 'following_id, created_at', (q) => q.eq('follower_id', userId))],
    ['teams', exportAll('team_members', 'team_id, role, joined_at, team:teams(id, name, sport_id)', (q) => q.eq('user_id', userId))],
    ['notifications', exportAll('notifications', 'id, type, title, body, read, created_at', (q) => q.eq('user_id', userId))],
    ['gifts_sent', exportAll('gift_transactions', '*', (q) => q.eq('sender_id', userId))],
    ['gifts_received', exportAll('gift_transactions', '*', (q) => q.eq('receiver_id', userId))],
    ['badges', exportAll('user_badges', '*', (q) => q.eq('user_id', userId))],
    ['blocked_users', exportAll('user_blocks', '*', (q) => q.eq('blocker_id', userId))],
    ['reviews_written', exportAll('user_reviews', '*', (q) => q.eq('reviewer_id', userId))],
    ['feedback', exportAll('feedback', 'id, category, message, rating, created_at', (q) => q.eq('user_id', userId))],
    ['rating_history', exportAll('rating_history', '*', (q) => q.eq('user_id', userId))],
    ['subscriptions', exportAll('subscriptions', '*', (q) => q.eq('user_id', userId))],
    // Explicit columns — NEVER select('*') here, refresh_token lives on this row.
    ['sessions', exportAll('sessions', 'id, device_name, device_os, location, is_current, last_active, created_at', (q) => q.eq('user_id', userId))],
  ];

  // Tournament entries are keyed by TEAM, so they have to be resolved through
  // the user's teams — filtering them by user id would have quietly produced an
  // empty section for everyone.
  const { data: myTeams } = await supabase
    .from('team_members').select('team_id').eq('user_id', userId);
  const myTeamIds = (myTeams ?? []).map((t: any) => t.team_id).filter(Boolean);
  if (myTeamIds.length > 0) {
    slices.push(['tournament_entries', exportAll(
      'tournament_entries',
      'tournament_id, team_id, status, seed, group_label, entered_at',
      (q) => q.in('team_id', myTeamIds),
    )]);
  }

  const { data: profile, error: profileErr } = await supabase
    .from('users')
    .select('id, phone, name, username, email, bio, gender, dob, city_id, created_at, is_premium, premium_expires_at, coin_balance, referral_code, referred_by')
    .eq('id', userId)
    .maybeSingle();

  const payload: Record<string, any> = {
    exportedAt: new Date().toISOString(),
    profile: profile ?? null,
  };

  // SC-162: a broken sub-query used to be masked by a `?? []` and silently drop
  // a whole section. Report per-section failures IN the file as well as the log,
  // so a missing section is never mistaken for "we hold nothing here".
  const failed: string[] = [];
  if (profileErr) failed.push('profile');
  for (const [name, p] of slices) {
    const { rows, error } = await p;
    if (error) {
      console.error(`[export-data] section '${name}' failed for ${userId}:`, error);
      failed.push(name);
    }
    payload[name] = rows;
  }
  payload.incompleteSections = failed;

  // SC-383: neutralise markup so the file cannot execute wherever it is opened.
  // res.json() escapes what JSON requires — quotes and backslashes — but not
  // '<', '>' or '&', so a stored name like "<script>alert(1)</script>" (which
  // this app does hold; names are not stripped at rest) would survive intact
  // into a file a user might open in a browser or paste into a page. Encoding
  // them as \u00XX keeps the JSON byte-for-byte equivalent on parse while
  // making it inert as markup.
  const body = JSON.stringify(payload)
    .replace(/</g, '\\u003c')
    .replace(/>/g, '\\u003e')
    .replace(/&/g, '\\u0026');
  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  res.setHeader('Content-Disposition', 'attachment; filename="sportclan-export.json"');
  res.setHeader('X-Content-Type-Options', 'nosniff');
  return res.send(body);
}

// POST /account/feedback  { category, message, rating?, email? }
export async function submitFeedback(req: Request, res: Response) {
  const userId = req.userId!;
  const { category, message, rating, email } = req.body || {};

  if (!message || message.trim().length === 0) {
    return res.status(400).json({ error: 'message required' });
  }

  const { error } = await supabase.from('feedback').insert({
    user_id: userId,
    category: category || 'general',
    message: message.trim().slice(0, 1000),
    rating: rating || null,
    email: email || null,
  });

  if (error) return res.status(500).json({ error: error.message });
  return res.json({ success: true, message: 'Feedback submitted. We reply within 48h.' });
}
