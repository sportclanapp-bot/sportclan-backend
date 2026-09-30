/**
 * BUILD 4.6 · seeding: registration order, a random draw (written down as
 * seeds), or the organiser's seeds — which are fixed once the draw is made.
 * No setting keeps the old order: seeds when set, then entry time.
 */
let mockSportSlug = 'cricket';
type Q = string[];
let mockLog: Q[] = [];
let mockNext: (q: Q) => { data?: unknown; error?: unknown; count?: number } = () => ({ data: null, error: null });
jest.mock('../utils/supabase', () => {
  const start = (t: string) => {
    const q: string[] = [`from:${t}`];
    mockLog.push(q);
    const chain: any = {};
    for (const m of ['select', 'in', 'not', 'eq', 'neq', 'is', 'limit', 'maybeSingle', 'single', 'update', 'delete', 'order', 'or', 'ilike', 'range', 'gte', 'gt', 'lt', 'upsert']) {
      chain[m] = jest.fn((...a: unknown[]) => { q.push(`${m}:${JSON.stringify(a)}`); return chain; });
    }
    chain.insert = jest.fn((row: unknown) => { q.push(`insert:${JSON.stringify(row)}`); return chain; });
    chain.then = (ok: (v: unknown) => unknown, bad?: (e: unknown) => unknown) => {
      try { return Promise.resolve(ok({ data: null, error: null, ...mockNext(q) })); } catch (e) { return bad ? bad(e) : Promise.reject(e); }
    };
    return chain;
  };
  return { supabase: { from: jest.fn(start), rpc: jest.fn(async () => ({ data: null, error: null })) } };
});
jest.mock('../utils/tournamentAuth', () => ({
  ...jest.requireActual('../utils/tournamentAuth'),
  isTournamentOrganiser: jest.fn(async () => true),
  logAdminAction: jest.fn(),
}));
jest.mock('../utils/teamVisibility', () => ({ ...jest.requireActual('../utils/teamVisibility'), isTeamDisbanded: jest.fn(async () => false) }));
let mockCanOpenChat = false;
jest.mock('../utils/tournamentChat', () => ({
  syncTournamentChatMembers: jest.fn(async () => undefined),
  syncAfterSuccess: jest.fn(),
  canOpenTournamentChat: jest.fn(async () => mockCanOpenChat),
}));
jest.mock('../utils/testContent', () => ({ hideTestFor: jest.fn(async () => false), excludeTest: (q: unknown) => q, testUserIdSet: jest.fn(async () => new Set()) }));
jest.mock('../utils/sports', () => ({ ...jest.requireActual('../utils/sports'), validateSportForCreate: jest.fn(async () => null) }));
jest.mock('../utils/sportId', () => ({ resolveSportId: jest.fn(async () => undefined) }));
jest.mock('../utils/sportCache', () => ({ ...jest.requireActual('../utils/sportCache'), getSport: jest.fn(async () => ({ slug: mockSportSlug })) }));
jest.mock('../utils/notify', () => ({
  notifyUser: jest.fn(), notifyUsers: jest.fn(), notifyUnlessBlocked: jest.fn(), sendPushToUsers: jest.fn(), allowedRecipients: jest.fn(async () => []),
  matchAudienceIds: jest.fn(async () => []), matchFollowerIds: jest.fn(async () => []),
}));
const T = '22222222-2222-4222-8222-222222222222';
const has = (q: Q, s: string) => q.some((c) => c.startsWith(s));
const run = async (fn: any, req: object) => {
  const r: any = { statusCode: 200, body: null, setHeader: jest.fn() };
  r.status = jest.fn((c: number) => { r.statusCode = c; return r; });
  r.json = jest.fn((b: unknown) => { r.body = b; return r; });
  await fn({ userId: 'me', params: { id: T }, query: {}, body: {}, ...req } as any, r);
  return r;
};
const written = (table: string, op: 'insert' | 'update') => mockLog.filter((q) => q[0] === `from:${table}` && has(q, `${op}:`)).map((q) => { const v = JSON.parse(q.find((c) => c.startsWith(`${op}:`))!.slice(op.length + 1)); return op === 'update' ? v[0] : v; });

// eslint-disable-next-line import/first
import { generateFixtures, updateEntry, createTournament } from '../controllers/tournaments.controller';
// eslint-disable-next-line import/first
import { drawOrder } from '../utils/drawOrder';

const E = (team_id: string, entered_at: string, seed: number | null = null) => ({ id: `e-${team_id}`, team_id, entered_at, seed });
const four = [E('t1', '2026-10-01T10:00'), E('t2', '2026-10-01T09:00', 2), E('t3', '2026-10-01T11:00', 1), E('t4', '2026-10-01T08:00')];

describe('BUILD 4.6 · drawOrder', () => {
  test('absent / manual: seeds first, then entry time', () => {
    expect(drawOrder(four, null).map((e) => e.team_id)).toEqual(['t3', 't2', 't4', 't1']);
    expect(drawOrder(four, 'manual').map((e) => e.team_id)).toEqual(['t3', 't2', 't4', 't1']);
  });
  test('registration: entry time only, seeds ignored', () => {
    expect(drawOrder(four, 'registration').map((e) => e.team_id)).toEqual(['t4', 't2', 't1', 't3']);
  });
  test('random: a shuffle (a fixed random gives a fixed order), every team once', () => {
    const seq = [0.9, 0.1, 0.5];
    let k = 0;
    const out = drawOrder(four, 'random', () => seq[k++ % seq.length]!).map((e) => e.team_id);
    expect(out.slice().sort()).toEqual(['t1', 't2', 't3', 't4']);
    k = 0;
    expect(drawOrder(four, 'random', () => seq[k++ % seq.length]!).map((e) => e.team_id)).toEqual(out);
    expect(out).not.toEqual(['t4', 't2', 't1', 't3']);
  });
});

describe('BUILD 4.6 · the draw', () => {
  const setup = (seeding: string | null) => {
    mockLog = [];
    mockSportSlug = 'football';
    mockNext = (q) => {
      if (q[0] === 'from:tournaments' && has(q, 'update:')) return { data: [{ id: T }] };
      if (q[0] === 'from:tournaments') return { data: { id: T, status: 'upcoming', sport_id: 'sp', format: 'knockout', start_date: '2026-10-05', settings: seeding ? { v: 1, seeding } : null } };
      if (q[0] === 'from:tournament_entries' && has(q, 'select:')) return { data: four.map((e) => ({ ...e, team: { id: e.team_id, name: e.team_id } })) };
      if (q[0] === 'from:matches' && has(q, 'insert:')) return { data: [{ id: 'm1', match_no: 0 }] };
      return { data: [] };
    };
  };
  const seedWrites = () => mockLog.filter((q) => q[0] === 'from:tournament_entries' && has(q, 'update:'))
    .map((q) => JSON.parse(q.find((c) => c.startsWith('update:'))!.slice(7))[0]).filter((u) => 'seed' in u);
  test('random writes seeds 1…4, one per team', async () => {
    setup('random');
    expect((await run(generateFixtures, {})).statusCode).toBe(200);
    expect(seedWrites().map((u) => u.seed)).toEqual([1, 2, 3, 4]);
  });
  test('registration and manual write no seeds; the knockout follows the order', async () => {
    setup('registration');
    await run(generateFixtures, {});
    expect(seedWrites()).toEqual([]);
    const first = mockLog.filter((q) => q[0] === 'from:matches' && has(q, 'insert:')).flatMap((q) => JSON.parse(q.find((c) => c.startsWith('insert:'))!.slice(7)));
    const r1 = first.flat().filter((m: any) => m.round === 1 && m.team_a_id);
    // 1 v 4 and 2 v 3 by entry time: t4 v t3, t2 v t1
    expect(r1.map((m: any) => [m.team_a_id, m.team_b_id].sort().join('-')).sort()).toEqual(['t1-t2', 't3-t4']);
  });
});

describe('BUILD 4.6 · settings and seeds', () => {
  test('an unknown seeding → 400', async () => {
    mockLog = [];
    mockSportSlug = 'football';
    mockNext = () => ({ data: null });
    const r = await run(createTournament, { body: { sport_id: 'sp', name: 'P3 Seeding', format: 'knockout', max_teams: 4, entry_fee: 0, start_date: '2026-10-05', settings: { seeding: 'coin' } } });
    expect([r.statusCode, r.body.error]).toEqual([400, 'Seeding is registration order, a random draw or manual seeds.']);
  });
  test('a seed after the draw → 409 SEEDS_LOCKED', async () => {
    mockLog = [];
    mockNext = (q) => (q[0] === 'from:tournament_entries' ? { data: { id: 'e1', tournament_id: T, team_id: 't1', status: 'approved' } }
      : q[0] === 'from:tournaments' ? { data: { id: T, status: 'live', fixtures_generated: true, created_by: 'me' } } : { data: null });
    const r = await run(updateEntry, { params: { id: T, entryId: 'e1' }, body: { seed: 3 } });
    expect([r.statusCode, r.body.code]).toEqual([409, 'SEEDS_LOCKED']);
  });
});
