import { Request, Response } from 'express';
import { supabase } from '../utils/supabase';

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
export async function purgeExpiredAccounts(req: Request, res: Response) {
  const secret = req.headers['x-cron-secret'];
  if (!process.env.CRON_SECRET || secret !== process.env.CRON_SECRET) {
    return res.status(403).json({ error: 'Forbidden' });
  }
  const cutoff = new Date(Date.now() - 30 * 86400000).toISOString();

  // Find users past the grace window
  const { data: expired, error: fetchErr } = await supabase
    .from('users')
    .select('id')
    .lt('deleted_at', cutoff)
    .not('deleted_at', 'is', null);

  if (fetchErr) return res.status(500).json({ error: fetchErr.message });
  if (!expired || expired.length === 0) return res.json({ purged: 0 });

  const ids = expired.map((u: { id: string }) => u.id);

  // Hard-delete the user rows. FK cascades on user_id should clear content
  // automatically; anything that's set to SET NULL will detach.
  const { error: delErr } = await supabase.from('users').delete().in('id', ids);
  if (delErr) return res.status(500).json({ error: delErr.message });

  return res.json({ purged: ids.length, ids });
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
  return res.json({ success: true, message: 'All other sessions revoked' });
}

// POST /account/export-data — DPDP Act right-to-portability.
// Assembles a JSON bundle of everything we store about the authenticated user
// that they've actually produced (profile, posts, matches, messages, txns,
// social graph). Inline, no background job yet — dataset sizes are small.
export async function exportData(req: Request, res: Response) {
  const userId = req.userId!;

  const [
    profileRes,
    postsRes,
    matchesRes,
    messagesRes,
    txnsRes,
    followersRes,
    followingRes,
    sportProfilesRes,
  ] = await Promise.all([
    supabase
      .from('users')
      .select('id, phone, name, username, email, bio, gender, dob, city_id, created_at, is_premium, premium_expires_at, coin_balance')
      .eq('id', userId)
      .maybeSingle(),
    supabase
      .from('posts')
      .select('id, content, image_url, created_at')
      .eq('user_id', userId)
      .order('created_at', { ascending: false }),
    supabase
      .from('match_participants')
      .select('match_id, team_side, role, match:matches(id, sport_id, scheduled_at, status, winner_team_id)')
      .eq('user_id', userId),
    supabase
      .from('messages')
      .select('id, chat_id, content, created_at')
      .eq('sender_id', userId)
      .order('created_at', { ascending: false })
      .limit(100),
    supabase
      .from('transactions')
      .select('id, type, amount_inr, coins, description, status, created_at')
      .eq('user_id', userId)
      .order('created_at', { ascending: false }),
    supabase
      .from('follow_relationships')
      .select('follower_id, created_at')
      .eq('following_id', userId),
    supabase
      .from('follow_relationships')
      .select('following_id, created_at')
      .eq('follower_id', userId),
    supabase
      .from('user_sport_profiles')
      .select('sport_id, rating, matches_played, wins, losses, draws, last_match_at')
      .eq('user_id', userId),
  ]);

  return res.json({
    exportedAt: new Date().toISOString(),
    profile: profileRes.data ?? null,
    sport_profiles: sportProfilesRes.data ?? [],
    posts: postsRes.data ?? [],
    matches: matchesRes.data ?? [],
    messages_last_100: messagesRes.data ?? [],
    transactions: txnsRes.data ?? [],
    followers: followersRes.data ?? [],
    following: followingRes.data ?? [],
  });
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
