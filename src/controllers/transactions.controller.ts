import { Request, Response } from 'express';
import { supabase } from '../utils/supabase';

// GET /transactions?type=&limit=&offset=
export async function getTransactions(req: Request, res: Response) {
  const userId = req.userId!;
  const type = req.query.type as string | undefined;
  const limit = Math.min(parseInt(req.query.limit as string) || 50, 100);
  const offset = parseInt(req.query.offset as string) || 0;

  let query = supabase
    .from('transactions')
    .select('*', { count: 'exact' })
    .eq('user_id', userId)
    .order('created_at', { ascending: false })
    .range(offset, offset + limit - 1);

  if (type) query = query.eq('type', type);

  const { data, count, error } = await query;
  if (error) return res.status(500).json({ error: error.message });

  return res.json({ transactions: data ?? [], total: count ?? 0 });
}
