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
  // SC-335: return ONLY active sports (the canonical 11). Filtered in JS (not a
  // .neq query) so it's deploy-order safe — pre-migration the `is_active` column is
  // absent → `!== false` keeps every sport, so nothing breaks until 070 runs; post-
  // migration kabaddi/athletics (is_active=false) drop out.
  const active = (data || []).filter((s: { is_active?: boolean }) => s.is_active !== false);
  return res.json({ sports: active });
});

export default router;
