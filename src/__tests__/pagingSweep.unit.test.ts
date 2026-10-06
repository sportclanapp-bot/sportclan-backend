/**
 * Oct 2026 sweep · lists read once and treated as complete.
 *
 * The mock database behaves like PostgREST: a query with no range answers at
 * most 1000 rows (its silent cap), `.limit(n)` / `.range(a, b)` cut the rows,
 * and a head count answers the full count. Each test feeds more rows than one
 * read can return and checks the answer covers them all.
 */
type Q = string[];
type Ans = { rows?: unknown[]; one?: unknown; error?: unknown };
let mockLog: Q[] = [];
let mockDb: (q: Q) => Ans = () => ({ rows: [] });
jest.mock('../utils/supabase', () => {
  const arg = (q: Q, m: string) => { const c = q.find((x) => x.startsWith(`${m}:`)); return c ? JSON.parse(c.slice(m.length + 1)) : null; };
  const start = (head: string) => {
    const q: string[] = [head];
    mockLog.push(q);
    const chain: any = {};
    for (const m of ['select', 'in', 'not', 'eq', 'neq', 'is', 'limit', 'update', 'delete', 'order', 'or', 'ilike', 'range', 'gte', 'gt', 'lt', 'lte', 'upsert', 'insert', 'filter', 'match', 'contains', 'overlaps']) {
      chain[m] = jest.fn((...a: unknown[]) => { q.push(`${m}:${JSON.stringify(a)}`); return chain; });
    }
    const answer = () => {
      const a = mockDb(q);
      if (a.error) return { data: null, error: a.error };
      if (a.one !== undefined) return { data: a.one, error: null };
      const all = a.rows ?? [];
      const sel = arg(q, 'select');
      if (sel && sel[1]?.head) return { data: null, error: null, count: all.length };
      const r = arg(q, 'range');
      const lim = arg(q, 'limit');
      let rows = r ? all.slice(r[0], r[1] + 1) : all.slice(0, 1000);
      if (lim) rows = rows.slice(0, lim[0]);
      return { data: rows, error: null, count: sel && sel[1]?.count ? all.length : null };
    };
    chain.single = jest.fn(async () => { q.push('single'); const x = answer(); return { ...x, data: Array.isArray(x.data) ? x.data[0] ?? null : x.data }; });
    chain.maybeSingle = jest.fn(async () => { q.push('maybeSingle'); const x = answer(); return { ...x, data: Array.isArray(x.data) ? x.data[0] ?? null : x.data }; });
    chain.then = (ok: (v: unknown) => unknown, bad?: (e: unknown) => unknown) => {
      try { return Promise.resolve(ok(answer())); } catch (e) { return bad ? bad(e) : Promise.reject(e); }
    };
    return chain;
  };
  return { supabase: { from: jest.fn((t: string) => start(`from:${t}`)), rpc: jest.fn((n: string) => start(`rpc:${n}`)) } };
});
jest.mock('../utils/blocks', () => ({
  ...jest.requireActual('../utils/blocks'),
  blockedUserIds: jest.fn(async () => new Set()),
  targetUserHidden: jest.fn(async () => false),
  isBlockedBetween: jest.fn(async () => false),
}));
jest.mock('../utils/testContent', () => ({ hideTestFor: jest.fn(async () => false), excludeTest: (q: unknown) => q, excludeTestEmbed: (q: unknown) => q, testUserIdSet: jest.fn(async () => new Set()) }));
jest.mock('../utils/sportId', () => ({ resolveSportId: jest.fn(async (s?: string) => (s ? '99999999-9999-4999-8999-999999999999' : undefined)) }));
jest.mock('../utils/sports', () => ({ ...jest.requireActual('../utils/sports'), activeSportIds: jest.fn(async () => null), isSportInactive: jest.fn(async () => false) }));
jest.mock('../utils/teamAuth', () => ({ ...jest.requireActual('../utils/teamAuth'), getTeamRole: jest.fn(async () => 'captain') }));

// eslint-disable-next-line import/first
import { selectAll } from '../utils/selectAll';
// eslint-disable-next-line import/first
import { countParticipantsByMatch } from '../utils/matchCounts';
// eslint-disable-next-line import/first
import { listEvents } from '../controllers/scoring.controller';
// eslint-disable-next-line import/first
import { listMatches, listOpenMatches, matchHistory } from '../controllers/matches.controller';
// eslint-disable-next-line import/first
import { listInvites } from '../controllers/invites.controller';
// eslint-disable-next-line import/first
import { getFollowing, getReviews } from '../controllers/users.controller';
// eslint-disable-next-line import/first
import { weeklyDigest } from '../controllers/notifications.controller';
// eslint-disable-next-line import/first
import { getSportStoryCounts } from '../controllers/community.controller';
// eslint-disable-next-line import/first
import { getTeamInsights } from '../controllers/advancedStats.controller';

const ME = '11111111-1111-4111-8111-111111111111';
const T = '22222222-2222-4222-8222-222222222222';
const uid = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
const has = (q: Q, s: string) => q.some((c) => c.startsWith(s));
const arg = (q: Q, m: string) => { const c = q.find((x) => x.startsWith(`${m}:`)); return c ? JSON.parse(c.slice(m.length + 1)) : null; };
const call = async (fn: any, req: object) => {
  const r: any = { statusCode: 200, body: null, setHeader: jest.fn() };
  r.status = jest.fn((c: number) => { r.statusCode = c; return r; });
  r.json = jest.fn((b: unknown) => { r.body = b; return r; });
  await fn({ userId: ME, params: {}, query: {}, body: {}, ...req } as any, r);
  return r;
};
beforeEach(() => { mockLog = []; mockDb = () => ({ rows: [] }); });

test('selectAll reads every page, 1000 at a time', async () => {
  const rows = Array.from({ length: 2500 }, (_, i) => ({ i }));
  mockDb = () => ({ rows });
  const { supabase } = jest.requireMock('../utils/supabase');
  const got = await selectAll((from, to) => supabase.from('x').select('i').range(from, to));
  expect(got).toHaveLength(2500);
  expect(mockLog.map((q) => arg(q, 'range'))).toEqual([[0, 999], [1000, 1999], [2000, 2999]]);
});

test('ball-by-ball events are paged, with has_more (a 50-over match is past 500)', async () => {
  const events = Array.from({ length: 650 }, (_, i) => ({ id: `e${i}`, seq: i }));
  mockDb = (q) => (q[0] === 'from:match_events' ? { rows: events } : { rows: [] });
  const first = await call(listEvents, { params: { matchId: T }, query: {} });
  expect([first.body.events.length, first.body.has_more, first.body.next_offset]).toEqual([500, true, 500]);
  const rest = await call(listEvents, { params: { matchId: T }, query: { offset: '500' } });
  expect([rest.body.events.length, rest.body.has_more, rest.body.events[0].seq]).toEqual([150, false, 500]);
});

test('participants are counted for every match, not the first 1000 rows', async () => {
  const ids = Array.from({ length: 250 }, (_, i) => uid(i));
  // 6 players a match → 1500 rows
  mockDb = (q) => {
    const inIds = (arg(q, 'in') ?? [null, []])[1] as string[];
    return { rows: inIds.flatMap((m) => Array.from({ length: 6 }, (_, k) => ({ id: `${m}-${k}`, match_id: m }))) };
  };
  const counts = await countParticipantsByMatch(ids);
  expect(counts.size).toBe(250);
  expect([...counts.values()].every((n) => n === 6)).toBe(true);
  expect(mockLog.every((q) => ((arg(q, 'in') ?? [null, []])[1] as string[]).length <= 100)).toBe(true); // short id lists
});

test('match history: every match counts (1500), searched and voided on the server', async () => {
  const n = 1500;
  const matches = Array.from({ length: n }, (_, i) => ({
    id: uid(i), status: 'completed', team_a_name: i === 7 ? 'Lions XI' : `Side ${i}`, team_b_name: 'Other', voided_at: i % 100 === 0 ? '2026-10-01' : null,
    updated_at: new Date(Date.UTC(2026, 0, 1) + i * 60000).toISOString(),
  }));
  mockDb = (q) => {
    if (q[0] === 'from:match_participants') return { rows: matches.map((m) => ({ match_id: m.id, team_side: 'A' })) };
    if (q[0] === 'from:matches' && has(q, 'eq:["umpire_id"')) return { rows: [] };
    if (q[0] === 'from:matches') { const ids = new Set(arg(q, 'in')[1] as string[]); return { rows: matches.filter((m) => ids.has(m.id)) }; }
    if (q[0] === 'from:teams') return { rows: [] };
    return { rows: [] };
  };
  const all = await call(matchHistory, { query: {} });
  expect(all.body.played_count).toBe(n - 15); // voided ones don't count
  expect(all.body.total).toBe(n);
  const found = await call(matchHistory, { query: { q: 'lions' } });
  expect(found.body.matches.map((m: { id: string }) => m.id)).toEqual([uid(7)]);
  expect(found.body.played_count).toBe(n - 15); // the counts stay whole-history
  const hidden = await call(matchHistory, { query: { voided: 'hide' } });
  expect([hidden.body.total, hidden.body.voided_count]).toEqual([n - 15, 15]);
});

test('the results list: `q` and voided=hide go to the database; voided_count is counted there', async () => {
  mockDb = (q) => (q[0] === 'from:teams' ? { rows: [{ id: uid(1) }] } : { rows: Array.from({ length: 30 }, (_, i) => ({ id: uid(i) })) });
  const r = await call(listMatches, { query: { status: 'completed', q: 'lions', voided: 'hide' } });
  const list = mockLog.find((x) => x[0] === 'from:matches' && has(x, 'range:'))!;
  expect(arg(list, 'or')[0]).toContain('team_a_name.ilike."%lions%"');
  expect(arg(list, 'or')[0]).toContain(`team_a_id.in.(${uid(1)})`);
  expect(has(list, 'is:["voided_at",null]')).toBe(true);
  const voided = mockLog.find((x) => x[0] === 'from:matches' && has(x, 'not:["voided_at","is",null]'))!;
  expect(arg(voided, 'select')[1]).toEqual({ count: 'exact', head: true });
  expect(typeof r.body.voided_count).toBe('number');
});

test('open matches carry the database total (the tile counted a list that stops at 100)', async () => {
  const open = Array.from({ length: 140 }, (_, i) => ({ id: uid(i), scheduled_at: '2030-01-01', sport_id: 's' }));
  mockDb = (q) => (q[0] === 'from:matches' ? { rows: open } : { rows: [] });
  const r = await call(listOpenMatches, { query: {} });
  expect(r.body.matches.length).toBe(100);
  expect(r.body.total).toBe(140);
});

test('invites are paged, with the pending count from the database', async () => {
  const fresh = new Date().toISOString();
  const inv = Array.from({ length: 80 }, (_, i) => ({ id: uid(i), status: 'pending', created_at: fresh }));
  mockDb = (q) => (q[0] === 'from:invites' ? { rows: inv } : { rows: [] });
  const r = await call(listInvites, { query: {} });
  expect([r.body.invites.length, r.body.total, r.body.has_more, r.body.pending_count]).toEqual([50, 80, true, 80]);
  const next = await call(listInvites, { query: { offset: '50' } });
  expect([next.body.invites.length, next.body.has_more]).toEqual([30, false]);
});

test('reviews: count and average over every review (1500), list paged', async () => {
  const reviews = Array.from({ length: 1500 }, (_, i) => ({ id: uid(i), rating: i < 1000 ? 5 : 1 }));
  mockDb = (q) => (q[0] === 'from:user_reviews' ? { rows: reviews } : { rows: [] });
  const r = await call(getReviews, { params: { id: T }, query: {} });
  expect(r.body.count).toBe(1500);
  expect(r.body.avgRating).toBe(Math.round(((1000 * 5 + 500) / 1500) * 10) / 10);
  expect([r.body.reviews.length, r.body.has_more]).toEqual([50, true]);
});

test('following: a name search runs on the server, over the whole list', async () => {
  mockDb = () => ({ rows: [] });
  await call(getFollowing, { params: { id: ME }, query: { q: 'Ravi' } });
  const q = mockLog.find((x) => x[0] === 'from:follow_relationships')!;
  expect(arg(q, 'or')).toEqual(['name.ilike."%Ravi%",username.ilike."%Ravi%"', { referencedTable: 'users' }]);
});

test('weekly digest: every completed match this week counts (it read 500 participations)', async () => {
  const now = new Date().toISOString();
  mockDb = (q) => (q[0] === 'from:match_participants'
    ? { rows: Array.from({ length: 1200 }, (_, i) => ({ id: uid(i), match_id: uid(i), match: { status: 'completed', updated_at: now, voided_at: null } })) }
    : { rows: [] });
  const r = await call(weeklyDigest, { query: {} });
  expect(r.body.stats.matches_played).toBe(1200);
});

test('story counts: every post this week is counted (one read stopped at 1000)', async () => {
  const sport = { id: 's1', name: 'Cricket', emoji: '🏏' };
  mockDb = (q) => (q[0] === 'from:community_posts' ? { rows: Array.from({ length: 1500 }, (_, i) => ({ id: uid(i), sport_id: 's1', sport })) } : { rows: [] });
  const r = await call(getSportStoryCounts, { query: {} });
  expect(r.body.sports).toEqual([{ sport_id: 's1', name: 'Cricket', emoji: '🏏', count: 1500 }]);
});

test('team insights: played / won count every match (1200)', async () => {
  mockDb = (q) => {
    if (q[0] === 'from:teams') return { one: { id: T, name: 'Lions', sport_id: 's' } };
    if (q[0] === 'from:matches') return { rows: Array.from({ length: 1200 }, (_, i) => ({ id: uid(i), winner_team_id: T, team_a_id: T, scheduled_at: '2026-01-01' })) };
    return { rows: [] };
  };
  const r = await call(getTeamInsights, { params: { id: T }, query: {} });
  expect([r.body.played, r.body.record.wins]).toEqual([1200, 1200]);
});
