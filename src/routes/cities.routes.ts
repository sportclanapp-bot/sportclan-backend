import { Router, Request, Response } from 'express';
import { supabase } from '../utils/supabase';
import { escapeLike } from '../utils/likeSearch';

// Phase 3 B01-F15: `q=%` / `q=_` matched every city, and a query error went
// out as the database's own message.
const qOf = (req: Request) => (typeof req.query.q === 'string' ? req.query.q.trim() : '');
const LOAD_FAILED = { error: 'Could not load cities. Try again.' };

const router = Router();

// GET /cities          → all cities (alphabetical)
// GET /cities?q=mum    → ilike search, capped at 25 results
router.get('/', async (req: Request, res: Response) => {
  const q = qOf(req);
  let query = supabase.from('cities').select('id, name, state').order('name', { ascending: true });
  if (q) query = query.ilike('name', `%${escapeLike(q)}%`).limit(25);
  const { data, error } = await query;
  if (error) return res.status(500).json(LOAD_FAILED);
  return res.json({ cities: data || [] });
});

// Legacy alias — Part 2 frontend may still hit /cities/search.
router.get('/search', async (req: Request, res: Response) => {
  const q = qOf(req);
  if (!q) return res.json({ cities: [] });
  const { data, error } = await supabase
    .from('cities')
    .select('id, name, state')
    .ilike('name', `%${escapeLike(q)}%`)
    .order('name', { ascending: true })
    .limit(25);
  if (error) return res.status(500).json(LOAD_FAILED);
  return res.json({ cities: data || [] });
});

export default router;
