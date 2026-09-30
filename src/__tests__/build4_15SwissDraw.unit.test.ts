/**
 * BUILD 4.15 · creating and drawing a Swiss: chess only, with its rounds, a
 * Buchholz-first tie-break order by default, and round 1 drawn with a bye row
 * when the field is odd; no more rounds than the field can play without
 * meeting twice.
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
import { createTournament, generateFixtures } from '../controllers/tournaments.controller';

const body = { sport_id: 'sp', name: 'P3 Swiss', format: 'swiss', max_teams: 8, entry_fee: 0, start_date: '2026-10-05' };
const onInsert = () => { mockLog = []; mockNext = (q) => (q[0] === 'from:tournaments' && has(q, 'insert:') ? { data: { id: T } } : { data: null }); };

test('create: chess with rounds, tie-breaks Buchholz first', async () => {
  mockSportSlug = 'chess';
  onInsert();
  const r = await run(createTournament, { body: { ...body, settings: { v: 1, swiss: { rounds: 5 } } } });
  expect(r.statusCode).toBeLessThan(300);
  expect(written('tournaments', 'insert')[0]).toMatchObject({ format: 'swiss', tiebreaker_rules: ['buchholz', 'sonneborn_berger', 'wins'], settings: { v: 1, swiss: { rounds: 5 } } });
});
test('create: not chess, or no rounds → 400', async () => {
  mockSportSlug = 'football';
  onInsert();
  expect((await run(createTournament, { body: { ...body, settings: { v: 1, swiss: { rounds: 5 } } } })).body.error).toBe('Swiss is for chess.');
  mockSportSlug = 'chess';
  expect((await run(createTournament, { body })).body.error).toBe('A Swiss needs its number of rounds.');
});

const setup = (players: number, rounds: number) => {
  mockLog = [];
  mockSportSlug = 'chess';
  mockNext = (q) => {
    if (q[0] === 'from:tournaments' && has(q, 'update:')) return { data: [{ id: T }] };
    if (q[0] === 'from:tournaments') return { data: { id: T, status: 'upcoming', sport_id: 'sp', format: 'swiss', start_date: '2026-10-05', settings: { v: 1, swiss: { rounds } } } };
    if (q[0] === 'from:tournament_entries' && has(q, 'select:')) return { data: Array.from({ length: players }, (_, i) => ({ id: `e${i}`, team_id: `p${i + 1}`, entered_at: `2026-10-01T0${i}:00`, team: { id: `p${i + 1}`, name: `P${i + 1}` } })) };
    if (q[0] === 'from:matches' && has(q, 'insert:')) return { data: [{ id: 'm1' }] };
    return { data: [] };
  };
};
test('the draw: round 1 of 5 players — two games and a bye (a completed win), and the paired round noted', async () => {
  setup(5, 4);
  expect((await run(generateFixtures, {})).statusCode).toBe(200);
  const rows = mockLog.filter((q) => q[0] === 'from:matches' && has(q, 'insert:')).flatMap((q) => JSON.parse(q.find((c) => c.startsWith('insert:'))!.slice(7)));
  expect(rows.filter((r: any) => r.team_b_id)).toHaveLength(2);
  expect(rows.find((r: any) => !r.team_b_id)).toMatchObject({ team_a_id: 'p5', status: 'completed', winner_team_id: 'p5', round: 1, score_summary: { bye: true } });
  expect(written('tournaments', 'update').find((u) => u.settings)?.settings).toEqual({ v: 1, swiss: { rounds: 4, paired: 1 } });
});
test('more rounds than the field can play → 400 SWISS_ROUNDS', async () => {
  setup(4, 5);
  const r = await run(generateFixtures, {});
  expect([r.statusCode, r.body.code]).toEqual([400, 'SWISS_ROUNDS']);
});
