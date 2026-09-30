/**
 * BUILD 4.8 · a walkover's score per tournament: goals / points for the
 * winner (basketball 20–0), or a straight win in the fixture's length (table
 * tennis 3–0, 2–0 in a best of 3, chess 1–0). No setting = as before: football
 * by its rules (3–0 / 5–0), the rest no score. Cricket has none.
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
import { createTournament, updateTournament } from '../controllers/tournaments.controller';
// eslint-disable-next-line import/first
import { withWalkoverScore, walkoverScoreFor } from '../utils/walkoverScore';
// eslint-disable-next-line import/first
import { normalizeRules, standardRules } from '../utils/matchRules';
// eslint-disable-next-line import/first
import { walkoverPresetFor, walkoverRefusal } from '../utils/tournamentSettings';

describe('BUILD 4.8 · the score', () => {
  test('no setting: football by its rules, others none (as before)', () => {
    expect(walkoverScoreFor('football', standardRules('football'))).toBe(3);
    expect(walkoverScoreFor('basketball', standardRules('basketball'))).toBeNull();
    expect(walkoverScoreFor('tabletennis', standardRules('tabletennis'), { v: 1 })).toBeNull();
  });
  test('a number: basketball 20–0; football’s overrides its rules', () => {
    expect(withWalkoverScore('basketball', standardRules('basketball'), {}, 'B', { v: 1, walkoverScore: 20 })).toMatchObject({ A: { score: 0 }, B: { score: 20 }, walkover_score: { A: 0, B: 20 } });
    expect(walkoverScoreFor('football', standardRules('football'), { walkoverScore: 5 })).toBe(5);
  });
  test('straight: the games / sets a win takes in the fixture’s length; chess 1–0', () => {
    expect(walkoverScoreFor('tabletennis', standardRules('tabletennis'), { walkoverScore: 'straight' })).toBe(3);
    expect(walkoverScoreFor('badminton', normalizeRules('badminton', { v: 1, bestOf: 1 }), { walkoverScore: 'straight' })).toBe(1);
    expect(walkoverScoreFor('volleyball', normalizeRules('volleyball', { v: 1, bestOf: 3 }), { walkoverScore: 'straight' })).toBe(2);
    expect(walkoverScoreFor('chess', standardRules('chess'), { walkoverScore: 'straight' })).toBe(1);
  });
  test('checked per sport; presets pass', () => {
    expect(walkoverRefusal('cricket', 'straight')?.error).toBe('A cricket walkover has no score — the win’s points are the result.');
    expect(walkoverRefusal('basketball', 'straight')?.error).toBe('A walkover’s score must be 1 to 99.');
    expect(walkoverRefusal('basketball', 0)?.error).toBe('A walkover’s score must be 1 to 99.');
    expect(walkoverRefusal('tabletennis', 3)?.error).toBe('A walkover here is a straight win or no score.');
    for (const s of ['cricket', 'football', 'hockey', 'basketball', 'volleyball', 'badminton', 'tabletennis', 'pickleball', 'tennis', 'chess', 'carrom']) {
      expect([s, walkoverRefusal(s, walkoverPresetFor(s))]).toEqual([s, null]);
    }
  });
});

describe('BUILD 4.8 · create and edit', () => {
  test('stored on create; a bad one → 400', async () => {
    mockSportSlug = 'basketball';
    mockLog = [];
    mockNext = (q) => (q[0] === 'from:tournaments' && has(q, 'insert:') ? { data: { id: T } } : { data: null });
    const body = { sport_id: 'sp', name: 'P3 Walkover', format: 'league', max_teams: 4, entry_fee: 0, start_date: '2026-10-05' };
    expect((await run(createTournament, { body: { ...body, settings: { walkoverScore: 20 } } })).statusCode).toBeLessThan(300);
    expect(written('tournaments', 'insert')[0].settings).toEqual({ v: 1, walkoverScore: 20 });
    const bad = await run(createTournament, { body: { ...body, settings: { walkoverScore: 'straight' } } });
    expect(bad.statusCode).toBe(400);
  });
  test('fixed once a result is in (WALKOVER_LOCKED); before, it changes', async () => {
    mockSportSlug = 'basketball';
    const row = { id: T, created_by: 'me', status: 'live', format: 'league', fixtures_generated: true, sport_id: 'sp', settings: { v: 1, walkoverScore: 20 }, tiebreaker_rules: [] };
    mockLog = [];
    mockNext = (q) => (q[0] === 'from:tournaments' ? { data: row } : q[0] === 'from:matches' ? { count: 0 } : { data: null });
    expect((await run(updateTournament, { body: { settings: { walkoverScore: 10 } } })).statusCode).toBe(200);
    mockNext = (q) => (q[0] === 'from:tournaments' ? { data: row } : q[0] === 'from:matches' ? { count: 2 } : { data: null });
    const r = await run(updateTournament, { body: { settings: { walkoverScore: 10 } } });
    expect([r.statusCode, r.body.code]).toEqual([409, 'WALKOVER_LOCKED']);
  });
});
