import { Router, Request, Response } from 'express';
import { supabase } from '../utils/supabase';

const router = Router();

router.get('/', async (_req: Request, res: Response) => {
  // select('*') (not an explicit column list) so the sports.is_active flag is
  // exposed once the deactivation migration adds it — and stays undefined-safe
  // before then (a missing column is simply omitted, never an error). The FE
  // filters creation pickers to is_active !== false while still resolving names
  // for existing content on deactivated sports.
  const { data, error } = await supabase
    .from('sports')
    .select('*')
    .order('display_order', { ascending: true });
  if (error) return res.status(500).json({ error: error.message });
  return res.json({ sports: data || [] });
});

export default router;
