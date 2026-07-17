import { Request, Response } from 'express';
import { supabase } from '../utils/supabase';
import { excludeDeleted, excludeDeletedEmbed } from '../utils/activeUser';
import { blockedUserIds, excludeIds } from '../utils/blocks';
import { escapeLike, orIlikeContains } from '../utils/likeSearch'; // SC-237
import { parsePagination, Pagination } from '../utils/pagination'; // SC-303

// ─── UNIFIED SEARCH ─────────────────────────────────────────────────────────
export async function search(req: Request, res: Response) {
  const { q, tab, sport_id } = req.query;
  // SC-303: real offset pagination — every branch was `.limit()` with no offset,
  // so results past the first page (players/teams/tournaments/posts easily exceed
  // it) were unreachable. `has_more` (length-based) drives the FE's onEndReached.
  const p = parsePagination(req.query as Record<string, unknown>, { defaultLimit: 20, maxLimit: 50 });

  if (!q || (q as string).trim().length === 0) {
    return res.json({ data: [], has_more: false });
  }

  const query = (q as string).trim();
  const activeTab = (tab as string) || 'players';
  const callerId = req.userId;

  switch (activeTab) {
    case 'players':
      return searchPlayers(res, query, sport_id as string, p, callerId);
    case 'teams':
      return searchTeams(res, query, sport_id as string, p);
    case 'tournaments':
      return searchTournaments(res, query, sport_id as string, p);
    case 'umpires':
      return searchUmpires(res, query, sport_id as string, p, callerId);
    case 'coaches':
      return searchByAccountType(res, query, 'coach', p, callerId);
    case 'posts':
      return searchPosts(res, query, sport_id as string, p, callerId);
    case 'businesses':
      return searchBusinesses(res, query, p, callerId);
    case 'associations':
      return searchByAccountType(res, query, 'association', p, callerId);
    case 'clubs':
      return searchByAccountType(res, query, 'club', p, callerId);
    case 'leagues':
      return searchByAccountType(res, query, 'leagues', p, callerId);
    case 'other':
      return searchByAccountType(res, query, 'other', p, callerId);
    default:
      return res.status(400).json({ error: 'Invalid tab' });
  }
}

async function searchPlayers(res: Response, q: string, sportId: string | undefined, p: Pagination, callerId?: string) {
  const blocked = await blockedUserIds(callerId); // SC-82
  // SC-238: apply the sport filter (was accepted but ignored). Filter DB-side via
  // an INNER join on user_sports (scalable — no .in()-at-scale pre-fetch, which
  // caps at 1000 rows and overflows the URL). The `!inner` join drops users who
  // don't have the sport; the .eq restricts the join to that sport.
  const sel = `
      id, name, username, profile_picture_url, is_premium, discoverability,
      city:cities!city_id(id, name),
      sports:user_sports${sportId ? '!inner' : ''}(sport_id, sport:sports(id, name, emoji))
    `;
  let base = supabase
    .from('users')
    .select(sel)
    // SC-237: injection-safe OR-of-ilike (double-quoted value → commas/parens are
    // literal, LIKE metachars escaped → literal % / _ matching).
    .or(orIlikeContains(['username', 'name'], q));
  if (sportId) base = base.eq('sports.sport_id', sportId);
  const { data, error } = await excludeIds(excludeDeleted(base), 'id', blocked) // SC-77 deleted + SC-82 blocked
    // Premium users appear first — delivers the "Boosted ranking" promise
    .order('is_premium', { ascending: false })
    .order('name', { ascending: true })
    .range(p.from, p.to);

  if (error) return res.status(500).json({ error: error.message });
  // The dynamic select() string loses supabase's row-type inference, so cast to
  // the shape applyDiscoverability expects (id + optional discoverability).
  const rows = (data || []) as unknown as Array<{ id: string; discoverability?: string }>;
  // has_more from the RAW page (a full page ⇒ maybe more); the discoverability
  // post-filter may return fewer, but more raw rows can still remain to scan.
  return res.json({ data: await applyDiscoverability(rows, callerId), has_more: rows.length === p.limit });
}

// SC-A1 — respect the "who can find me" setting on the people-directory
// surfaces (Players / Discover). 'nobody' is hidden; 'followers' shows only to
// the caller's own followers. Strips the field from the response.
async function applyDiscoverability<T extends { id: string; discoverability?: string }>(
  rows: T[],
  callerId?: string,
): Promise<Omit<T, 'discoverability'>[]> {
  const restricted = rows.filter((r) => r.discoverability === 'followers').map((r) => r.id);
  let followed = new Set<string>();
  if (callerId && restricted.length > 0) {
    const { data } = await supabase
      .from('follow_relationships')
      .select('following_id')
      .eq('follower_id', callerId)
      .in('following_id', restricted);
    followed = new Set((data || []).map((f) => f.following_id));
  }
  return rows
    .filter((r) => {
      const d = r.discoverability ?? 'everyone';
      if (r.id === callerId) return true; // always find yourself
      if (d === 'nobody') return false;
      if (d === 'followers') return followed.has(r.id);
      return true;
    })
    .map(({ discoverability, ...rest }) => rest);
}

async function searchTeams(res: Response, q: string, sportId: string | undefined, p: Pagination) {
  let query = supabase
    .from('teams')
    .select(`
      id, name, logo_url, sport_id,
      sport:sports!sport_id(id, name, emoji),
      city:cities!city_id(id, name)
    `)
    .ilike('name', `%${escapeLike(q)}%`)
    .range(p.from, p.to);

  if (sportId) query = query.eq('sport_id', sportId);
  const { data, error } = await query;
  if (error) return res.status(500).json({ error: error.message });
  return res.json({ data: data || [], has_more: (data || []).length === p.limit });
}

async function searchTournaments(res: Response, q: string, sportId: string | undefined, p: Pagination) {
  let query = supabase
    .from('tournaments')
    .select(`
      id, name, banner_url, sport_id, status, start_date, end_date,
      sport:sports!sport_id(id, name, emoji),
      city:cities!city_id(id, name)
    `)
    .ilike('name', `%${escapeLike(q)}%`)
    .order('start_date', { ascending: false })
    .range(p.from, p.to);

  if (sportId) query = query.eq('sport_id', sportId);
  const { data, error } = await query;
  if (error) return res.status(500).json({ error: error.message });
  return res.json({ data: data || [], has_more: (data || []).length === p.limit });
}

async function searchUmpires(res: Response, q: string, sportId: string | undefined, p: Pagination, callerId?: string) {
  // Only premium umpires shown
  const blocked = await blockedUserIds(callerId); // SC-82
  const { data, error } = await excludeIds(excludeDeleted(supabase // SC-77 deleted + SC-82 blocked
    .from('users')
    .select(`
      id, name, username, profile_picture_url, is_premium,
      city:cities!city_id(id, name)
    `)
    .eq('is_premium', true)
    .or(orIlikeContains(['username', 'name'], q))
    .range(p.from, p.to)), 'id', blocked);

  if (error) return res.status(500).json({ error: error.message });

  // has_more from the RAW page (the account-type post-filter may shrink it, but
  // more raw premium rows can still remain to scan on the next page).
  const hasMore = (data || []).length === p.limit;
  // Filter to only umpire/referee account types
  const userIds = (data || []).map((u) => u.id);
  if (userIds.length === 0) return res.json({ data: [], has_more: hasMore });

  const { data: accountTypes } = await supabase
    .from('user_account_types')
    .select('user_id, account_type')
    .in('user_id', userIds)
    .in('account_type', ['umpire', 'referee']);

  const umpireIds = new Set((accountTypes || []).map((a) => a.user_id));
  const filtered = (data || []).filter((u) => umpireIds.has(u.id));

  return res.json({ data: filtered, has_more: hasMore });
}

async function searchPosts(res: Response, q: string, sportId: string | undefined, p: Pagination, callerId?: string) {
  let query = supabase
    .from('community_posts')
    .select(`
      id, content, created_at, likes_count, comments_count, scheduled_at, author_id,
      author:users!author_id!inner(id, name, username, profile_picture_url),
      sport:sports!sport_id(id, name, emoji)
    `)
    .ilike('content', `%${escapeLike(q)}%`)
    .order('created_at', { ascending: false })
    .range(p.from, p.to);
  query = excludeDeletedEmbed(query, 'author'); // SC-77
  query = excludeIds(query, 'author_id', await blockedUserIds(callerId)); // SC-81

  if (sportId) query = query.eq('sport_id', sportId);
  const { data, error } = await query;
  if (error) return res.status(500).json({ error: error.message });
  // SC-218: search hit content directly — filter out not-yet-published scheduled
  // posts (visible only to their author), mirroring the feed/getPost embargo.
  const now = Date.now();
  const visible = (data || []).filter((p2: any) =>
    !p2.scheduled_at || new Date(p2.scheduled_at).getTime() <= now || p2.author_id === callerId,
  );
  return res.json({ data: visible, has_more: (data || []).length === p.limit });
}

async function searchBusinesses(res: Response, q: string, p: Pagination, callerId?: string) {
  // Businesses are Premium users with Business account type
  const blocked = await blockedUserIds(callerId); // SC-82
  const { data: users, error } = await excludeIds(excludeDeleted(supabase // SC-77 deleted + SC-82 blocked
    .from('users')
    .select(`
      id, name, username, profile_picture_url, is_premium,
      city:cities!city_id(id, name)
    `)
    .eq('is_premium', true)
    .or(orIlikeContains(['username', 'name'], q))
    .range(p.from, p.to)), 'id', blocked);

  if (error) return res.status(500).json({ error: error.message });

  const hasMore = (users || []).length === p.limit; // raw-page based (post-filter shrinks)
  const userIds = (users || []).map((u) => u.id);
  if (userIds.length === 0) return res.json({ data: [], has_more: hasMore });

  const { data: accountTypes } = await supabase
    .from('user_account_types')
    .select('user_id, account_type')
    .in('user_id', userIds)
    .eq('account_type', 'business');

  const bizIds = new Set((accountTypes || []).map((a) => a.user_id));
  const filtered = (users || []).filter((u) => bizIds.has(u.id));

  return res.json({ data: filtered, has_more: hasMore });
}

// Generic account-type search — Coaches, Associations, Leagues, Other.
// Uses the user_account_types join table (like the umpire/business paths) so a
// SECONDARY role surfaces too, instead of the legacy singular users.account_type
// column that only ever matched a user's primary type (SC-27). Search is
// intentionally NOT premium-gated — every pro is discoverable here; premium
// only gates the richer Services directory. Premium just ranks first.
async function searchByAccountType(res: Response, q: string, accountType: string, p: Pagination, callerId?: string) {
  const blocked = await blockedUserIds(callerId); // SC-82
  const { data: users, error } = await excludeIds(excludeDeleted(supabase // SC-77 deleted + SC-82 blocked
    .from('users')
    .select('id, name, username, profile_picture_url, bio, is_premium, city:cities!city_id(id, name)')
    .or(orIlikeContains(['username', 'name'], q))
    .order('is_premium', { ascending: false })
    .order('name', { ascending: true })
    .range(p.from, p.to)), 'id', blocked);
  if (error) return res.status(500).json({ error: error.message });

  const hasMore = (users || []).length === p.limit; // raw-page based (post-filter shrinks)
  const userIds = (users || []).map((u) => u.id);
  if (userIds.length === 0) return res.json({ data: [], has_more: hasMore });

  const { data: accountTypes } = await supabase
    .from('user_account_types')
    .select('user_id')
    .in('user_id', userIds)
    .eq('account_type', accountType);

  const matchIds = new Set((accountTypes || []).map((a) => a.user_id));
  return res.json({ data: (users || []).filter((u) => matchIds.has(u.id)), has_more: hasMore });
}

// (searchClubs removed — clubs now route through searchByAccountType('club'),
//  the same user_account_types join path as associations/coaches. The old
//  teams-table proxy returned team-shaped rows, which broke the FE (club result
//  → UserProfile got a team id → blank profile).
