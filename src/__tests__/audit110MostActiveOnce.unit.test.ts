/** Audit #110 (11 Oct 2026): "Most active this week" showed one person once per sport (QA Device A three times). */
type Result = { data?: unknown; error?: unknown; count?: number | null };
let results: Result[] = [];
let queries: string[][] = [];
jest.mock('../utils/supabase', () => {
  const make = () => {
    const log: string[] = [];
    queries.push(log);
    const q: any = {};
    for (const m of ['select', 'insert', 'update', 'upsert', 'eq', 'neq', 'is', 'in', 'gt', 'gte', 'lt', 'order', 'range', 'or', 'not', 'limit', 'ilike']) {
      q[m] = jest.fn((...a: unknown[]) => { log.push(`${m}:${JSON.stringify(a)}`); return q; });
    }
    const next = () => results.shift() ?? { data: null, error: null, count: 0 };
    q.maybeSingle = jest.fn(async () => next());
    q.single = jest.fn(async () => next());
    q.then = (ok: (v: unknown) => unknown, bad?: (e: unknown) => unknown) => Promise.resolve(next()).then(ok, bad);
    return q;
  };
  return { supabase: { from: jest.fn((t: string) => { const q = make(); queries[queries.length - 1].push(`from:${t}`); return q; }) } };
});
jest.mock('../utils/blocks', () => ({ blockedUserIds: jest.fn(async () => []), excludeIds: jest.fn((q: unknown) => q) }));
jest.mock('../utils/testContent', () => ({
  hideTestFor: jest.fn(async () => false), excludeTest: jest.fn((q: unknown) => q),
  excludeTestEmbed: jest.fn((q: unknown) => q), testUserIdSet: jest.fn(async () => new Set()),
}));
const mockDeleted = new Set<string>();
jest.mock('../utils/activeUser', () => ({
  excludeDeleted: jest.fn((q: unknown) => q), excludeDeletedEmbed: jest.fn((q: unknown) => q),
  deletedIdSet: jest.fn(async (ids: string[]) => new Set(ids.filter((i) => mockDeleted.has(i)))),
}));
// eslint-disable-next-line import/first
import { getPlayerOfWeek } from '../controllers/features.controller';

test('a person top in two sports shows once (their best); the other sport goes to its next player', async () => {
  results = [
    { data: [
      { user_id: 'a', sport_id: 'cricket', rating: 1500, wins: 9, matches_played: 10 },
      { user_id: 'a', sport_id: 'football', rating: 1400, wins: 5, matches_played: 6 },
      { user_id: 'b', sport_id: 'football', rating: 1300, wins: 2, matches_played: 4 },
    ] },
    { data: null, error: { message: 'x' } }, // matchesThisWeek → unknown, no filter
    { data: [{ id: 'a', name: 'A' }, { id: 'b', name: 'B' }] },
  ];
  const r: any = { status: jest.fn(() => r), json: jest.fn((b: unknown) => { r.body = b; return r; }) };
  await getPlayerOfWeek({ userId: 'v', params: {}, query: {}, body: {} } as never, r);
  expect(r.body.players.map((p: any) => `${p.user?.id}:${p.sport_id}`)).toEqual(['a:cricket', 'b:football']);
});
