import { hideTestFor, excludeTestEmbed } from '../utils/testContent';
import { Router, Request, Response } from 'express';
import { supabase } from '../utils/supabase';
import { VALID_ACCOUNT_TYPES } from '../constants/accountTypes';
import { parsePagination, pageMeta } from '../utils/pagination';
import { authenticateToken } from '../middleware/auth.middleware';
import { blockedUserIds, excludeIds } from '../utils/blocks';
import { queryText } from '../utils/validation';
import { sortSports } from '../constants/sportOrder';

const router = Router();

// Discoverable service types = every canonical account type except 'player'
// (the default). Previously this hard-coded {umpire, referee, coach, trainer,
// business, commentator}, which (a) excluded org types organiser/
// association/club/leagues/other — A6-008,
// and (b) included non-canonical 'referee'/'trainer' that match no rows — A6-009.
const SERVICE_TYPES = new Set(VALID_ACCOUNT_TYPES.filter((t) => t !== 'player'));

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
  const cityId = typeof req.query.city_id === 'string' && /^[0-9a-f-]{36}$/i.test(req.query.city_id) ? req.query.city_id : null;
  let q = supabase
    .from('user_account_types')
    .select(
      'user_id, users:user_id!inner(id, name, username, profile_picture_url, bio, city_id, city:cities!city_id(name), sports:user_sports(sport:sports(slug, name)))',
      { count: 'exact' },
    )
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

  const providers = (rows || []).map((r: any) => r.users).filter(Boolean).map(({ city, sports, ...u }: any) => ({
    ...u,
    city_name: city?.name ?? null,
    // In the one sport order (constants/sportOrder), not the join's.
    sports: sortSports((sports ?? []).map((s: any) => ({ slug: s.sport?.slug as string | undefined })).filter((s: { slug?: string }) => !!s.slug)).map((s) => s.slug),
  }));
  return res.json({ providers, ...pageMeta(count, p) });
});

// GET /services/counts — B16 (V079, D20): how many providers each category
// has, with the SAME filters as the list (not deleted, not blocked either way,
// no test accounts for a real viewer), so a count never promises a row the list
// won't show.
router.get('/counts', authenticateToken, async (req: Request, res: Response) => {
  const blocked = await blockedUserIds(req.userId);
  const hide = await hideTestFor(req.userId);
  const types = [...SERVICE_TYPES];
  const results = await Promise.all(types.map(async (type) => {
    let q = supabase
      .from('user_account_types')
      .select('user_id, users:user_id!inner(id)', { count: 'exact', head: true })
      .eq('account_type', type)
      .is('users.deleted_at', null);
    q = excludeIds(q, 'user_id', blocked);
    if (hide) q = excludeTestEmbed(q, 'users');
    const { count, error } = await q;
    return [type, error ? null : (count ?? 0)] as const;
  }));
  return res.json({ counts: Object.fromEntries(results) });
});

export default router;
