import { Router, Request, Response } from 'express';
import { supabase } from '../utils/supabase';

const router = Router();

// GET /cities          → all cities (alphabetical)
// GET /cities?q=mum    → ilike search, capped at 25 results
router.get('/', async (req: Request, res: Response) => {
  const q = ((req.query.q as string) || '').trim();
  let query = supabase.from('cities').select('id, name, state').order('name', { ascending: true });
  if (q) query = query.ilike('name', `%${q}%`).limit(25);
  const { data, error } = await query;
  if (error) return res.status(500).json({ error: error.message });
  return res.json({ cities: data || [] });
});

// Legacy alias — Part 2 frontend may still hit /cities/search.
router.get('/search', async (req: Request, res: Response) => {
  const q = ((req.query.q as string) || '').trim();
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
