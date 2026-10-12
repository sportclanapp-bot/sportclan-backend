import { hideTestFor, excludeTestEmbed } from '../utils/testContent';
import { Router, Request, Response } from 'express';
import { supabase } from '../utils/supabase';
import { VALID_ACCOUNT_TYPES } from '../constants/accountTypes';
import { parsePagination, pageMeta } from '../utils/pagination';
import { authenticateToken } from '../middleware/auth.middleware';
import { blockedUserIds, excludeIds } from '../utils/blocks';
import { queryText } from '../utils/validation';
import { sortSports } from '../constants/sportOrder';
import { selectAll } from '../utils/selectAll';
import { OFFICIAL_CATEGORIES, OFFICIAL_TYPES, isOfficialCategory, officialCategoriesOf, type OfficialCategory } from '../utils/officialCategories';

const router = Router();

// Discoverable service types = every canonical account type except 'player'
// (the default). Previously this hard-coded {umpire, referee, coach, trainer,
// business, commentator}, which (a) excluded org types organiser/
// association/club/leagues/other — A6-008,
// and (b) included non-canonical 'referee'/'trainer' that match no rows — A6-009.
const SERVICE_TYPES = new Set(VALID_ACCOUNT_TYPES.filter((t) => t !== 'player'));

const PROVIDER_EMBED = 'user_id, account_type, users:user_id!inner(id, name, username, profile_picture_url, bio, city_id, city:cities!city_id(name), sports:user_sports(sport:sports(slug, name)))';
const cityOf = (raw: unknown): string | null => (typeof raw === 'string' && /^[0-9a-f-]{36}$/i.test(raw) ? raw : null);
const toProvider = ({ city, sports, ...u }: any) => ({
  ...u,
  city_name: city?.name ?? null,
  // In the one sport order (constants/sportOrder), not the join's.
  sports: sortSports((sports ?? []).map((s: any) => ({ slug: s.sport?.slug as string | undefined })).filter((s: { slug?: string }) => !!s.slug)).map((s) => s.slug),
});

/**
 * Profile & Settings tidy-up · every official (account type umpire or official)
 * the viewer may see, once each, with the Services cards they belong in — the
 * same filters as the type lists (not deleted, not blocked, no test accounts for a
 * real viewer, the city when one is chosen). Sorted as the type lists are.
 */
async function officialsFor(viewerId: string | undefined, cityId: string | null) {
  const blocked = await blockedUserIds(viewerId);
  const hide = await hideTestFor(viewerId);
  const rows = await selectAll<any>((from, to) => {
    let q = supabase.from('user_account_types').select(PROVIDER_EMBED)
      .in('account_type', [...OFFICIAL_TYPES]).is('users.deleted_at', null)
      .order('user_id', { ascending: true }).order('account_type', { ascending: true }).range(from, to);
    q = excludeIds(q, 'user_id', blocked);
    if (hide) q = excludeTestEmbed(q, 'users');
    if (cityId) q = q.eq('users.city_id', cityId);
    return q;
  });
  const byUser = new Map<string, { user: any; types: string[] }>();
  for (const r of rows) {
    if (!r.users) continue;
    const e = byUser.get(r.user_id) ?? { user: r.users, types: [] };
    e.types.push(r.account_type);
    byUser.set(r.user_id, e);
  }
  return [...byUser.values()].map(({ user, types }) => {
    const p = toProvider(user);
    return { provider: p, categories: officialCategoriesOf(p.sports, types) };
  });
}

// GET /services?type=umpire|coach|business[&limit=&offset=]
//
// Returns every user that holds the requested account_type.
//
// SC-434: this used to return Premium users only — a coach who had not paid was
// invisible in the directory people use to FIND a coach. With no tiers left,
// "can this person be found" is no longer something anyone buys.
//
// Paginated (SC-28): previously this had no limit/order and relied on Supabase's
// implicit ~1000-row cap, filtering premium in JS afterwards — so at scale
// providers were silently truncated and a newly-added one could never appear.
// Now the premium filter is pushed into the query via an inner join (so `count`
// is the true premium-only total) with a deterministic order + range.
// SC-393: this was the ONLY list endpoint in the app that answered without a
// token — /tournaments, /venues, /messages/chats and /community/posts all 401.
// The payload was public-profile fields only, so nothing leaked, but the
// inconsistency meant one of the two behaviours was unintentional. Dipak's call:
// consistency wins. Safe to gate — every caller (ServicesHub / ServiceList /
// VenuesList) lives inside MainStack, which only mounts when authenticated.
router.get('/', authenticateToken, async (req: Request, res: Response) => {
  // Profile & Settings tidy-up: ?category=umpires|referees|arbiters — the officials
  // by the word their sports use (utils/officialCategories).
  const category = (queryText(req.query.category) ?? '').trim().toLowerCase();
  if (category) {
    if (!isOfficialCategory(category)) return res.status(400).json({ error: `category must be one of ${OFFICIAL_CATEGORIES.join(', ')}` });
    const p = parsePagination(req.query as Record<string, unknown>, { defaultLimit: 20, maxLimit: 50 });
    try {
      const all = (await officialsFor(req.userId, cityOf(req.query.city_id))).filter((o) => o.categories.has(category as OfficialCategory));
      return res.json({ providers: all.slice(p.from, p.to + 1).map((o) => o.provider), ...pageMeta(all.length, p) });
    } catch (e: any) {
      return res.status(500).json({ error: e?.message ?? 'Could not load the list' });
    }
  }
  // Phase 3 B10-F2: `?type=a&type=b` arrived as an array and `.trim()` 500'd.
  const type = (queryText(req.query.type) ?? '').trim().toLowerCase();
  if (!SERVICE_TYPES.has(type as never)) {
    return res.status(400).json({
      error: `type must be one of ${[...SERVICE_TYPES].join(', ')}`,
    });
  }

  const p = parsePagination(req.query as Record<string, unknown>, { defaultLimit: 20, maxLimit: 50 });

  // F-63 / D7 — this directory was the one people-listing endpoint with NEITHER
  // filter on it. Search, the feed, kudos, rivals and the follower lists all
  // exclude blocked and soft-deleted users; /services excluded neither, so a
  // person you had blocked sat in your umpire list behind a Contact button, and
  // a deleted account stayed listed as a coach under the name "Deleted User".
  //
  // Both go into the QUERY rather than a post-filter, so `count` stays the true
  // total: filtering the page in JS afterwards is how a directory ends up
  // reporting "24 coaches" and rendering 22 (the SC-28 class).
  const blocked = await blockedUserIds(req.userId);
  // B16 (V089): a row says where the provider is and which sports — and the
  // list can be narrowed to one city (?city_id=).
  const cityId = cityOf(req.query.city_id);
  let q = supabase
    .from('user_account_types')
    .select(PROVIDER_EMBED, { count: 'exact' })
    .eq('account_type', type)
    // SC-77: `!inner` above means this drops the PROVIDER row, not just the name.
    .is('users.deleted_at', null)
    // SC-434: this used to be `.eq('users.is_premium', true)` — a coach or umpire
    // who had not paid did not appear in the directory at all. Every provider is
    // listed now.
    .order('user_id', { ascending: true })
    .range(p.from, p.to);
  // Either direction: they blocked you, or you blocked them (SC-81/82).
  q = excludeIds(q, 'user_id', blocked);
  // B03 (V090/V245, D3): seeded "Seed test account #…" providers are hidden from
  // real viewers — in the query, so `count` stays the true total.
  if (await hideTestFor(req.userId)) q = excludeTestEmbed(q, 'users');
  if (cityId) q = q.eq('users.city_id', cityId);
  const { data: rows, error, count } = await q;
  if (error) return res.status(500).json({ error: error.message });

  const providers = (rows || []).map((r: any) => r.users).filter(Boolean).map(toProvider);
  return res.json({ providers, ...pageMeta(count, p) });
});

// GET /services/counts — B16 (V079, D20): how many providers each category
// has, with the SAME filters as the list (not deleted, not blocked either way,
// no test accounts for a real viewer), so a count never promises a row the list
// won't show.
// Profile & Settings tidy-up: ?city_id= counts that city only (the hub's city
// chip), so a card's number is what its list shows; and `categories` holds the
// officials' cards (umpires / referees / arbiters).
router.get('/counts', authenticateToken, async (req: Request, res: Response) => {
  const blocked = await blockedUserIds(req.userId);
  const hide = await hideTestFor(req.userId);
  const cityId = cityOf(req.query.city_id);
  const types = [...SERVICE_TYPES];
  const results = await Promise.all(types.map(async (type) => {
    let q = supabase
      .from('user_account_types')
      .select('user_id, users:user_id!inner(id, city_id)', { count: 'exact', head: true })
      .eq('account_type', type)
      .is('users.deleted_at', null);
    q = excludeIds(q, 'user_id', blocked);
    if (hide) q = excludeTestEmbed(q, 'users');
    if (cityId) q = q.eq('users.city_id', cityId);
    const { count, error } = await q;
    return [type, error ? null : (count ?? 0)] as const;
  }));
  let categories: Record<OfficialCategory, number> | null = null;
  try {
    const officials = await officialsFor(req.userId, cityId);
    categories = Object.fromEntries(OFFICIAL_CATEGORIES.map((c) => [c, officials.filter((o) => o.categories.has(c)).length])) as Record<OfficialCategory, number>;
  } catch { /* the officials' cards then show no number */ }
  return res.json({ counts: Object.fromEntries(results), categories });
});

export default router;
