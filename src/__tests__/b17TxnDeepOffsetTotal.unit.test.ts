/**
 * Step 2 · Batch 17 · RW-G4-069 (bug N-R7-S1): GET /transactions?offset=99999999
 * answered {transactions: [], total: 0}. PostgREST refuses a range past the end
 * with 416 and supabase-js then gives NO count (count: null, seen on the local
 * stack: Content-Range "* /11468" but count null), so the old `count ?? 0` said
 * the person had no transactions at all. The total is now counted on its own.
 */
type Q = string[];
let mockLog: Q[] = [];
let mockNext: (q: Q) => { data?: unknown; error?: unknown; count?: number | null } = () => ({ data: null, error: null });
jest.mock('../utils/supabase', () => {
  const start = (t: string) => {
    const q: string[] = [`from:${t}`];
    mockLog.push(q);
    const chain: any = {};
    for (const m of ['select', 'in', 'eq', 'order', 'range']) chain[m] = jest.fn((...a: unknown[]) => { q.push(`${m}:${JSON.stringify(a)}`); return chain; });
    chain.then = (ok: (v: unknown) => unknown) => Promise.resolve(ok({ data: null, error: null, ...mockNext(q) }));
    return chain;
  };
  return { supabase: { from: jest.fn(start) } };
});
// eslint-disable-next-line import/first
import { getTransactions } from '../controllers/transactions.controller';

const ME = '11111111-1111-4111-8111-111111111111';
const RANGE = { code: 'PGRST103', message: 'Requested range not satisfiable' };
const call = async (query: object) => {
  const r: any = { statusCode: 200, body: null };
  r.status = jest.fn((c: number) => { r.statusCode = c; return r; });
  r.json = jest.fn((b: unknown) => { r.body = b; return r; });
  await getTransactions({ userId: ME, query } as any, r);
  return r;
};
beforeEach(() => { mockLog = []; });

test('an offset past the end is an empty page that still tells the real total', async () => {
  mockNext = (q) => (q.some((s) => s.startsWith('range:')) ? { data: null, error: RANGE, count: null } : { data: null, error: null, count: 11468 });
  const r = await call({ offset: '99999999' });
  expect(r.statusCode).toBe(200);
  expect(r.body).toEqual({ transactions: [], total: 11468 });
  // the recount is the caller's own rows, head-only
  const recount = mockLog.find((q) => !q.some((s) => s.startsWith('range:')))!;
  expect(recount.join(' ')).toContain(`eq:${JSON.stringify(['user_id', ME])}`);
  expect(recount.join(' ')).toContain('"head":true');
});

test('the recount keeps the type filter', async () => {
  mockNext = (q) => (q.some((s) => s.startsWith('range:')) ? { data: null, error: RANGE, count: null } : { data: null, error: null, count: 3 });
  const r = await call({ offset: '5000', types: 'gift_sent,gift_received' });
  expect(r.body).toEqual({ transactions: [], total: 3 });
  const recount = mockLog.find((q) => !q.some((s) => s.startsWith('range:')))!;
  expect(recount.join(' ')).toContain(`in:${JSON.stringify(['type', ['gift_sent', 'gift_received']])}`);
});
