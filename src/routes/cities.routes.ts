import { Router, Request, Response } from 'express';
import { supabase } from '../utils/supabase';

const router = Router();

router.get('/', async (_req: Request, res: Response) => {
  const { data, error } = await supabase
    .from('cities')
    .select('id, name, state')
    .order('name', { ascending: true });
  if (error) return res.status(500).json({ error: error.message });
  return res.json({ cities: data || [] });
});

router.get('/search', async (req: Request, res: Response) => {
  const q = (req.query.q as string) || '';
  if (!q) return res.json({ cities: [] });
  const { data, error } = await supabase
    .from('cities')
    .select('id, name, state')
    .ilike('name', `%${q}%`)
    .order('name', { ascending: true })
    .limit(25);
  if (error) return res.status(500).json({ error: error.message });
  return res.json({ cities: data || [] });
});

export default router;
