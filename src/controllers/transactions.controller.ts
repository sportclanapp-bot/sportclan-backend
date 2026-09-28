import { Request, Response } from 'express';
import { parsePagination, isRangeError } from '../utils/pagination';
import { supabase } from '../utils/supabase';
import { queryText } from '../utils/validation';

/**
 * Phase 3 B10-F9: the Gifts filter asks for `gift_sent,gift_received`, since a
 * received gift is a gift too. The app sends that as `types=` and keeps
 * `type=gift_sent` beside it, so a server from before this change still answers
 * with sent gifts; `types` wins when present. Either may be comma-separated.
 * Only word characters, so junk can't reach the filter.
 */
export function parseTxnTypes(raw: unknown): string[] {
  const s = queryText(raw);
  if (!s) return [];
  return s.split(',').map((t) => t.trim()).filter((t) => /^[a-z_]{1,40}$/.test(t)).slice(0, 10);
}

// GET /transactions?type=&limit=&offset=
export async function getTransactions(req: Request, res: Response) {
  const userId = req.userId!;
  const rawTypes = queryText(req.query.types) ? req.query.types : req.query.type;
  const types = parseTxnTypes(rawTypes);
  // A type was asked for but none is a real type name: nothing matches (as
  // before), rather than falling through to every transaction.
  if (queryText(rawTypes) && types.length === 0) return res.json({ transactions: [], total: 0 });
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

  if (types.length === 1) query = query.eq('type', types[0]);
  else if (types.length > 1) query = query.in('type', types);

  const { data, count, error } = await query;
  // Phase 3 B10-F2: an offset past the end is an empty last page, not a 500.
  if (isRangeError(error)) return res.json({ transactions: [], total: count ?? 0 });
  if (error) return res.status(500).json({ error: error.message });

  return res.json({ transactions: data ?? [], total: count ?? 0 });
}
