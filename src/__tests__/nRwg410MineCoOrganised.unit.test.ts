/**
 * N-RWG4-10 (launch test plan, Round 3): the tournaments list's 'Mine' showed only what you created,
 * never what you co-organise. It asks for both now (and an event of one you co-organise).
 */
type Q = string[];
const mockLog: Q[] = [];
let mockOrgs: unknown[] = [];
jest.mock('../utils/supabase', () => {
  const start = (t: string) => {
    const q: string[] = [`from:${t}`]; mockLog.push(q);
    const chain: any = {};
    for (const m of ['select', 'eq', 'neq', 'in', 'is', 'not', 'or', 'order', 'range', 'limit', 'gte', 'lte', 'ilike', 'maybeSingle']) chain[m] = jest.fn((...a: unknown[]) => { q.push(`${m}:${JSON.stringify(a)}`); return chain; });
    chain.then = (ok: (v: unknown) => unknown) => Promise.resolve(ok({ data: t === 'tournament_organisers' ? mockOrgs : [], error: null, count: 0 }));
    return chain;
  };
  return { supabase: { from: jest.fn(start), rpc: jest.fn(async () => ({ data: [], error: null })) } };
});
// eslint-disable-next-line import/first
import { listTournaments } from '../controllers/tournaments.controller';

const U = '11111111-1111-4111-8111-111111111111';
const T2 = '22222222-2222-4222-8222-222222222222';
const call = async () => {
  const r: any = { statusCode: 200, body: null, setHeader: jest.fn() };
  r.status = (c: number) => { r.statusCode = c; return r; };
  r.json = (b: unknown) => { r.body = b; return r; };
  await listTournaments({ userId: U, query: { mine: '1', limit: '20' }, headers: { 'x-client-features': 'events' }, get: () => 'events', header: () => 'events' } as never, r);
  return r;
};
test('Mine asks for created OR co-organised (and their events)', async () => {
  mockOrgs = [{ tournament_id: T2 }];
  await call();
  const ors = mockLog.filter((q) => q[0] === 'from:tournaments').flatMap((q) => q.filter((c) => c.startsWith('or:')));
  expect(ors).toContain(`or:["created_by.eq.${U},id.in.(${T2}),parent_id.in.(${T2})"]`);
});
test('no co-organised tournaments: created only, as before', async () => {
  mockLog.length = 0; mockOrgs = [];
  await call();
  const tq = mockLog.filter((q) => q[0] === 'from:tournaments');
  expect(tq.some((q) => q.includes(`eq:["created_by","${U}"]`))).toBe(true);
});
