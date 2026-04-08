import { Router, Request, Response } from 'express';
import { supabase } from '../utils/supabase';

const router = Router();

router.get('/', async (_req: Request, res: Response) => {
  const { data, error } = await supabase
    .from('sports')
    .select('id, name, slug, emoji, color')
    .order('display_order', { ascending: true });
  if (error) return res.status(500).json({ error: error.message });
  return res.json({ sports: data || [] });
});

export default router;
