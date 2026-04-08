import { Router, Request, Response } from 'express';
import { supabase } from '../utils/supabase';

const router = Router();

// GET /services?type=umpire|coach|business
//
// Returns users that hold the requested account_type. Per design Change #5,
// service-listed providers must be Premium — non-premium users with these
// roles still exist (they can play matches) but don't surface in Services.
router.get('/', async (req: Request, res: Response) => {
  const type = ((req.query.type as string) || '').trim().toLowerCase();
  const allowed = new Set([
    'umpire', 'referee', 'coach', 'trainer', 'business', 'commentator',
  ]);
  if (!allowed.has(type)) {
    return res.status(400).json({
      error: 'type must be one of umpire, referee, coach, trainer, business, commentator',
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
