import { Request, Response } from 'express';
import { parsePagination } from '../utils/pagination';
import { supabase } from '../utils/supabase';

// GET /transactions?type=&limit=&offset=
export async function getTransactions(req: Request, res: Response) {
  const userId = req.userId!;
  const type = req.query.type as string | undefined;
  // SC-396: was hand-rolled. `parseInt('-5') || 0` is -5, so a NEGATIVE offset
  // passed straight through into .range() — the shared parser clamps it, along
  // with NaN, zero/negative limits and offset overflow.
  const { limit, offset } = parsePagination(req.query as Record<string, unknown>, {
    defaultLimit: 50,
    maxLimit: 100,
  });

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
