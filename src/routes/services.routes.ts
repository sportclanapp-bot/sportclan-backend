import { Router, Request, Response } from 'express';
import { supabase } from '../utils/supabase';
import { VALID_ACCOUNT_TYPES } from '../constants/accountTypes';
import { parsePagination, pageMeta } from '../utils/pagination';

const router = Router();

// Discoverable service types = every canonical account type except 'player'
// (the default). Previously this hard-coded {umpire, referee, coach, trainer,
// business, commentator}, which (a) excluded paying org types organiser/
// association/club/leagues/other that carry needsPremiumForVisibility — A6-008,
// and (b) included non-canonical 'referee'/'trainer' that match no rows — A6-009.
const SERVICE_TYPES = new Set(VALID_ACCOUNT_TYPES.filter((t) => t !== 'player'));

// GET /services?type=umpire|coach|business[&limit=&offset=]
//
// Returns Premium users that hold the requested account_type. Per design
// Change #5, service-listed providers must be Premium — non-premium users with
// these roles still exist (they can play matches) but don't surface in Services.
//
// Paginated (SC-28): previously this had no limit/order and relied on Supabase's
// implicit ~1000-row cap, filtering premium in JS afterwards — so at scale
// providers were silently truncated and a newly-added one could never appear.
// Now the premium filter is pushed into the query via an inner join (so `count`
// is the true premium-only total) with a deterministic order + range.
router.get('/', async (req: Request, res: Response) => {
  const type = ((req.query.type as string) || '').trim().toLowerCase();
  if (!SERVICE_TYPES.has(type as never)) {
    return res.status(400).json({
      error: `type must be one of ${[...SERVICE_TYPES].join(', ')}`,
    });
  }

  const p = parsePagination(req.query as Record<string, unknown>, { defaultLimit: 20, maxLimit: 50 });

  const { data: rows, error, count } = await supabase
    .from('user_account_types')
    .select(
      'user_id, users:user_id!inner(id, name, username, profile_picture_url, bio, city_id, is_premium)',
      { count: 'exact' },
    )
    .eq('account_type', type)
    .eq('users.is_premium', true)
    .order('user_id', { ascending: true })
    .range(p.from, p.to);
  if (error) return res.status(500).json({ error: error.message });

  const providers = (rows || []).map((r: any) => r.users).filter(Boolean);
  return res.json({ providers, ...pageMeta(count, p) });
});

export default router;
