/**
 * BUILD 4.3 / 4.4 · the groups set-up: 2–16 groups and 1–4 through from each
 * (they were 1–64 and 1–32, and the app never sent them), now editable until
 * the draw is made, and the draw settings (best third places, …) fixed after.
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

const tBody = { sport_id: 'sp', name: 'P3 Groups', format: 'groups_knockout', max_teams: 8, entry_fee: 0, start_date: '2026-10-05' };
const onInsert = () => { mockLog = []; mockNext = (q) => (q[0] === 'from:tournaments' && has(q, 'insert:') ? { data: { id: T } } : { data: null }); };

describe('BUILD 4.3 / 4.4 · on create', () => {
  test.each([
    // Oct 2026 (Dipak): no upper caps — at least 2 groups, at least 1 through.
    [{ num_groups: 1 }, 'Groups must be at least 2.'],
    [{ num_groups: 2.5 }, 'Groups must be at least 2.'],
    [{ qualifiers_per_group: 0 }, 'At least 1 team must go through from each group.'],
  ])('%j → 400', async (extra, err) => {
    onInsert();
    const r = await run(createTournament, { body: { ...tBody, ...extra } });
    expect([r.statusCode, r.body.error, r.body.code]).toEqual([400, err, 'BAD_GROUPS']);
  });
  test('16 groups, 4 through, best third places — stored', async () => {
    onInsert();
    const r = await run(createTournament, { body: { ...tBody, max_teams: 48, num_groups: 16, qualifiers_per_group: 1, settings: { bestThirds: true } } });
    expect(r.statusCode).toBeLessThan(300);
    expect(written('tournaments', 'insert')[0]).toMatchObject({ num_groups: 16, qualifiers_per_group: 1, settings: { v: 1, bestThirds: true } });
  });
  test('more groups than the teams can fill → 400', async () => {
    onInsert();
    const r = await run(createTournament, { body: { ...tBody, max_teams: 6, num_groups: 4 } });
    expect([r.statusCode, r.body.error, r.body.code]).toEqual([400, '4 groups need at least 8 teams; max teams is 6.', 'GROUPS_TOO_SMALL']);
  });
  test('best third places on a league → 400', async () => {
    onInsert();
    const r = await run(createTournament, { body: { ...tBody, format: 'league', settings: { bestThirds: true } } });
    expect([r.statusCode, r.body.error]).toEqual([400, 'Best third places are for groups → knockout.']);
  });
});

describe('BUILD 4.3 / 4.4 / 4.5 · on edit', () => {
  const row = (extra: object = {}) => ({ id: T, created_by: 'me', status: 'upcoming', format: 'groups_knockout', fixtures_generated: false, sport_id: 'sp', settings: null, tiebreaker_rules: [], sport_metadata: {}, num_groups: 2, group_size: null, qualifiers_per_group: 2, max_teams: 8, ...extra });
  const on = (r: object) => { mockLog = []; mockNext = (q) => (q[0] === 'from:tournaments' ? { data: r } : q[0] === 'from:matches' ? { count: 0 } : { data: null }); };
  test('before the draw: groups, qualifiers and best thirds change', async () => {
    on(row());
    const r = await run(updateTournament, { body: { num_groups: 4, qualifiers_per_group: 1, settings: { bestThirds: true } } });
    expect(r.statusCode).toBe(200);
    expect(written('tournaments', 'update').find((u) => u.num_groups)).toMatchObject({ num_groups: 4, qualifiers_per_group: 1, settings: { v: 1, bestThirds: true } });
  });
  test('out of range → 400; more qualifiers than a group holds → 400', async () => {
    on(row());
    expect((await run(updateTournament, { body: { num_groups: 1 } })).body.code).toBe('BAD_GROUPS'); // Oct 2026: only below 2
    on(row({ group_size: 3 }));
    expect((await run(updateTournament, { body: { qualifiers_per_group: 4 } })).body.error).toBe('qualifiers_per_group cannot exceed group_size');
  });
  test('after the draw → 409 GROUPS_LOCKED / SETTINGS_LOCKED; the same values again are fine', async () => {
    on(row({ fixtures_generated: true }));
    const g = await run(updateTournament, { body: { num_groups: 4 } });
    expect([g.statusCode, g.body.code]).toEqual([409, 'GROUPS_LOCKED']);
    const s = await run(updateTournament, { body: { settings: { bestThirds: true } } });
    expect([s.statusCode, s.body.code, s.body.field]).toEqual([409, 'SETTINGS_LOCKED', 'bestThirds']);
    expect((await run(updateTournament, { body: { num_groups: 2, name: 'P3 Groups 2' } })).statusCode).toBe(200);
  });
});
