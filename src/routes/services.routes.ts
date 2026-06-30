import { Router, Request, Response } from 'express';
import { supabase } from '../utils/supabase';
import { VALID_ACCOUNT_TYPES } from '../constants/accountTypes';

const router = Router();

// Discoverable service types = every canonical account type except 'player'
// (the default). Previously this hard-coded {umpire, referee, coach, trainer,
// business, commentator}, which (a) excluded paying org types organiser/
// association/club/leagues/other that carry needsPremiumForVisibility — A6-008,
// and (b) included non-canonical 'referee'/'trainer' that match no rows — A6-009.
const SERVICE_TYPES = new Set(VALID_ACCOUNT_TYPES.filter((t) => t !== 'player'));

// GET /services?type=umpire|coach|business
//
// Returns users that hold the requested account_type. Per design Change #5,
// service-listed providers must be Premium — non-premium users with these
// roles still exist (they can play matches) but don't surface in Services.
router.get('/', async (req: Request, res: Response) => {
  const type = ((req.query.type as string) || '').trim().toLowerCase();
  if (!SERVICE_TYPES.has(type as never)) {
    return res.status(400).json({
      error: `type must be one of ${[...SERVICE_TYPES].join(', ')}`,
    });
  }

  // Fetch user_ids that hold this account type, then load the user rows.
  const { data: rows, error } = await supabase
    .from('user_account_types')
    .select('user_id, users:user_id (id, name, username, profile_picture_url, bio, city_id, is_premium)')
    .ilike('account_type', type);
  if (error) return res.status(500).json({ error: error.message });

  const providers = (rows || [])
    .map((r: any) => r.users)
    .filter((u: any) => u && u.is_premium === true);

  return res.json({ providers });
});

export default router;
