/**
 * N-R7-S140 (Step 2 B13, RW-G1-164): the admin Users list pages by offset ordered by
 * created_at only. Seeded accounts share a created_at, so Postgres could return
 * the tied rows in a different order on each page: one user came twice and one
 * never (local DB: 3989 users, 1 duplicate, 1 missing). The id is the tiebreaker.
 */
let orders: unknown[][] = [];
jest.mock('../utils/supabase', () => {
  const q: any = {};
  for (const m of ['select', 'eq', 'is', 'or', 'range', 'limit']) q[m] = jest.fn(() => q);
  q.order = jest.fn((...a: unknown[]) => { orders.push(a); return q; });
  q.then = (ok: (v: unknown) => unknown) => Promise.resolve({ data: [], error: null, count: 0 }).then(ok);
  return { supabase: { from: jest.fn(() => q) } };
});
jest.mock('axios', () => ({ __esModule: true, default: { get: jest.fn() } }));
jest.mock('../utils/tournamentAuth', () => ({ logAdminAction: jest.fn(async () => undefined) }));
// eslint-disable-next-line import/first
import { adminListUsers } from '../controllers/admin.controller';

const res = () => { const r: any = {}; r.status = jest.fn(() => r); r.json = jest.fn((b: unknown) => { r.body = b; return r; }); return r; };
beforeEach(() => { orders = []; });

test.each([[''], ['P3']])('users list (q=%p): newest sign-up first, then by id, so tied sign-up times page stably', async (q) => {
  await adminListUsers({ userId: 'admin-1', query: { q, limit: '30', offset: '30' } } as never, res());
  expect(orders.map((o) => o[0])).toEqual(['created_at', 'id']);
  expect(orders[0][1]).toEqual({ ascending: false });
  expect(orders[1][1]).toEqual({ ascending: false });
});
