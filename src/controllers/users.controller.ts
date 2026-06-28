import { Request, Response } from 'express';
import { supabase } from '../utils/supabase';
import { sanitizeError } from '../utils/response';
import { checkExpiredSubscriptions } from './subscriptions.controller';
import { resolveSportId } from '../utils/sportId';
import { VALID_ACCOUNT_TYPES } from '../constants/accountTypes';

// Public-safe user fields. Never returns password_hash.
const PUBLIC_FIELDS =
  'id, phone, name, username, email, city_id, account_type, profile_picture_url, bio, gender, dob, show_dob, link, is_premium, premium_expires_at, coin_balance, is_available, streak_count, referral_code, trial_used, is_admin, created_at';

// Fire smart engagement notifications lazily from /users/me. Best-effort,
// never throws — failures here must not block the main profile response.
async function runSmartNotifications(userId: string): Promise<void> {
  try {
    const now = new Date();
    const fifteenMinsMs = 15 * 60 * 1000;
    const in15m = new Date(now.getTime() + fifteenMinsMs).toISOString();
    const nowIso = now.toISOString();

    // 1. Match reminders for matches starting in the next 15 minutes where
    //    the user is a participant and a reminder hasn't been sent yet.
    const { data: parts } = await supabase
      .from('match_participants')
      .select('match_id, match:matches(id, team_a_name, team_b_name, scheduled_at, status)')
      .eq('user_id', userId);

    const soonMatches = (parts || []).filter((p) => {
      const m: any = p.match;
      if (!m) return false;
      if (m.status === 'completed' || m.status === 'cancelled') return false;
      if (!m.scheduled_at) return false;
      const t = new Date(m.scheduled_at).toISOString();
      return t > nowIso && t <= in15m;
    });

    for (const p of soonMatches) {
      const m: any = p.match;
      // Have we already inserted a reminder for this user+match? Check notifs.
      const { data: existing } = await supabase
        .from('notifications')
        .select('id')
        .eq('user_id', userId)
        .eq('type', 'match_reminder')
        .contains('data', { matchId: m.id })
        .maybeSingle();
      if (existing) continue;
      await supabase.from('notifications').insert({
        user_id: userId,
        type: 'match_reminder',
        title: 'Match reminder',
        body: `\u23F0 ${m.team_a_name} vs ${m.team_b_name} starts in 15 minutes!`,
        data: { matchId: m.id, screen: 'MatchDetail' },
      });
    }

    // 2. Friday evening engagement nudge: if it's Friday 18:00-20:00 local
    //    (we assume IST / UTC+5:30 for the India audience) and the user
    //    hasn't created a match this week, insert a once-per-week nudge.
    const ist = new Date(now.getTime() + 5.5 * 60 * 60 * 1000);
    const dayOfWeek = ist.getUTCDay(); // 5 = Friday in IST
    const hourIst = ist.getUTCHours();
    if (dayOfWeek === 5 && hourIst >= 18 && hourIst < 20) {
      // Start of current ISO week (Monday 00:00 IST).
      const weekStart = new Date(ist);
      const diffToMonday = (weekStart.getUTCDay() + 6) % 7;
      weekStart.setUTCDate(weekStart.getUTCDate() - diffToMonday);
      weekStart.setUTCHours(0, 0, 0, 0);
      const weekStartIso = new Date(weekStart.getTime() - 5.5 * 60 * 60 * 1000).toISOString();

      const { data: myMatches } = await supabase
        .from('matches')
        .select('id')
        .eq('created_by', userId)
        .gte('created_at', weekStartIso)
        .limit(1);
      if (!myMatches || myMatches.length === 0) {
        const { data: alreadySent } = await supabase
          .from('notifications')
          .select('id')
          .eq('user_id', userId)
          .eq('type', 'weekend_nudge')
          .gte('created_at', weekStartIso)
          .maybeSingle();
        if (!alreadySent) {
          await supabase.from('notifications').insert({
            user_id: userId,
            type: 'weekend_nudge',
            title: '\uD83C\uDFC6 Plan your weekend match!',
            body: 'Create a match and invite your friends before Sunday.',
            data: { screen: 'Home' },
          });
        }
      }
    }
  } catch {
    // swallow
  }
}

// GET /users/me — self profile with premium lazy expiry check.
// Wired to Fix 1: on every app-startup fetch we reconcile subscription state.
export async function getMe(req: Request, res: Response) {
  const userId = req.userId;
  if (!userId) return res.status(401).json({ error: 'Unauthorized' });
  await checkExpiredSubscriptions(userId);
  // Fire-and-forget — the profile response shouldn't wait on this.
  void runSmartNotifications(userId);
  const { data, error } = await supabase
    .from('users')
    .select(PUBLIC_FIELDS)
    .eq('id', userId)
    .maybeSingle();
  if (error) return res.status(500).json({ error: error.message });
  if (!data) return res.status(404).json({ error: 'User not found' });

  // Profile-completion bonus — 10 coins, once per user. Idempotent via
  // coin_events unique key. Requires name + photo + city + at least 1 sport.
  try {
    const hasName = !!data.name;
    const hasPhoto = !!data.profile_picture_url;
    const hasCity = !!data.city_id;
    if (hasName && hasPhoto && hasCity) {
      const { count: sportCount } = await supabase
        .from('user_sports')
        .select('id', { count: 'exact', head: true })
        .eq('user_id', userId);
      if ((sportCount ?? 0) > 0) {
        const { awardCoins } = await import('../utils/coins');
        void awardCoins(userId, 'complete_profile', 10);
      }
    }
  } catch {
    // swallow
  }

  // Pull the user's full account-type set from the join table so the client
  // can render & edit the complete list (the legacy users.account_type column
  // only holds the primary type). Falls back to the legacy column if the join
  // table is empty (e.g. older accounts created before multi-type support).
  let accountTypes: string[] = [];
  try {
    const { data: atRows } = await supabase
      .from('user_account_types')
      .select('account_type')
      .eq('user_id', userId);
    accountTypes = (atRows ?? []).map((r: { account_type: string }) => r.account_type);
  } catch {
    // swallow — fall back below
  }
  if (accountTypes.length === 0 && data.account_type) {
    accountTypes = [data.account_type];
  }

  return res.json({ user: { ...data, account_types: accountTypes } });
}

// GET /users/:id — public profile
export async function getUserById(req: Request, res: Response) {
  const { id } = req.params;
  const { data, error } = await supabase
    .from('users')
    .select(PUBLIC_FIELDS)
    .eq('id', id)
    .maybeSingle();
  if (error) return res.status(500).json({ error: error.message });
  if (!data) return res.status(404).json({ error: 'User not found' });

  // Respect the DOB privacy toggle (PRD 17.5): if the owner hid their DOB,
  // strip it from the public response. Viewing your own profile hits
  // /users/me instead, so we don't need a self-bypass here.
  const safeUser: any = { ...data };
  if (safeUser.show_dob === false) {
    safeUser.dob = null;
  }

  // NOTE: a "service account premium gating" block used to live here that
  // masked non-premium service profiles. It was dead code (it compared the
  // lowercase stored account_type against capitalized compound strings like
  // 'Umpire-Referee', so it never matched a real user) with no frontend
  // consumer of its `isPremiumRequired` flag. It was also redundant with the
  // /services directory, which already premium-gates provider discovery, and
  // "fixing" the casing would have wrongly masked the profiles of users who
  // self-assign a service type in Edit Profile without being premium. Removed.

  // Counts (followers/following) — best-effort, never fail the request.
  const [followersRes, followingRes, giftsRes] = await Promise.all([
    supabase.from('follow_relationships').select('id', { count: 'exact', head: true }).eq('following_id', id),
    supabase.from('follow_relationships').select('id', { count: 'exact', head: true }).eq('follower_id', id),
    // Aggregate gifts received grouped by gift type for the profile display
    supabase.from('gift_transactions')
      .select('gift_id, gift_emoji, gift_name')
      .eq('receiver_id', id)
      .order('created_at', { ascending: false })
      .limit(100),
  ]);

  // Group gifts by type with count
  const giftMap = new Map<string, { emoji: string; name: string; count: number }>();
  for (const g of giftsRes.data ?? []) {
    const existing = giftMap.get(g.gift_id);
    if (existing) existing.count++;
    else giftMap.set(g.gift_id, { emoji: g.gift_emoji, name: g.gift_name, count: 1 });
  }

  // Check if the caller follows this user (for isFollowing state on frontend)
  let isFollowing = false;
  const callerId = req.userId;
  if (callerId && callerId !== id) {
    const { data: followRow } = await supabase
      .from('follow_relationships')
      .select('id')
      .eq('follower_id', callerId)
      .eq('following_id', id)
      .maybeSingle();
    isFollowing = !!followRow;
  }

  return res.json({
    user: safeUser,
    followers: followersRes.count ?? 0,
    following: followingRes.count ?? 0,
    isFollowing,
    gifts: Array.from(giftMap.values()),
    totalGifts: giftsRes.data?.length ?? 0,
  });
}

// PATCH /users/me — update own profile.
// Change #4: NO size limit on profile_picture_url. We accept any URL.
const ALLOWED_FIELDS = [
  'name', 'username', 'email', 'city_id', 'profile_picture_url', 'bio',
  'link', 'gender', 'dob', 'show_dob', 'is_available',
] as const;

const USERNAME_COOLDOWN_DAYS = 30;

export async function updateMe(req: Request, res: Response) {
  const userId = req.userId;
  if (!userId) return res.status(401).json({ error: 'Unauthorized' });
  const patch: Record<string, unknown> = {};
  for (const k of ALLOWED_FIELDS) {
    if (k in (req.body || {})) patch[k] = req.body[k];
  }
  if (Object.keys(patch).length === 0) {
    return res.status(400).json({ error: 'No updatable fields provided' });
  }

  // Username change: enforce 30-day cooldown and uniqueness
  if ('username' in patch && patch.username) {
    const { data: current } = await supabase
      .from('users')
      .select('username, last_username_changed_at')
      .eq('id', userId)
      .single();

    if (current && (patch.username as string).toLowerCase() !== current.username?.toLowerCase()) {
      // Check cooldown
      if (current.last_username_changed_at) {
        const lastChanged = new Date(current.last_username_changed_at);
        const nextAllowed = new Date(lastChanged.getTime() + USERNAME_COOLDOWN_DAYS * 24 * 60 * 60 * 1000);
        if (new Date() < nextAllowed) {
          return res.status(400).json({
            error: `Username can only be changed once every 30 days. Next change available: ${nextAllowed.toISOString().split('T')[0]}`,
          });
        }
      }
      // Check uniqueness
      const { data: taken } = await supabase
        .from('users')
        .select('id')
        .ilike('username', patch.username as string)
        .neq('id', userId)
        .maybeSingle();
      if (taken) return res.status(409).json({ error: 'Username already taken' });

      patch.last_username_changed_at = new Date().toISOString();
    } else {
      // Same username — remove from patch
      delete patch.username;
    }
  }

  patch.updated_at = new Date().toISOString();
  const { data, error } = await supabase
    .from('users')
    .update(patch)
    .eq('id', userId)
    .select(PUBLIC_FIELDS)
    .single();
  if (error) return res.status(500).json({ error: error.message });
  return res.json({ user: data });
}

// PATCH /users/me/account-types — replace the user's account-type set.
// Body: { account_types: string[] }. Validates against the 10 allowed types,
// rewrites the user_account_types join table, and keeps the legacy
// users.account_type column pointed at the primary (first) type.
export async function updateAccountTypes(req: Request, res: Response) {
  const userId = req.userId;
  if (!userId) return res.status(401).json({ error: 'Unauthorized' });

  const incoming = (req.body || {}).account_types;
  if (!Array.isArray(incoming)) {
    return res.status(400).json({ error: 'account_types must be an array' });
  }

  // De-dupe, lowercase, and validate.
  const cleaned = Array.from(
    new Set(incoming.map((t: unknown) => String(t).toLowerCase().trim())),
  );
  if (cleaned.length === 0) {
    return res.status(400).json({ error: 'Select at least one account type' });
  }
  const invalid = cleaned.filter((t) => !VALID_ACCOUNT_TYPES.includes(t as never));
  if (invalid.length > 0) {
    return res.status(400).json({ error: `Invalid account type(s): ${invalid.join(', ')}` });
  }

  // Order the result to keep 'player' first if present, otherwise preserve the
  // user's order; the primary (legacy) column gets the first entry.
  const ordered = [
    ...cleaned.filter((t) => t === 'player'),
    ...cleaned.filter((t) => t !== 'player'),
  ];
  const primary = ordered[0];

  // Rewrite the join table: delete existing rows, insert the new set.
  const { error: delErr } = await supabase
    .from('user_account_types')
    .delete()
    .eq('user_id', userId);
  if (delErr) return res.status(500).json({ error: delErr.message });

  const rows = ordered.map((t) => ({ user_id: userId, account_type: t }));
  const { error: insErr } = await supabase.from('user_account_types').insert(rows);
  if (insErr) return res.status(500).json({ error: insErr.message });

  // Keep the legacy primary column in sync.
  const { data, error } = await supabase
    .from('users')
    .update({ account_type: primary, updated_at: new Date().toISOString() })
    .eq('id', userId)
    .select(PUBLIC_FIELDS)
    .single();
  if (error) return res.status(500).json({ error: error.message });

  return res.json({ user: { ...data, account_types: ordered } });
}

// POST /users/:id/follow
export async function followUser(req: Request, res: Response) {
  const userId = req.userId;
  if (!userId) return res.status(401).json({ error: 'Unauthorized' });
  const { id: target } = req.params;
  if (target === userId) return res.status(400).json({ error: 'Cannot follow yourself' });
  const { error } = await supabase
    .from('follow_relationships')
    .insert({ follower_id: userId, following_id: target });
  if (error && !error.message.includes('duplicate')) {
    return res.status(500).json({ error: error.message });
  }
  return res.json({ success: true });
}

// DELETE /users/:id/follow
export async function unfollowUser(req: Request, res: Response) {
  const userId = req.userId;
  if (!userId) return res.status(401).json({ error: 'Unauthorized' });
  const { id: target } = req.params;
  const { error } = await supabase
    .from('follow_relationships')
    .delete()
    .eq('follower_id', userId)
    .eq('following_id', target);
  if (error) return res.status(500).json({ error: error.message });
  return res.json({ success: true });
}

// GET /users/:id/followers
export async function getFollowers(req: Request, res: Response) {
  const { id } = req.params;
  const { data, error } = await supabase
    .from('follow_relationships')
    .select('follower_id, users:follower_id (id, name, profile_picture_url, bio)')
    .eq('following_id', id)
    .order('created_at', { ascending: false });
  if (error) return res.status(500).json({ error: error.message });
  return res.json({ users: (data || []).map((r: any) => r.users).filter(Boolean) });
}

// GET /users/:id/following
export async function getFollowing(req: Request, res: Response) {
  const { id } = req.params;
  const { data, error } = await supabase
    .from('follow_relationships')
    .select('following_id, users:following_id (id, name, profile_picture_url, bio)')
    .eq('follower_id', id)
    .order('created_at', { ascending: false });
  if (error) return res.status(500).json({ error: error.message });
  return res.json({ users: (data || []).map((r: any) => r.users).filter(Boolean) });
}

// POST /users/:id/block
export async function blockUser(req: Request, res: Response) {
  const userId = req.userId;
  if (!userId) return res.status(401).json({ error: 'Unauthorized' });
  const { id: target } = req.params;
  if (target === userId) return res.status(400).json({ error: 'Cannot block yourself' });

  // Blocking implicitly unfollows in both directions.
  await supabase
    .from('follow_relationships')
    .delete()
    .or(`and(follower_id.eq.${userId},following_id.eq.${target}),and(follower_id.eq.${target},following_id.eq.${userId})`);

  const { error } = await supabase
    .from('user_blocks')
    .insert({ blocker_id: userId, blocked_id: target });
  if (error && !error.message.includes('duplicate')) {
    return res.status(500).json({ error: error.message });
  }
  return res.json({ success: true });
}

// DELETE /users/:id/block
export async function unblockUser(req: Request, res: Response) {
  const userId = req.userId;
  if (!userId) return res.status(401).json({ error: 'Unauthorized' });
  const { id: target } = req.params;
  const { error } = await supabase
    .from('user_blocks')
    .delete()
    .eq('blocker_id', userId)
    .eq('blocked_id', target);
  if (error) return res.status(500).json({ error: error.message });
  return res.json({ success: true });
}

// GET /users/me/blocked
export async function getBlockedUsers(req: Request, res: Response) {
  const userId = req.userId;
  if (!userId) return res.status(401).json({ error: 'Unauthorized' });
  const { data, error } = await supabase
    .from('user_blocks')
    .select('blocked_id, users:blocked_id (id, name, profile_picture_url)')
    .eq('blocker_id', userId)
    .order('created_at', { ascending: false });
  if (error) return res.status(500).json({ error: error.message });
  return res.json({ users: (data || []).map((r: any) => r.users).filter(Boolean) });
}

// GET /users/me/profile-completeness
// Simple % score based on filled-in fields. Tweak weights freely.
export async function getProfileCompleteness(req: Request, res: Response) {
  const userId = req.userId;
  if (!userId) return res.status(401).json({ error: 'Unauthorized' });
  const { data: user, error } = await supabase
    .from('users')
    .select('name, email, city_id, profile_picture_url, bio')
    .eq('id', userId)
    .maybeSingle();
  if (error) return res.status(500).json({ error: error.message });
  if (!user) return res.status(404).json({ error: 'User not found' });

  const checks: Array<{ field: string; filled: boolean; weight: number }> = [
    { field: 'name', filled: !!user.name, weight: 20 },
    { field: 'email', filled: !!user.email, weight: 15 },
    { field: 'city_id', filled: !!user.city_id, weight: 15 },
    { field: 'profile_picture_url', filled: !!user.profile_picture_url, weight: 25 },
    { field: 'bio', filled: !!user.bio, weight: 10 },
  ];
  // Sport count contributes the remaining 15 points.
  const { count: sportCountRaw } = await supabase
    .from('user_sports')
    .select('id', { count: 'exact', head: true })
    .eq('user_id', userId);
  const sportCount = sportCountRaw ?? 0;
  const sportPoints = Math.min(15, sportCount * 5);

  const filledPoints = checks.reduce((sum, c) => sum + (c.filled ? c.weight : 0), 0);
  const percent = Math.min(100, filledPoints + sportPoints);

  const missing = checks.filter((c) => !c.filled).map((c) => c.field);
  if (sportCount === 0) missing.push('sports');

  return res.json({ percent, missing });
}

// GET /users/discover?sport_id=&mode=singles|doubles
// Returns players within ±15% rating, same city, not blocked, sorted by last_active.
export async function discoverPlayers(req: Request, res: Response) {
  const userId = req.userId;
  if (!userId) return res.status(401).json({ error: 'Unauthorized' });
  const { sport_id, mode, match_type } = req.query as Record<string, string | undefined>;
  if (!sport_id) return res.status(400).json({ error: 'sport_id is required' });

  // Get requesting user's city and sport profile
  const { data: me } = await supabase
    .from('users')
    .select('city_id')
    .eq('id', userId)
    .maybeSingle();
  if (!me) return res.status(404).json({ error: 'User not found' });

  const { data: myProfile } = await supabase
    .from('user_sport_profiles')
    .select('rating')
    .eq('user_id', userId)
    .eq('sport_id', sport_id)
    .maybeSingle();

  const myRating = myProfile?.rating ?? 1200;
  const ratingLow = myRating * 0.85;
  const ratingHigh = myRating * 1.15;

  // Get blocked user IDs (in both directions)
  const { data: blocksOut } = await supabase
    .from('user_blocks')
    .select('blocked_id')
    .eq('blocker_id', userId);
  const { data: blocksIn } = await supabase
    .from('user_blocks')
    .select('blocker_id')
    .eq('blocked_id', userId);

  const blockedIds = new Set<string>();
  blockedIds.add(userId);
  for (const b of blocksOut || []) blockedIds.add(b.blocked_id);
  for (const b of blocksIn || []) blockedIds.add(b.blocker_id);

  // Query user_sport_profiles within rating range for this sport
  let query = supabase
    .from('user_sport_profiles')
    .select('user_id, rating, matches_played, wins, last_match_at, play_type')
    .eq('sport_id', sport_id)
    .gte('rating', ratingLow)
    .lte('rating', ratingHigh)
    .order('last_match_at', { ascending: false, nullsFirst: false })
    .limit(50);
  // Doubles partner filter: only show players with Doubles/Mixed play_type
  if (match_type === 'doubles') {
    query = query.overlaps('play_type', ['Doubles', 'Mixed']);
  }

  const { data: profiles, error } = await query;
  if (error) return res.status(500).json({ error: error.message });

  // Filter out blocked users
  const filteredProfiles = (profiles || []).filter((p) => !blockedIds.has(p.user_id));
  if (filteredProfiles.length === 0) return res.json({ players: [] });

  // Fetch user details for matched profiles
  const matchedIds = filteredProfiles.map((p) => p.user_id);
  const { data: users } = await supabase
    .from('users')
    .select('id, name, username, profile_picture_url, city_id, is_premium, is_available, streak_count')
    .in('id', matchedIds);

  const userMap = new Map<string, any>();
  for (const u of users || []) userMap.set(u.id, u);

  // Filter by same city if user has one, then rank by availability + rating.
  const players = filteredProfiles
    .map((p) => {
      const u = userMap.get(p.user_id);
      if (!u) return null;
      if (me.city_id && u.city_id && u.city_id !== me.city_id) return null;
      return {
        user_id: p.user_id,
        name: u.name,
        username: u.username,
        profile_picture_url: u.profile_picture_url,
        city_id: u.city_id,
        is_premium: u.is_premium,
        is_available: !!u.is_available,
        streak_count: u.streak_count ?? 0,
        rating: p.rating,
        matches_played: p.matches_played,
        wins: p.wins,
        last_active: p.last_match_at,
      };
    })
    .filter(Boolean) as any[];

  // Premium users appear first (ComparisonScreen: "Higher priority"),
  // then available players, then sort by rating similarity.
  players.sort((a, b) => {
    if (a.is_premium !== b.is_premium) return a.is_premium ? -1 : 1;
    if (a.is_available !== b.is_available) return a.is_available ? -1 : 1;
    // Closest rating to the requesting user ranks higher
    const diffA = Math.abs((a.rating ?? 1200) - myRating);
    const diffB = Math.abs((b.rating ?? 1200) - myRating);
    return diffA - diffB;
  });

  return res.json({ players, mode: mode || 'singles' });
}

// GET /users/:id/activity-heatmap — returns an entry per day for the last
// 84 days. `type` is one of 'none' | 'played' | 'won'. Cheap to compute
// on demand; the frontend caches it per-user.
export async function getActivityHeatmap(req: Request, res: Response) {
  const { id } = req.params;
  // 84 days ago in the same timezone as the server.
  const since = new Date();
  since.setDate(since.getDate() - 83);
  since.setHours(0, 0, 0, 0);
  const sinceIso = since.toISOString();

  // Fetch this user's match participations joined with the match row so we
  // can tell who won. Cast team_side to 'A' | 'B' for the winner check.
  const { data, error } = await supabase
    .from('match_participants')
    .select('team_side, match:matches(id, scheduled_at, status, winner_team_id, team_a_id, team_b_id, updated_at)')
    .eq('user_id', id)
    .limit(500);

  if (error) return res.status(500).json({ error: error.message });

  const byDay = new Map<string, 'played' | 'won'>();
  for (const row of data || []) {
    const match: any = row.match;
    if (!match) continue;
    if (match.status !== 'completed') continue;
    const ts = match.updated_at ?? match.scheduled_at;
    if (!ts) continue;
    const d = new Date(ts);
    if (d < since) continue;
    const key = d.toISOString().slice(0, 10);

    // Winner detection: winner_team_id matches the side's team id.
    const mySideTeamId = row.team_side === 'A' ? match.team_a_id : match.team_b_id;
    const iWon = match.winner_team_id && match.winner_team_id === mySideTeamId;

    // "won" is more interesting than "played", so upgrade but never downgrade.
    if (iWon) {
      byDay.set(key, 'won');
    } else if (!byDay.has(key)) {
      byDay.set(key, 'played');
    }
  }

  // Emit an 84-day dense array, oldest first.
  const out: Array<{ date: string; type: 'none' | 'played' | 'won' }> = [];
  for (let i = 0; i < 84; i++) {
    const d = new Date(since);
    d.setDate(since.getDate() + i);
    const key = d.toISOString().slice(0, 10);
    out.push({ date: key, type: byDay.get(key) ?? 'none' });
  }
  return res.json({ heatmap: out });
}

// GET /users/:id/rival?sport_id=... — finds a rival player: the user in the
// same sport with the closest higher rating. Searches progressively wider
// scopes (city → state → country) and returns the first match. Returns null
// if the caller is the top player in the wider pool.
export async function getRival(req: Request, res: Response) {
  const userId = req.userId;
  if (!userId) return res.status(401).json({ error: 'Unauthorized' });
  const { id } = req.params;
  const rawSportId = req.query.sport_id as string | undefined;
  if (!rawSportId) return res.status(400).json({ error: 'sport_id is required' });
  const sportId = (await resolveSportId(rawSportId)) ?? rawSportId;

  // Get the requester's rating + location.
  const { data: myProfile } = await supabase
    .from('user_sport_profiles')
    .select('rating, matches_played')
    .eq('user_id', id)
    .eq('sport_id', sportId)
    .maybeSingle();
  if (!myProfile) return res.json({ rival: null });

  const { data: me } = await supabase
    .from('users')
    .select('city_id')
    .eq('id', id)
    .maybeSingle();
  const myCityId = me?.city_id ?? null;

  // Resolve state via cities join for state-level fallback.
  let myStateId: string | null = null;
  if (myCityId) {
    const { data: cityRow } = await supabase
      .from('cities')
      .select('state_id, state')
      .eq('id', myCityId)
      .maybeSingle();
    myStateId = cityRow?.state_id ?? cityRow?.state ?? null;
  }

  // Query all candidate profiles with higher rating and sort by delta.
  const { data: higher } = await supabase
    .from('user_sport_profiles')
    .select('user_id, rating, matches_played, wins')
    .eq('sport_id', sportId)
    .gt('rating', myProfile.rating)
    .order('rating', { ascending: true })
    .limit(200);

  if (!higher || higher.length === 0) {
    return res.json({ rival: null });
  }

  const candidateIds = higher.map((h) => h.user_id).filter((uid) => uid !== id);
  if (candidateIds.length === 0) return res.json({ rival: null });

  const { data: users } = await supabase
    .from('users')
    .select('id, name, username, profile_picture_url, city_id, is_premium')
    .in('id', candidateIds);
  const userMap = new Map<string, any>();
  for (const u of users || []) userMap.set(u.id, u);

  // Helper: resolve a candidate's state from their city.
  const stateCache = new Map<string, string | null>();
  const resolveState = async (cityId: string | null): Promise<string | null> => {
    if (!cityId) return null;
    if (stateCache.has(cityId)) return stateCache.get(cityId) ?? null;
    const { data: cityRow } = await supabase
      .from('cities')
      .select('state_id, state')
      .eq('id', cityId)
      .maybeSingle();
    const s = cityRow?.state_id ?? cityRow?.state ?? null;
    stateCache.set(cityId, s);
    return s;
  };

  // Tiered search: city first, then state, then country-wide. The candidates
  // array is already ordered by rating ascending, so the first match we keep
  // for each tier is the closest-higher rival.
  const pickTier = async (tier: 'city' | 'state' | 'country') => {
    for (const h of higher) {
      if (h.user_id === id) continue;
      const u = userMap.get(h.user_id);
      if (!u) continue;
      if (tier === 'city' && myCityId && u.city_id !== myCityId) continue;
      if (tier === 'state') {
        if (!myStateId) continue;
        const s = await resolveState(u.city_id);
        if (s !== myStateId) continue;
      }
      return { profile: h, user: u };
    }
    return null;
  };

  const match = (await pickTier('city')) ?? (await pickTier('state')) ?? (await pickTier('country'));
  if (!match) return res.json({ rival: null });

  return res.json({
    rival: {
      user_id: match.profile.user_id,
      name: match.user.name,
      username: match.user.username,
      profile_picture_url: match.user.profile_picture_url,
      city_id: match.user.city_id,
      is_premium: !!match.user.is_premium,
      rating: match.profile.rating,
      matches_played: match.profile.matches_played,
      wins: match.profile.wins,
      points_ahead: Math.round((match.profile.rating - myProfile.rating) * 100) / 100,
    },
  });
}

// GET /users/:id/rating-history?sport_id=... — last-10 rating history rows
// for the given user/sport, oldest-first so the chart can render straight
// left→right without client-side reversal.
export async function getRatingHistory(req: Request, res: Response) {
  const { id } = req.params;
  const rawSportId = req.query.sport_id as string | undefined;
  if (!rawSportId) return res.status(400).json({ error: 'sport_id is required' });
  const sportId = (await resolveSportId(rawSportId)) ?? rawSportId;

  const { data, error } = await supabase
    .from('rating_history')
    .select('old_rating, new_rating, delta, created_at')
    .eq('user_id', id)
    .eq('sport_id', sportId)
    .order('created_at', { ascending: false })
    .limit(10);
  if (error) return res.status(500).json({ error: error.message });

  // Oldest → newest.
  const ordered = (data ?? []).reverse();
  return res.json({ history: ordered });
}

// GET /users/:id/sport-profile/:sportId — per-sport rating + stats
// Every preference column the frontend can edit. Centralised here so
// getSportProfile and updateSportProfile agree on what's allowed.
const SPORT_PROFILE_PREFS = [
  'batting_style', 'bowling_style', 'role',
  'dominant_hand', 'play_type', 'preferred_position', 'playing_level',
  'preferred_foot', 'position', 'play_style',
  'backhand_type', 'grip_type', 'preferred_side',
  'playing_style', 'stick_type',
] as const;

const SPORT_PROFILE_SELECT =
  'rating, matches_played, wins, losses, draws, last_match_at, ' +
  SPORT_PROFILE_PREFS.join(', ');

export async function getSportProfile(req: Request, res: Response) {
  const { id, sportId: rawSportId } = req.params;
  // Accept either a slug ('cricket') or a UUID; the app passes slugs.
  const sportId = (await resolveSportId(rawSportId)) ?? rawSportId;

  const { data: profile } = await supabase
    .from('user_sport_profiles')
    .select(SPORT_PROFILE_SELECT)
    .eq('user_id', id)
    .eq('sport_id', sportId)
    .maybeSingle();

  if (!profile) {
    return res.json({
      profile: {
        rating: 1200,
        matches_played: 0,
        wins: 0,
        losses: 0,
        draws: 0,
        last_match_at: null,
        cityRank: null,
        globalRank: null,
      },
    });
  }

  // Calculate city + global rank by counting how many players have a
  // strictly higher rating in the same sport. Rank = count + 1.
  let cityRank: number | null = null;
  let globalRank: number | null = null;

  const p = profile as any;
  try {
    // Global rank
    const { count: aboveGlobal } = await supabase
      .from('user_sport_profiles')
      .select('id', { count: 'exact', head: true })
      .eq('sport_id', sportId)
      .gt('rating', p.rating);
    globalRank = (aboveGlobal ?? 0) + 1;

    // City rank — need the user's city_id from the users table
    const { data: userRow } = await supabase
      .from('users')
      .select('city_id')
      .eq('id', id)
      .maybeSingle();
    if (userRow?.city_id) {
      const { count: aboveCity } = await supabase
        .from('user_sport_profiles')
        .select('id', { count: 'exact', head: true })
        .eq('sport_id', sportId)
        .gt('rating', p.rating);
      cityRank = (aboveCity ?? 0) + 1;
    }
  } catch {
    // Non-critical — return null ranks if calculation fails
  }

  // Sport-specific stats aggregated from match_events. Best-effort —
  // if the query fails or no events exist we just omit sportStats.
  let sportStats: Record<string, number> | null = null;
  try {
    const { data: sportRow } = await supabase.from('sports').select('slug').eq('id', sportId).maybeSingle();
    const slug = sportRow?.slug ?? '';

    // Get user's match IDs
    const { data: parts } = await supabase
      .from('match_participants')
      .select('match_id')
      .eq('user_id', id);
    const matchIds = (parts ?? []).map((mp: any) => mp.match_id);

    if (slug === 'cricket') {
      // Use innings_stats table for accurate per-innings aggregates
      const { data: innings } = await supabase
        .from('innings_stats')
        .select('runs, balls_faced, fours, sixes, is_out, bowling_overs, bowling_runs, bowling_wickets, catches, runouts')
        .eq('user_id', id);

      if (innings && innings.length > 0) {
        const totalRuns = innings.reduce((s, i) => s + (i.runs ?? 0), 0);
        const totalBalls = innings.reduce((s, i) => s + (i.balls_faced ?? 0), 0);
        const totalFours = innings.reduce((s, i) => s + (i.fours ?? 0), 0);
        const totalSixes = innings.reduce((s, i) => s + (i.sixes ?? 0), 0);
        const dismissals = innings.filter((i) => i.is_out).length;
        const hs = Math.max(...innings.map((i) => i.runs ?? 0));
        const fifties = innings.filter((i) => (i.runs ?? 0) >= 50 && (i.runs ?? 0) < 100).length;
        const hundreds = innings.filter((i) => (i.runs ?? 0) >= 100).length;
        const bowlOvers = innings.reduce((s, i) => s + Number(i.bowling_overs ?? 0), 0);
        const bowlRuns = innings.reduce((s, i) => s + (i.bowling_runs ?? 0), 0);
        const bowlWickets = innings.reduce((s, i) => s + (i.bowling_wickets ?? 0), 0);
        const totalCatches = innings.reduce((s, i) => s + (i.catches ?? 0), 0);
        const totalRunouts = innings.reduce((s, i) => s + (i.runouts ?? 0), 0);

        sportStats = {
          total_runs: totalRuns,
          batting_average: dismissals > 0 ? Math.round((totalRuns / dismissals) * 100) / 100 : totalRuns,
          strike_rate: totalBalls > 0 ? Math.round((totalRuns / totalBalls) * 10000) / 100 : 0,
          highest_score: hs,
          balls_faced: totalBalls,
          fours: totalFours,
          sixes: totalSixes,
          fifties,
          hundreds,
          total_wickets: bowlWickets,
          bowling_economy: bowlOvers > 0 ? Math.round((bowlRuns / bowlOvers) * 100) / 100 : 0,
          bowling_average: bowlWickets > 0 ? Math.round((bowlRuns / bowlWickets) * 100) / 100 : 0,
          catches: totalCatches,
          runouts: totalRunouts,
        };
      } else {
        // Fallback to match_events aggregation
        const { data: events } = await supabase.from('match_events').select('event_type, payload, created_by').in('match_id', matchIds.slice(0, 100));
        const myEvts = (events ?? []).filter((e: any) => e.created_by === id);
        let runs = 0, balls = 0, f4 = 0, s6 = 0, wkts = 0, hs2 = 0;
        for (const e of myEvts) {
          const pay: any = e.payload ?? {};
          if (e.event_type === 'ball') { const r = Number(pay.runs ?? 0); runs += r; balls++; if (r === 4) f4++; if (r === 6) s6++; if (runs > hs2) hs2 = runs; }
          if (e.event_type === 'wicket' || pay.wicket) wkts++;
        }
        sportStats = { total_runs: runs, total_wickets: wkts, balls_faced: balls, strike_rate: balls > 0 ? Math.round((runs / balls) * 100) : 0, highest_score: hs2, fours: f4, sixes: s6, fifties: 0, hundreds: 0 };
      }
    } else if (slug === 'football' && matchIds.length > 0) {
      const { data: events } = await supabase.from('match_events').select('event_type, created_by').in('match_id', matchIds.slice(0, 100));
      const my = (events ?? []).filter((e: any) => e.created_by === id);
      sportStats = {
        goals: my.filter((e) => e.event_type === 'goal').length,
        assists: my.filter((e) => e.event_type === 'assist').length,
        yellow_cards: my.filter((e) => e.event_type === 'yellow_card').length,
        red_cards: my.filter((e) => e.event_type === 'red_card').length,
      };
    } else if (slug === 'basketball' && matchIds.length > 0) {
      const { data: events } = await supabase.from('match_events').select('event_type, payload, created_by').in('match_id', matchIds.slice(0, 100));
      const my = (events ?? []).filter((e: any) => e.created_by === id);
      sportStats = {
        total_points: my.filter((e) => ['basket', 'score'].includes(e.event_type)).reduce((s, e) => s + Number((e.payload as any)?.points ?? 2), 0),
        fouls: my.filter((e) => e.event_type === 'foul').length,
      };
    } else if (['tennis', 'badminton', 'tabletennis', 'pickleball'].includes(slug) && matchIds.length > 0) {
      // Serve stats from match_participants + point stats from events
      const { data: myParts } = await supabase
        .from('match_participants')
        .select('aces, double_faults, first_serve_in, first_serve_total, break_points_won, break_points_faced')
        .eq('user_id', id)
        .in('match_id', matchIds.slice(0, 100));
      const totalAces = (myParts ?? []).reduce((s, p) => s + (p.aces ?? 0), 0);
      const totalDF = (myParts ?? []).reduce((s, p) => s + (p.double_faults ?? 0), 0);
      const fsIn = (myParts ?? []).reduce((s, p) => s + (p.first_serve_in ?? 0), 0);
      const fsTotal = (myParts ?? []).reduce((s, p) => s + (p.first_serve_total ?? 0), 0);
      const bpWon = (myParts ?? []).reduce((s, p) => s + (p.break_points_won ?? 0), 0);
      const bpFaced = (myParts ?? []).reduce((s, p) => s + (p.break_points_faced ?? 0), 0);

      // Point events
      const { data: events } = await supabase.from('match_events').select('event_type, created_by').in('match_id', matchIds.slice(0, 100));
      const pointsWon = (events ?? []).filter((e: any) => ['score', 'point'].includes(e.event_type) && e.created_by === id).length;

      sportStats = {
        total_aces: totalAces,
        total_double_faults: totalDF,
        first_serve_pct: fsTotal > 0 ? Math.round((fsIn / fsTotal) * 100) : 0,
        break_points_pct: bpFaced > 0 ? Math.round((bpWon / bpFaced) * 100) : 0,
        points_won: pointsWon,
      };
    }
  } catch {
    // Non-critical — sportStats stays null
  }

  return res.json({ profile: { ...p, cityRank, globalRank, sportStats } });
}

// PATCH /users/:id/sport-profile/:sportId
// Updates any subset of the per-sport preference columns. Only the owner
// of the profile (id === req.userId) can update. Creates the row if it
// doesn't yet exist so the first-edit flow works.
export async function updateSportProfile(req: Request, res: Response) {
  const callerId = req.userId;
  if (!callerId) return res.status(401).json({ error: 'Unauthorized' });
  const { id, sportId: rawSportId } = req.params;
  if (id !== callerId) return res.status(403).json({ error: 'Can only update your own sport profile' });
  const sportId = (await resolveSportId(rawSportId)) ?? rawSportId;

  // Whitelist the incoming patch against SPORT_PROFILE_PREFS so arbitrary
  // fields (like rating) can't be overwritten through this endpoint.
  const incoming = req.body ?? {};
  const patch: Record<string, unknown> = {};
  for (const key of SPORT_PROFILE_PREFS) {
    if (key in incoming) patch[key] = incoming[key];
  }
  if (Object.keys(patch).length === 0) {
    return res.status(400).json({ error: 'No updatable fields provided' });
  }

  // Upsert on (user_id, sport_id). Supabase's upsert needs the full target
  // row, so we look up first and choose insert vs update.
  const { data: existing } = await supabase
    .from('user_sport_profiles')
    .select('id')
    .eq('user_id', id)
    .eq('sport_id', sportId)
    .maybeSingle();

  if (existing) {
    const { error } = await supabase
      .from('user_sport_profiles')
      .update({ ...patch, updated_at: new Date().toISOString() })
      .eq('id', existing.id);
    if (error) return res.status(500).json({ error: error.message });
  } else {
    const { error } = await supabase
      .from('user_sport_profiles')
      .insert({ user_id: id, sport_id: sportId, ...patch });
    if (error) return res.status(500).json({ error: error.message });
  }

  // Return the fresh row so the client can render immediately.
  const { data: profile } = await supabase
    .from('user_sport_profiles')
    .select(SPORT_PROFILE_SELECT)
    .eq('user_id', id)
    .eq('sport_id', sportId)
    .maybeSingle();

  return res.json({ profile });
}

// ── Reviews for service accounts ────────────────────────────────────────────

export async function getReviews(req: Request, res: Response) {
  const { id } = req.params;
  try {
    const { data, error } = await supabase
      .from('user_reviews')
      .select('id, rating, comment, created_at, reviewer:users!reviewer_id(id, name, profile_picture_url)')
      .eq('reviewed_id', id)
      .order('created_at', { ascending: false })
      .limit(50);
    if (error) return res.status(500).json({ error: sanitizeError(error) });
    const ratings = (data ?? []).map((r: any) => r.rating as number);
    const avgRating = ratings.length > 0 ? Math.round((ratings.reduce((a, b) => a + b, 0) / ratings.length) * 10) / 10 : null;
    return res.json({ reviews: data ?? [], avgRating, count: ratings.length });
  } catch {
    return res.status(500).json({ error: 'Internal server error' });
  }
}

export async function submitReview(req: Request, res: Response) {
  const userId = req.userId;
  if (!userId) return res.status(401).json({ error: 'Unauthorized' });
  try {
    const { id } = req.params;
    if (id === userId) return res.status(400).json({ error: 'Cannot review yourself' });
    const { rating } = req.body || {};
    const comment = req.body?.comment ?? req.body?.text;
    if (!rating || rating < 1 || rating > 5) return res.status(400).json({ error: 'rating 1-5 required' });
    const { data, error } = await supabase
      .from('user_reviews')
      .upsert({ reviewer_id: userId, reviewed_id: id, rating, comment: comment ?? null }, { onConflict: 'reviewer_id,reviewed_id' })
      .select('*')
      .single();
    if (error) return res.status(500).json({ error: sanitizeError(error) });
    return res.json({ review: data });
  } catch {
    return res.status(500).json({ error: 'Internal server error' });
  }
}
