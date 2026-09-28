/**
 * Phase 4 · K4-62 (ff18c89, Phase 3 B02-F3): a repeated ?sport_id= reaches the
 * leaderboard as an array, and resolveSportId called .toLowerCase() on it — a
 * 500. The existing B02 test mocks resolveSportId (an array simply resolves to
 * nothing there → "Unknown sport_id" 400), so it can't see the guard go. This
 * one runs the real resolveSportId.
 */
jest.mock('../utils/supabase', () => {
  const chain: any = {};
  for (const m of ['from', 'select', 'eq', 'is', 'in', 'not', 'gt', 'order', 'range', 'limit']) chain[m] = jest.fn(() => chain);
  chain.maybeSingle = jest.fn(async () => ({ data: null, error: null }));
  chain.then = (ok: (v: unknown) => unknown) => ok({ data: [], error: null, count: 0 });
  return { supabase: chain };
});
jest.mock('../utils/testContent', () => ({
  hideTestFor: jest.fn(async () => false),
  testUserIdSet: jest.fn(async () => new Set()),
}));

// eslint-disable-next-line import/first
import { getLeaderboard } from '../controllers/leaderboard.controller';

const res = () => {
  const r: any = { statusCode: 200, body: null, headers: {} };
  r.status = jest.fn((c: number) => { r.statusCode = c; return r; });
  r.json = jest.fn((b: unknown) => { r.body = b; return r; });
  r.set = jest.fn(() => r);
  r.setHeader = jest.fn(() => r);
  return r;
};

it('K4-62 (ff18c89): a repeated sport_id is a 400 that says so, not a 500', async () => {
  const r = res();
  await getLeaderboard({ userId: 'u1', query: { sport_id: ['cricket', 'football'] }, headers: {} } as never, r);
  expect(r.statusCode).toBe(400);
  expect(r.body).toEqual({ error: 'sport_id must be given once' });
});
