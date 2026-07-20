import { Request, Response } from 'express';
import { supabase } from '../utils/supabase';
import { sanitizeError } from '../utils/response';
import { checkExpiredSubscriptions } from './subscriptions.controller';
import { resolveSportId } from '../utils/sportId';
import { LIMITS, firstInvalidUrl, firstDisallowedImageUrl } from '../utils/validation';
import { VALID_ACCOUNT_TYPES, isValidAccountType } from '../constants/accountTypes';
import { excludeDeleted, excludeDeletedEmbed } from '../utils/activeUser';
import { blockedUserIds, excludeIds, isBlockedBetween } from '../utils/blocks';
import { istDay } from '../utils/appTime';
import { parsePagination } from '../utils/pagination';
import { notifyUsers, notifyUser } from '../utils/notify';

// SELF-only fields — the full row for /users/me + own-profile writes. Contains
// contact + wallet + account internals; NEVER serialize this to another viewer.
// (Still never returns password_hash — that column is simply not listed.)
const PUBLIC_FIELDS =
  'id, phone, name, username, email, city_id, account_type, profile_picture_url, bio, gender, dob, show_dob, link, is_premium, premium_expires_at, coin_balance, is_available, streak_count, referral_code, trial_used, is_admin, notification_preferences, discoverability, message_privacy, tag_privacy, created_at';

// SC-246: the ONLY fields safe to serialize to a DIFFERENT viewer (getUserById).
// Deliberately EXCLUDES phone, email, coin_balance, referral_code, is_admin,
// notification_preferences, message_privacy, discoverability, tag_privacy,
// premium_expires_at, trial_used. `dob` is included but nulled below unless
// show_dob. `is_premium` is a public boolean (the expiry timestamp is not).
const PUBLIC_USER_FIELDS =
  'id, name, username, profile_picture_url, bio, link, city_id, gender, account_type, is_premium, is_available, streak_count, dob, show_dob, created_at';

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
      // SC-226: gate on the Match-updates toggle (was a direct insert bypass).
      await notifyUser({
        userId,
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
          // SC-226: gate on the Match-updates toggle (was a direct insert bypass).
          await notifyUser({
            userId,
            type: 'weekend_nudge',
            title: '\uD83C\uDFC6 Plan your weekend match!',
            body: 'Create a match and invite your friends before Sunday.',
            data: { screen: 'Home' },
          });
        }
      }
    }
  } catch (err) {
    // SC-112: best-effort match-reminder job, but log the failure (was silently swallowed).
    console.warn('[smart-notifications] failed:', err instanceof Error ? err.message : err);
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
    // SC-200: embed the city so the client gets a real city_name (the codebase's
    // established join idiom; see search/community controllers). Flattened below.
    .select(`${PUBLIC_FIELDS}, city:cities!city_id(id, name)`)
    .eq('id', userId)
    .maybeSingle();
  if (error) return res.status(500).json({ error: error.message });
  if (!data) return res.status(404).json({ error: 'User not found' });

  // SC-200: flatten the embedded city → flat `city_name` string the FE expects,
  // and drop the nested object so the response shape stays clean.
  const city_name = (data as any).city?.name ?? null;
  delete (data as any).city;

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
    // Validate the legacy column before leaking it — older rows can hold the
    // invalid 'fan' value, which we never want to surface to the client (A6-002).
    accountTypes = isValidAccountType(data.account_type) ? [data.account_type] : ['player'];
  }

  // Aggregate header stats (SC-46): total matches across all the user's sports
  // + their rank in the most-played sport. Best-effort — never fails getMe, and
  // replaces the hardcoded 0 / — the profile header used to show.
  let total_matches = 0;
  let city_rank: number | null = null;
  try {
    const { data: sp } = await supabase
      .from('user_sport_profiles')
      .select('sport_id, rating, matches_played')
      .eq('user_id', userId);
    if (sp && sp.length) {
      total_matches = sp.reduce((s, p: any) => s + (p.matches_played ?? 0), 0);
      const primary = [...sp].sort(
        (a: any, b: any) => (b.matches_played ?? 0) - (a.matches_played ?? 0),
      )[0] as any;
      if (primary && (primary.matches_played ?? 0) > 0) {
        const { count } = await supabase
          .from('user_sport_profiles')
          .select('id', { count: 'exact', head: true })
          .eq('sport_id', primary.sport_id)
          .gt('rating', primary.rating);
        city_rank = (count ?? 0) + 1;
      }
    }
  } catch {
    // best-effort
  }

  // Follower/following counts (SC-49) — getMe omitted these, so the own-profile
  // header FOLLOWERS stat always showed 0. getUserById already returns them for
  // other profiles; mirror that here. Best-effort.
  let followers_count = 0;
  let following_count = 0;
  try {
    const [f1, f2] = await Promise.all([
      supabase.from('follow_relationships').select('id', { count: 'exact', head: true }).eq('following_id', userId),
      supabase.from('follow_relationships').select('id', { count: 'exact', head: true }).eq('follower_id', userId),
    ]);
    followers_count = f1.count ?? 0;
    following_count = f2.count ?? 0;
  } catch {
    // best-effort
  }

  return res.json({
    user: {
      ...data,
      city_name,
      account_types: accountTypes,
      total_matches,
      city_rank,
      followers_count,
      following_count,
    },
  });
}

// GET /users/:id — public profile
export async function getUserById(req: Request, res: Response) {
  const { id } = req.params;
  // Guard non-UUID ids (e.g. a stray GET /users/search) so they 404 cleanly
  // instead of 500ing on the Postgres uuid cast (A11-002).
  const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
  if (!UUID_RE.test(id)) return res.status(404).json({ error: 'User not found' });
  // SC-77: a soft-deleted account 404s (never renders a "Deleted User" profile).
  const { data, error } = await excludeDeleted(supabase
    .from('users')
    // SC-246: a DIFFERENT viewer only ever gets the narrow public projection —
    // never phone/email/coin_balance/referral_code/is_admin/prefs. (getMe keeps
    // the full PUBLIC_FIELDS for the user's own data.)
    // SC-200: embed city → flat city_name (flattened into safeUser below).
    .select(`${PUBLIC_USER_FIELDS}, city:cities!city_id(id, name)`)
    .eq('id', id))
    .maybeSingle();
  if (error) return res.status(500).json({ error: error.message });
  if (!data) return res.status(404).json({ error: 'User not found' });

  // Block gate (SC-31): if a block exists in either direction between the
  // viewer and this profile's owner, the profile is invisible — return 404 so
  // the block itself isn't disclosed. Anonymous viewers (optionalAuth with no
  // token) and self-views are unaffected.
  const viewerId = req.userId;
  if (viewerId && viewerId !== id) {
    const { data: block } = await supabase
      .from('user_blocks')
      .select('id')
      .or(
        `and(blocker_id.eq.${viewerId},blocked_id.eq.${id}),and(blocker_id.eq.${id},blocked_id.eq.${viewerId})`,
      )
      .maybeSingle();
    if (block) return res.status(404).json({ error: 'User not found' });
  }

  // Respect the DOB privacy toggle (PRD 17.5): if the owner hid their DOB,
  // strip it from the public response. Viewing your own profile hits
  // /users/me instead, so we don't need a self-bypass here.
  const safeUser: any = { ...data };
  // SC-200: flatten embedded city → city_name, drop the nested object.
  safeUser.city_name = safeUser.city?.name ?? null;
  delete safeUser.city;
  if (safeUser.show_dob === false) {
    safeUser.dob = null;
  }

  // SC-221: surface the FULL account-type set (join table) so OTHER users'
  // profiles can render Coach/Umpire/Business badges. getUserById previously
  // returned only the legacy singular `account_type`, so the FE (UserProfile
  // reads `user.account_types`) showed no badges for anyone but yourself
  // (getMe already returns this). Mirrors getMe's lookup + legacy fallback.
  let accountTypes: string[] = [];
  try {
    const { data: atRows } = await supabase
      .from('user_account_types')
      .select('account_type')
      .eq('user_id', id);
    accountTypes = (atRows ?? []).map((r: { account_type: string }) => r.account_type);
  } catch {
    // fall back below
  }
  if (accountTypes.length === 0 && safeUser.account_type) {
    accountTypes = isValidAccountType(safeUser.account_type) ? [safeUser.account_type] : ['player'];
  }
  safeUser.account_types = accountTypes;

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

  // SC-325: public game-stats aggregates for a stranger's stats card — total
  // matches played + rank in their most-played sport. Same computation as getMe;
  // both are PUBLIC-by-nature (an aggregate of user_sport_profiles). This does NOT
  // re-leak anything SC-246 removed (phone/email/coin_balance/is_admin/prefs stay
  // out of PUBLIC_USER_FIELDS). Best-effort — never fails the profile.
  let total_matches = 0;
  let city_rank: number | null = null;
  try {
    const { data: sp } = await supabase
      .from('user_sport_profiles')
      .select('sport_id, rating, matches_played')
      .eq('user_id', id);
    if (sp && sp.length) {
      total_matches = sp.reduce((s, p: any) => s + (p.matches_played ?? 0), 0);
      const primary = [...sp].sort((a: any, b: any) => (b.matches_played ?? 0) - (a.matches_played ?? 0))[0] as any;
      if (primary && (primary.matches_played ?? 0) > 0) {
        const { count } = await supabase
          .from('user_sport_profiles')
          .select('id', { count: 'exact', head: true })
          .eq('sport_id', primary.sport_id)
          .gt('rating', primary.rating);
        city_rank = (count ?? 0) + 1;
      }
    }
  } catch {
    // best-effort — a stats hiccup must not fail the profile
  }
  safeUser.total_matches = total_matches;
  safeUser.city_rank = city_rank;

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
  // A16-006 · notification preference toggles (jsonb { category: boolean }).
  'notification_preferences',
  // SC-A1 · privacy/visibility (everyone | followers | nobody).
  'discoverability', 'message_privacy', 'tag_privacy',
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
  // Length caps (no cap existed before): bio + display name.
  if (typeof patch.bio === 'string' && patch.bio.length > LIMITS.bioMax) {
    return res.status(400).json({ error: `Bio must be ${LIMITS.bioMax} characters or fewer` });
  }
  if (typeof patch.name === 'string' && patch.name.length > LIMITS.teamNameMax) {
    return res.status(400).json({ error: `Name must be ${LIMITS.teamNameMax} characters or fewer` });
  }
  // SC-248: a DOB can't be in the future or imply an implausible age (>120y).
  if (patch.dob != null && patch.dob !== '') {
    const dobDate = new Date(patch.dob as string);
    if (isNaN(dobDate.getTime())) {
      return res.status(400).json({ error: 'Date of birth is not a valid date' });
    }
    const now = new Date();
    const age = (now.getTime() - dobDate.getTime()) / (365.25 * 24 * 60 * 60 * 1000);
    if (dobDate.getTime() > now.getTime()) {
      return res.status(400).json({ error: 'Date of birth can’t be in the future' });
    }
    if (age > 120) {
      return res.status(400).json({ error: 'Please enter a valid date of birth' });
    }
  }
  // SC-96: validate profile photo + link are well-formed URLs (was arbitrary text).
  // link is a legit EXTERNAL website → protocol-only; profile_picture_url is an
  // IMAGE → allowlist to our storage (SC-147; OAuth avatars on *.googleusercontent.com allowed).
  const badLink = firstInvalidUrl(patch, ['link']);
  if (badLink) return res.status(400).json({ error: `${badLink} must be a valid URL` });
  const badAvatar = firstDisallowedImageUrl(patch, ['profile_picture_url']);
  if (badAvatar) return res.status(400).json({ error: 'profile_picture_url must be an uploaded image URL', code: 'INVALID_IMAGE_URL' });

  // Username change: enforce format, 30-day cooldown, and uniqueness.
  if ('username' in patch && patch.username) {
    // SC-247: usernames must be [a-zA-Z0-9_] only (no whitespace / punctuation /
    // emoji) — a spaced username breaks @mention parsing (@([a-zA-Z0-9_]+)).
    if (typeof patch.username !== 'string' || !/^[a-zA-Z0-9_]{3,30}$/.test(patch.username)) {
      return res.status(400).json({
        error: 'Username must be 3–30 characters, using only letters, numbers, and underscores.',
        code: 'INVALID_USERNAME',
      });
    }
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

  // Rewrite the join table: snapshot → delete → insert, restoring the previous
  // set if the insert fails so the user is never left with an empty join table
  // (A6-010 — the old delete-then-insert had no rollback).
  const { data: prevRows } = await supabase
    .from('user_account_types')
    .select('account_type')
    .eq('user_id', userId);

  const { error: delErr } = await supabase
    .from('user_account_types')
    .delete()
    .eq('user_id', userId);
  if (delErr) return res.status(500).json({ error: delErr.message });

  const rows = ordered.map((t) => ({ user_id: userId, account_type: t }));
  const { error: insErr } = await supabase.from('user_account_types').insert(rows);
  if (insErr) {
    if (prevRows && prevRows.length > 0) {
      await supabase
        .from('user_account_types')
        .insert(prevRows.map((r) => ({ user_id: userId, account_type: r.account_type })));
    }
    return res.status(500).json({ error: insErr.message });
  }

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

  // Block gate (SC-31): can't follow someone you've blocked, or who has blocked
  // you. Without this, a blocked user could re-follow after the block-time
  // unfollow, defeating the block.
  const { data: block } = await supabase
    .from('user_blocks')
    .select('id')
    .or(
      `and(blocker_id.eq.${userId},blocked_id.eq.${target}),and(blocker_id.eq.${target},blocked_id.eq.${userId})`,
    )
    .maybeSingle();
  if (block) return res.status(403).json({ error: 'Cannot follow this user' });

  const { error } = await supabase
    .from('follow_relationships')
    .insert({ follower_id: userId, following_id: target });
  if (error && (error as { code?: string }).code !== '23505') {
    return res.status(500).json({ error: error.message });
  }

  // SC-205: notify the followed user of a GENUINELY NEW follow. A 23505 means the
  // follow already existed (re-follow spam) → no duplicate notification. Routes to
  // the follower's profile (user_id). Fire-and-forget — never blocks the follow.
  if (!error) {
    void (async () => {
      const { data: me } = await supabase
        .from('users').select('name, username').eq('id', userId).maybeSingle();
      const name = (me?.name || me?.username || 'Someone') as string;
      await notifyUsers(
        [target],
        {
          type: 'follow',
          title: 'New follower',
          body: `${name} started following you`,
          data: { user_id: userId, actor_id: userId },
        },
        { actorId: userId },
      );
    })().catch((err) =>
      // eslint-disable-next-line no-console
      console.error('[notify] follow failed', err),
    );

    // SC-316: follower count moved → re-evaluate the Social Butterfly badge.
    try {
      const { awardBadgesSafe } = await import('./badges.controller');
      void awardBadgesSafe(userId);
    } catch {
      // best-effort
    }
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
  // SC-77: hide soft-deleted accounts. Block edge: when a viewer is present
  // (optionalAuth), also hide anyone they've blocked either direction — so a
  // blocked user never surfaces even in a third party's follower list.
  const p = parsePagination(req.query, { defaultLimit: 50, maxLimit: 100 });
  const blocked = await blockedUserIds(req.userId);
  const { data, error } = await excludeIds(excludeDeletedEmbed(supabase
    .from('follow_relationships')
    .select('follower_id, users:follower_id!inner (id, name, profile_picture_url, bio)')
    .eq('following_id', id)
    .order('created_at', { ascending: false })
    .range(p.from, p.to), 'users'), 'follower_id', blocked);
  if (error) return res.status(500).json({ error: error.message });
  // SC-307: length-based has_more (block/deleted post-filter may shrink the page).
  return res.json({ users: (data || []).map((r: any) => r.users).filter(Boolean), has_more: (data || []).length === p.limit });
}

// GET /users/:id/following
export async function getFollowing(req: Request, res: Response) {
  const { id } = req.params;
  // SC-77: hide soft-deleted accounts. Block edge (optionalAuth viewer): hide
  // anyone the viewer has blocked either direction from a third party's list.
  const pg = parsePagination(req.query, { defaultLimit: 50, maxLimit: 100 });
  const blocked = await blockedUserIds(req.userId);
  const { data, error } = await excludeIds(excludeDeletedEmbed(supabase
    .from('follow_relationships')
    .select('following_id, users:following_id!inner (id, name, profile_picture_url, bio)')
    .eq('follower_id', id)
    .order('created_at', { ascending: false })
    .range(pg.from, pg.to), 'users'), 'following_id', blocked);
  if (error) return res.status(500).json({ error: error.message });
  // SC-307: length-based has_more.
  return res.json({ users: (data || []).map((r: any) => r.users).filter(Boolean), has_more: (data || []).length === pg.limit });
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
  if (error && (error as { code?: string }).code !== '23505') {
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
    .select('id, name, username, profile_picture_url, city_id, is_premium, is_available, streak_count, discoverability')
    .in('id', matchedIds)
    .is('deleted_at', null); // SC-77: exclude soft-deleted accounts from discovery

  const userMap = new Map<string, any>();
  for (const u of users || []) userMap.set(u.id, u);

  // SC-A1 · "who can find me" — hide 'nobody'; 'followers' only shows to my
  // own followers.
  const restrictedIds = (users || []).filter((u) => u.discoverability === 'followers').map((u) => u.id);
  const iFollow = new Set<string>();
  if (restrictedIds.length > 0) {
    const { data: fr } = await supabase
      .from('follow_relationships')
      .select('following_id')
      .eq('follower_id', userId)
      .in('following_id', restrictedIds);
    for (const f of fr || []) iFollow.add(f.following_id);
  }

  // Filter by same city if user has one, then rank by availability + rating.
  const players = filteredProfiles
    .map((p) => {
      const u = userMap.get(p.user_id);
      if (!u) return null;
      if (me.city_id && u.city_id && u.city_id !== me.city_id) return null;
      const disc = u.discoverability ?? 'everyone';
      if (u.id !== userId && (disc === 'nobody' || (disc === 'followers' && !iFollow.has(u.id)))) return null;
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
// SC-106 — a user-scoped read (heatmap / rating-history / sport-profile) must
// be invisible when its target is soft-deleted OR blocked either direction with
// the caller, exactly as getUserById gates the profile page itself. Mirrors that
// guard: excludeDeleted existence check → 404, then a pairwise block check → 404
// (isBlockedBetween is the single-query form of getUserById's inline .or()).
// Returns true (and the caller should 404) when the target must be hidden.
async function targetUserHidden(targetId: string, viewerId?: string): Promise<boolean> {
  const { data } = await excludeDeleted(
    supabase.from('users').select('id').eq('id', targetId),
  ).maybeSingle();
  if (!data) return true;
  if (viewerId && viewerId !== targetId && (await isBlockedBetween(viewerId, targetId))) return true;
  return false;
}

export async function getActivityHeatmap(req: Request, res: Response) {
  const { id } = req.params;
  // SC-106: hide the heatmap of a soft-deleted or blocked target.
  if (await targetUserHidden(id, req.userId)) {
    return res.status(404).json({ error: 'User not found' });
  }
  // 84 days ago in the same timezone as the server.
  const since = new Date();
  since.setDate(since.getDate() - 83);
  since.setHours(0, 0, 0, 0);
  const sinceIso = since.toISOString();

  // Fetch this user's match participations joined with the match row so we
  // can tell who won. Cast team_side to 'A' | 'B' for the winner check.
  const { data, error } = await supabase
    .from('match_participants')
    .select('team_side, match:matches(id, scheduled_at, status, winner_team_id, team_a_id, team_b_id, score_summary, updated_at)')
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

    // Winner detection: my side won the match. SC-285: a TEAMLESS pickup has no
    // winner_team_id (free-text sides) — its winner is score-derived and stored
    // as score_summary.winner_side (the SAME signal Z-10/completeMatch uses to
    // count the win on the profile). Use both so a real pickup WIN shows 'won',
    // not a grey 'played' that disagrees with the participation card.
    const mySideTeamId = row.team_side === 'A' ? match.team_a_id : match.team_b_id;
    const winnerSide = (match.score_summary as { winner_side?: 'A' | 'B' } | null)?.winner_side ?? null;
    const iWon =
      (match.winner_team_id && match.winner_team_id === mySideTeamId) ||
      (winnerSide != null && winnerSide === row.team_side);

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

  // Resolve the requester's state for the state-level fallback. cities has a
  // `state` text column only (no state_id) — selecting a non-existent column
  // errored the query, so this used to resolve to null and the state tier never
  // fired. We hold the state NAME here.
  let myState: string | null = null;
  if (myCityId) {
    const { data: cityRow } = await supabase
      .from('cities')
      .select('state')
      .eq('id', myCityId)
      .maybeSingle();
    myState = cityRow?.state ?? null;
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

  // SC-82: a user blocked either direction can't be surfaced as a rival.
  const blockedRival = await blockedUserIds(userId);
  const candidateIds = higher.map((h) => h.user_id).filter((uid) => uid !== id && !blockedRival.has(uid));
  if (candidateIds.length === 0) return res.json({ rival: null });

  const { data: users } = await supabase
    .from('users')
    .select('id, name, username, profile_picture_url, city_id, is_premium')
    .in('id', candidateIds)
    .is('deleted_at', null); // SC-77: a deleted account can't be surfaced as a rival
  const userMap = new Map<string, any>();
  for (const u of users || []) userMap.set(u.id, u);

  // Helper: resolve a candidate's state from their city.
  const stateCache = new Map<string, string | null>();
  const resolveState = async (cityId: string | null): Promise<string | null> => {
    if (!cityId) return null;
    if (stateCache.has(cityId)) return stateCache.get(cityId) ?? null;
    const { data: cityRow } = await supabase
      .from('cities')
      .select('state')
      .eq('id', cityId)
      .maybeSingle();
    const s = cityRow?.state ?? null;
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
        if (!myState) continue;
        const s = await resolveState(u.city_id);
        if (s !== myState) continue;
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
  // SC-106: hide the rating history of a soft-deleted or blocked target.
  if (await targetUserHidden(id, req.userId)) {
    return res.status(404).json({ error: 'User not found' });
  }
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
  // SC-106: hide the sport profile of a soft-deleted or blocked target.
  if (await targetUserHidden(id, req.userId)) {
    return res.status(404).json({ error: 'User not found' });
  }
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

    // City rank (SC-326) — count ONLY players in the SAME city who stand above the
    // target in this sport. Standing order: rating desc, then matches_played desc,
    // then a stable user_id tie-break (so the rank is deterministic, not order-of-
    // insertion). Only players with >=1 rated match are counted, and a target with
    // no city OR no rated match is Unranked (cityRank: null) — never a fake number.
    // (The previous query had NO city filter, so cityRank == globalRank — a bug.)
    const { data: userRow } = await supabase
      .from('users')
      .select('city_id')
      .eq('id', id)
      .maybeSingle();
    const cityId = userRow?.city_id ?? null;
    const mp = (p.matches_played ?? 0) as number;
    if (cityId && mp >= 1) {
      const rate = p.rating as number;
      const { count: aboveCity } = await supabase
        .from('user_sport_profiles')
        .select('user_id, users!inner(city_id)', { count: 'exact', head: true })
        .eq('sport_id', sportId)
        .eq('users.city_id', cityId)
        .gte('matches_played', 1)
        .neq('user_id', id)
        .or(
          `rating.gt.${rate},` +
          `and(rating.eq.${rate},matches_played.gt.${mp}),` +
          `and(rating.eq.${rate},matches_played.eq.${mp},user_id.lt.${id})`,
        );
      cityRank = (aboveCity ?? 0) + 1;
    } else {
      cityRank = null;
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
        // bowling_overs is stored in cricket ball-notation (e.g. 0.4 = 0 overs
        // 4 balls, NOT 0.4 of an over). Convert each innings' notation to balls
        // and sum the BALLS, so the economy = runs / real-overs (balls/6) — not
        // runs / the literal decimal (which read 0.4 as 0.4 overs → inflated).
        const oversNotationToBalls = (o: number): number => {
          const whole = Math.floor(o);
          const balls = Math.round((o - whole) * 10);
          return whole * 6 + balls;
        };
        const bowlBalls = innings.reduce((s, i) => s + oversNotationToBalls(Number(i.bowling_overs ?? 0)), 0);
        const bowlOvers = bowlBalls / 6; // real overs
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
    // SC-77: hide reviews by a soft-deleted account. Block edge (optionalAuth):
    // hide reviews authored by anyone the viewer has blocked either direction.
    const blocked = await blockedUserIds(req.userId);
    const { data, error } = await excludeIds(excludeDeletedEmbed(supabase
      .from('user_reviews')
      .select('id, rating, comment, created_at, reviewer:users!reviewer_id!inner(id, name, profile_picture_url)')
      .eq('reviewed_id', id)
      .order('created_at', { ascending: false })
      .limit(50), 'reviewer'), 'reviewer_id', blocked);
    if (error) return res.status(500).json({ error: sanitizeError(error) });
    const ratings = (data ?? []).map((r: any) => r.rating as number);
    const avgRating = ratings.length > 0 ? Math.round((ratings.reduce((a, b) => a + b, 0) / ratings.length) * 10) / 10 : null;
    return res.json({ reviews: data ?? [], avgRating, count: ratings.length });
  } catch {
    return res.status(500).json({ error: 'Internal server error' });
  }
}

// SC-324: reviews are for PROFESSIONALS, not players. Type sets drive the gate.
//   ungated (offline services, no in-app proof) → anyone may review
//   gated (in-app proof exists)                 → only someone who was in the match/tournament
//   player only                                 → no reviews at all
const REVIEW_UNGATED_TYPES = new Set([
  'coach', 'commentator', 'business', 'association', 'club', 'leagues', 'other',
]);
const REVIEW_GATED_TYPES = new Set(['umpire', 'organiser']);

/** The reviewed user's account types (multi-type; legacy singular fallback). */
async function reviewedUserTypes(reviewedId: string): Promise<string[]> {
  const { data: atRows } = await supabase
    .from('user_account_types')
    .select('account_type')
    .eq('user_id', reviewedId);
  const types = (atRows ?? []).map((r: { account_type: string }) => r.account_type);
  if (types.length > 0) return types;
  const { data: u } = await supabase
    .from('users').select('account_type').eq('id', reviewedId).maybeSingle();
  return u?.account_type ? [u.account_type] : ['player'];
}

/** SC-324 UMPIRE proof — the reviewer played in a match this user umpired. */
async function playedUnderUmpire(reviewerId: string, umpireId: string): Promise<boolean> {
  const { data } = await supabase
    .from('match_participants')
    .select('match_id, match:matches!inner(umpire_id)')
    .eq('user_id', reviewerId)
    .eq('match.umpire_id', umpireId)
    .limit(1);
  return !!(data && data.length > 0);
}

/** SC-324 ORGANISER proof — the reviewer played in a tournament this user ran
 *  (organiser set = created_by ∪ tournament_organisers, per SC-266). */
async function playedInTournamentOrganisedBy(reviewerId: string, organiserId: string): Promise<boolean> {
  const { data: tms } = await supabase
    .from('team_members').select('team_id').eq('user_id', reviewerId);
  const teamIds = (tms ?? []).map((t: { team_id: string }) => t.team_id);
  if (teamIds.length === 0) return false;
  const { data: entries } = await supabase
    .from('tournament_entries')
    .select('tournament_id')
    .in('team_id', teamIds)
    .eq('status', 'approved');
  const tourIds = Array.from(new Set((entries ?? []).map((e: { tournament_id: string }) => e.tournament_id)));
  if (tourIds.length === 0) return false;
  const { data: owned } = await supabase
    .from('tournaments').select('id').in('id', tourIds).eq('created_by', organiserId).limit(1);
  if (owned && owned.length > 0) return true;
  const { data: coOrg } = await supabase
    .from('tournament_organisers')
    .select('tournament_id').in('tournament_id', tourIds).eq('user_id', organiserId).limit(1);
  return !!(coOrg && coOrg.length > 0);
}

export async function submitReview(req: Request, res: Response) {
  const userId = req.userId;
  if (!userId) return res.status(401).json({ error: 'Unauthorized' });
  try {
    const { id } = req.params;
    if (id === userId) return res.status(400).json({ error: 'Cannot review yourself' });
    // SC-96: block gate — can't review a user you're blocked-either-direction with.
    if (await isBlockedBetween(userId, id)) {
      return res.status(403).json({ error: 'You can’t review this user.' });
    }

    // SC-324: the review GATE MATRIX, keyed on the reviewed user's account types.
    const types = await reviewedUserTypes(id);
    const hasUngated = types.some((t) => REVIEW_UNGATED_TYPES.has(t));
    const hasGated = types.some((t) => REVIEW_GATED_TYPES.has(t));
    if (hasUngated) {
      // Offline professional (coach/vendor/…) — no in-app proof to gate on; anyone
      // may review. Mixed types resolve here too: ungated wins.
    } else if (hasGated) {
      // Umpire / organiser — must have a real in-app relationship.
      let eligible = false;
      if (types.includes('umpire')) eligible = await playedUnderUmpire(userId, id);
      if (!eligible && types.includes('organiser')) {
        eligible = await playedInTournamentOrganisedBy(userId, id);
      }
      if (!eligible) {
        return res.status(403).json({
          error: 'You can only review them if you played in a match they officiated or a tournament they ran.',
          code: 'REVIEW_NOT_ELIGIBLE',
        });
      }
    } else {
      // Player only — a player's quality is their ELO / W-L / H2H, not stars.
      return res.status(403).json({
        error: 'Players are rated by their match record, not reviews.',
        code: 'REVIEW_PLAYER_NOT_REVIEWABLE',
      });
    }

    const { rating } = req.body || {};
    const comment = req.body?.comment ?? req.body?.text;
    if (!rating || rating < 1 || rating > 5) return res.status(400).json({ error: 'rating 1-5 required' });
    // Person-level one-per-pair: UNIQUE(reviewer_id, reviewed_id) + upsert = edit.
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

// DELETE /users/:id/reviews — remove the caller's OWN review of :id (SC-324).
export async function deleteReview(req: Request, res: Response) {
  const userId = req.userId;
  if (!userId) return res.status(401).json({ error: 'Unauthorized' });
  try {
    const { id } = req.params;
    const { error } = await supabase
      .from('user_reviews')
      .delete()
      .eq('reviewer_id', userId) // own row only — can't delete someone else's review
      .eq('reviewed_id', id);
    if (error) return res.status(500).json({ error: sanitizeError(error) });
    return res.json({ success: true });
  } catch {
    return res.status(500).json({ error: 'Internal server error' });
  }
}

// ── Daily check-in (SC-A1) ────────────────────────────────────────────────────
// POST /users/me/check-in — grants CHECKIN_COINS once per IST calendar day
// (idempotent via awardCoins' unique event key) and advances a check-in streak
// (distinct from the match-play streak_count).
const CHECKIN_COINS = 5;

// istDay lives in ../utils/appTime (SC-93: one IST source of truth).

export async function checkIn(req: Request, res: Response) {
  const userId = req.userId;
  if (!userId) return res.status(401).json({ error: 'Unauthorized' });
  try {
    const today = istDay();
    const { awardCoins } = await import('../utils/coins');
    const { awarded, newBalance } = await awardCoins(userId, `daily_checkin_${today}`, CHECKIN_COINS);

    const { data: u } = await supabase
      .from('users')
      .select('checkin_streak, last_checkin_date')
      .eq('id', userId)
      .maybeSingle();
    let streak = u?.checkin_streak ?? 0;

    if (awarded) {
      const yesterday = istDay(new Date(Date.now() - 86400000));
      const last = u?.last_checkin_date ?? null;
      streak = last === yesterday ? streak + 1 : 1;
      await supabase.from('users').update({ checkin_streak: streak, last_checkin_date: today }).eq('id', userId);
    }

    return res.json({
      awarded,
      already_checked_in_today: !awarded,
      reward: CHECKIN_COINS,
      coin_balance: newBalance,
      checkin_streak: streak,
    });
  } catch {
    return res.status(500).json({ error: 'Internal server error' });
  }
}
