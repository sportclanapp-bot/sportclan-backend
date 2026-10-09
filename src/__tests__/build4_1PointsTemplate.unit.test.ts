/**
 * BUILD 4.1 · a points template per tournament (settings.points, migration
 * 116): win / draw / loss / no result / walkover, and volleyball's points by
 * set score. It reaches the shared standings ladder (table, crowning, group
 * qualification, the offline hub) through pointsFor; checked on create and
 * edit, fixed once any result stands. Tournaments without one score exactly as
 * before (3 / 1 / 0, chess 1 / ½ / 0, a no-result not counted).
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
import { computeStats, rankTeams, pointsFor, DEFAULT_POINTS, CHESS_POINTS, type GMatch } from '../utils/standings';
// eslint-disable-next-line import/first
import { pointsPresetFor, pointsRefusal, settingsRefusal, storedSettings } from '../utils/tournamentSettings';

const done = (a: string, b: string, winner: string | null, sa: number, sb: number, extra: Partial<GMatch> = {}): GMatch => ({
  team_a_id: a, team_b_id: b, winner_team_id: winner, status: 'completed',
  score_summary: { A: { score: sa }, B: { score: sb } }, ...extra,
});
const noResult = (a: string, b: string): GMatch => ({ team_a_id: a, team_b_id: b, winner_team_id: null, status: 'abandoned', score_summary: {} });

describe('BUILD 4.1 · pointsFor', () => {
  test('no settings → the sport default, as before', () => {
    expect(pointsFor('football', null)).toBe(DEFAULT_POINTS);
    expect(pointsFor('chess', { v: 1 })).toBe(CHESS_POINTS);
  });
  test('a template wins over the sport default', () => {
    const p = pointsPresetFor('cricket');
    expect(pointsFor('cricket', { v: 1, points: p })).toBe(p);
  });
});

describe('BUILD 4.1 · the template scores the table', () => {
  test('cricket 2 / 1 / 0 with a no-result worth 1 each, counted as played', () => {
    const pts = pointsPresetFor('cricket');
    const s = computeStats(['A', 'B', 'C'], [done('A', 'B', 'A', 150, 120), noResult('A', 'C'), done('B', 'C', null, 100, 100)], undefined, pts);
    expect(s.get('A')).toMatchObject({ played: 2, won: 1, noResult: 1, points: 3 });
    expect(s.get('C')).toMatchObject({ played: 2, drawn: 1, noResult: 1, points: 2 });
    expect(s.get('B')).toMatchObject({ played: 2, lost: 1, drawn: 1, points: 1 });
  });
  test('without a template a no-result still isn’t counted (BUILD 1.4 unchanged)', () => {
    const s = computeStats(['A', 'C'], [noResult('A', 'C')], undefined, DEFAULT_POINTS);
    expect(s.get('A')).toMatchObject({ played: 0, noResult: 0, points: 0 });
  });
  test('basketball: a loss is 1, a forfeit loss 0', () => {
    const pts = pointsPresetFor('basketball');
    const s = computeStats(['A', 'B', 'C'], [
      done('A', 'B', 'A', 80, 70),
      done('A', 'C', 'A', 0, 0, { score_summary: { walkover: true } }),
    ], undefined, pts);
    expect(s.get('B')!.points).toBe(1);
    expect(s.get('C')!.points).toBe(0);
    expect(s.get('A')!.points).toBe(4);
  });
  test('an abandoned match with a winner is a walkover too', () => {
    const pts = pointsPresetFor('tabletennis');
    const s = computeStats(['A', 'B'], [{ team_a_id: 'A', team_b_id: 'B', winner_team_id: 'A', status: 'abandoned', score_summary: {} }], undefined, pts);
    expect([s.get('A')!.points, s.get('B')!.points]).toEqual([2, 0]);
  });
  test('volleyball: 3–0 and 3–1 are 3 / 0, 3–2 is 2 / 1; bo3 2–1 is 2 / 1', () => {
    const pts = pointsPresetFor('volleyball');
    const s = computeStats(['A', 'B', 'C', 'D'], [
      done('A', 'B', 'A', 3, 0), done('C', 'D', 'C', 3, 1), done('A', 'C', 'C', 2, 3), done('B', 'D', 'B', 2, 1),
    ], undefined, pts);
    expect(s.get('A')!.points).toBe(3 + 1);
    expect(s.get('C')!.points).toBe(3 + 2);
    expect(s.get('B')!.points).toBe(0 + 2);
    expect(s.get('D')!.points).toBe(0 + 1);
  });
  test('a volleyball forfeit scores as a straight win', () => {
    const pts = pointsPresetFor('volleyball');
    const s = computeStats(['A', 'B'], [done('A', 'B', 'A', 0, 0, { score_summary: { walkover: true } })], undefined, pts);
    expect([s.get('A')!.points, s.get('B')!.points]).toEqual([3, 0]);
  });
  test('the ranking follows the template: two wins and a loss beat one win and two no-results only when a no-result is worth enough', () => {
    const ms = [done('X', 'O1', 'X', 1, 0), done('X', 'O2', 'X', 1, 0), done('X', 'O3', 'O3', 0, 1), done('Y', 'O1', 'Y', 1, 0), noResult('Y', 'O2'), noResult('Y', 'O3')];
    const ids = ['X', 'Y', 'O1', 'O2', 'O3'];
    expect(rankTeams(ids, ms, [], { win: 2, draw: 1, loss: 0, noResult: 1 }).slice(0, 2)).toEqual(['X', 'Y']);
    expect(rankTeams(ids, ms, [], { win: 2, draw: 1, loss: 0, noResult: 2 }).indexOf('Y')).toBe(0);
  });
});

describe('BUILD 4.1 · the template is checked', () => {
  test.each([
    [{ win: 3, draw: 1, loss: 0, noResult: null }, null],
    [{ win: 3, draw: 1, loss: 3 }, 'A win has to be worth more than a loss.'],
    [{ win: 3, draw: 4, loss: 0 }, 'A draw has to be worth between a loss and a win.'],
    [{ win: 11, draw: 1, loss: 0 }, 'Points for a win must be 0 to 10, in halves.'],
    [{ win: 3, draw: 1.3, loss: 0 }, 'Points for a draw must be 0 to 10, in halves.'],
    [{ win: 3, draw: 1, loss: 0, noResult: 4 }, 'A no result can’t be worth more than a win.'],
    [{ win: 2, draw: 1.5, loss: 1, walkoverLoss: 2 }, 'A walkover loss can’t be worth more than a loss.'],
  ])('%j → %p', (p, err) => {
    expect(pointsRefusal('football', p)?.error ?? null).toBe(err);
  });
  test('set-score points are volleyball’s, and need sensible pairs', () => {
    const sets = { straight: [3, 0], decider: [2, 1] };
    expect(pointsRefusal('football', { win: 3, draw: 1, loss: 0, sets })?.error).toBe('Points by set score are for volleyball, and by the deciding match for team ties.'); // Stage 11 · PB3
    expect(pointsRefusal('volleyball', { win: 3, draw: 1, loss: 0, sets })).toBeNull();
    expect(pointsRefusal('volleyball', { win: 3, draw: 1, loss: 0, sets: { straight: [2, 1], decider: [3, 0] } })?.error).toMatch(/can’t be worth more than a straight win/);
  });
  test('every sport preset passes its own check', () => {
    for (const s of ['cricket', 'football', 'hockey', 'basketball', 'volleyball', 'badminton', 'tabletennis', 'pickleball', 'tennis', 'chess', 'carrom']) {
      expect([s, pointsRefusal(s, pointsPresetFor(s))]).toEqual([s, null]);
    }
  });
  test('an unknown setting or version is refused', () => {
    expect(settingsRefusal('football', 'league', { v: 1, pointz: {} })?.error).toBe('“pointz” isn’t a tournament setting.');
    expect(settingsRefusal('football', 'league', { v: 2 })?.error).toBe('Tournament settings version must be 1.');
    expect(settingsRefusal('football', 'league', [])?.error).toBe('Tournament settings must be an object.');
  });
  test('stored: known fields only, nulls filled', () => {
    expect(storedSettings({ points: { win: 3, draw: 1, loss: 0, extra: 9 } })).toEqual({ v: 1, points: { win: 3, draw: 1, loss: 0, noResult: null, walkoverWin: null, walkoverLoss: null, sets: null } });
  });
});

describe('BUILD 4.1 · create and edit', () => {
  const tBody = { sport_id: 'sp', name: 'P3 Points', format: 'league', max_teams: 4, entry_fee: 0, start_date: '2026-10-05' };
  test('create stores the template; a bad one → 400, nothing inserted; none → settings null', async () => {
    mockSportSlug = 'cricket';
    mockLog = [];
    mockNext = (q) => (q[0] === 'from:tournaments' && has(q, 'insert:') ? { data: { id: T } } : { data: null });
    const ok = await run(createTournament, { body: { ...tBody, settings: { v: 1, points: pointsPresetFor('cricket') } } });
    expect(ok.statusCode).toBeLessThan(300);
    expect(written('tournaments', 'insert')[0].settings).toEqual({ v: 1, points: pointsPresetFor('cricket') });
    mockLog = [];
    const bad = await run(createTournament, { body: { ...tBody, settings: { points: { win: 0, draw: 0, loss: 0 } } } });
    expect([bad.statusCode, bad.body.code]).toEqual([400, 'INVALID_TOURNAMENT_SETTINGS']);
    expect(mockLog.some((x) => has(x, 'insert:'))).toBe(false);
    mockLog = [];
    await run(createTournament, { body: tBody });
    expect(written('tournaments', 'insert')[0].settings).toBeNull();
  });
  const row = (extra: object = {}) => ({ id: T, created_by: 'me', status: 'upcoming', format: 'league', fixtures_generated: true, sport_id: 'sp', settings: { v: 1, points: pointsPresetFor('football') }, ...extra });
  test('edit before any result: stored, merged over the rest', async () => {
    mockSportSlug = 'football';
    mockLog = [];
    mockNext = (q) => (q[0] === 'from:tournaments' ? { data: row() } : q[0] === 'from:matches' ? { count: 0 } : { data: null });
    const r = await run(updateTournament, { body: { settings: { points: { win: 2, draw: 1, loss: 0 } } } });
    expect(r.statusCode).toBe(200);
    expect(written('tournaments', 'update').find((u) => u.settings)?.settings.points).toMatchObject({ win: 2, draw: 1, loss: 0 });
  });
  test('edit after a result → 409 POINTS_LOCKED; resending the same template is fine', async () => {
    mockSportSlug = 'football';
    mockLog = [];
    mockNext = (q) => (q[0] === 'from:tournaments' ? { data: row() } : q[0] === 'from:matches' ? { count: 1 } : { data: null });
    const r = await run(updateTournament, { body: { settings: { points: { win: 2, draw: 1, loss: 0 } } } });
    expect([r.statusCode, r.body.code]).toEqual([409, 'POINTS_LOCKED']);
    const same = await run(updateTournament, { body: { settings: { points: pointsPresetFor('football') } } });
    expect(same.statusCode).toBe(200);
  });
});
