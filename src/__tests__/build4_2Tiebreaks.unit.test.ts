/**
 * BUILD 4.2 · the tie-break order: sport presets, validated names, the new
 * set ratio / Buchholz / Sonneborn-Berger criteria, and a lock once any result
 * stands. The list used to be stored as sent, and a name the table didn't know
 * was silently skipped.
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
import { rankTeams, buildOrder, CHESS_POINTS, DEFAULT_POINTS, type GMatch } from '../utils/standings';
// eslint-disable-next-line import/first
import { tiebreakRefusal, storedTiebreaks, tiebreakPresetsFor, tiebreaksFor, defaultTiebreaks, tiebreakLabel } from '../utils/tournamentSettings';

const done = (a: string, b: string, winner: string | null, sa: number, sb: number): GMatch => ({
  team_a_id: a, team_b_id: b, winner_team_id: winner, status: 'completed', score_summary: { A: { score: sa }, B: { score: sb } },
});

describe('BUILD 4.2 · names are checked', () => {
  test.each([
    [['head_to_head', 'score_diff'], null],
    [['points', 'gd', 'h2h'], null],
    [['goal_difference', 'gd'], 'Goal difference is in the list twice.'],
    [['coin_toss'], '“coin_toss” isn’t a tie-break.'],
    [['nrr'], 'Net run rate isn’t a tie-break for this sport.'],
    [['buchholz'], 'Buchholz isn’t a tie-break for this sport.'],
    ['h2h', 'Tie-breaks must be a list.'],
    [['head_to_head', 'wins', 'score_diff', 'score_scored', 'score_ratio', 'head_to_head'], 'Head-to-head is in the list twice.'],
  ])('football %j → %p', (list, err) => {
    expect(tiebreakRefusal('football', list)?.error ?? null).toBe(err);
  });
  test('stored as canonical names, points dropped', () => {
    expect(storedTiebreaks(['points', 'GD', 'h2h', 'goals_for'])).toEqual(['score_diff', 'head_to_head', 'score_scored']);
  });
  test('every preset is valid for its sport and the first is the table’s default', () => {
    for (const s of ['cricket', 'football', 'hockey', 'basketball', 'volleyball', 'badminton', 'tabletennis', 'pickleball', 'tennis', 'chess', 'carrom']) {
      const ps = tiebreakPresetsFor(s);
      expect(ps[0]!.order).toEqual(defaultTiebreaks(s));
      for (const p of ps) expect([s, p.key, tiebreakRefusal(s, p.order)]).toEqual([s, p.key, null]);
    }
    expect(buildOrder([])).toEqual(['points', 'head_to_head', 'score_rate', 'score_diff', 'score_scored']);
  });
  test('sport words', () => {
    expect(tiebreakLabel('football', 'score_diff')).toBe('Goal difference');
    expect(tiebreakLabel('volleyball', 'score_ratio')).toBe('Set ratio');
    expect(tiebreakLabel('cricket', 'score_scored')).toBe('Runs scored');
    expect(tiebreakLabel('tabletennis', 'score_scored')).toBe('Games won');
    expect(tiebreaksFor('chess')).toContain('sonneborn_berger');
    expect(tiebreaksFor('cricket')).toContain('nrr');
  });
});

describe('BUILD 4.2 · the new criteria rank the table', () => {
  test('set ratio: level on points and set difference, the better ratio goes first (the old order had the more sets won first)', () => {
    // A: 6 sets for, 3 against (+3, ratio 2). B: 5 for, 2 against (+3, ratio 2.5).
    const ms = [done('A', 'X', 'A', 3, 0), done('A', 'Y', 'Y', 0, 3), done('A', 'Z', 'A', 3, 0), done('B', 'X', 'B', 2, 0), done('B', 'Y', 'Y', 1, 2), done('B', 'Z', 'B', 2, 0)];
    const ids = ['A', 'B', 'X', 'Y', 'Z'];
    const byRatio = rankTeams(ids, ms, ['score_ratio'], DEFAULT_POINTS);
    expect(byRatio.indexOf('B')).toBeLessThan(byRatio.indexOf('A'));
    const standard = rankTeams(ids, ms, [], DEFAULT_POINTS);
    expect(standard.indexOf('A')).toBeLessThan(standard.indexOf('B'));
  });
  test('an unknown name used to be skipped silently — the ladder still ignores stored junk, but it can no longer be saved', () => {
    expect(buildOrder(['coin_toss'])).toEqual(buildOrder([]));
  });
  test('Buchholz: level on everything else, the one who met the stronger field goes first (the old order fell to the team id)', () => {
    // P2 and P1 each 1½ of 2, same scores. P2 met S (strong: 2 more wins) and W; P1 met W2 and W3.
    const ms = [
      done('P2', 'S', null, 0.5, 0.5), done('P2', 'W', 'P2', 1, 0),
      done('P1', 'W2', null, 0.5, 0.5), done('P1', 'W3', 'P1', 1, 0),
      done('S', 'W2', 'S', 1, 0), done('S', 'W3', 'S', 1, 0),
    ];
    const ids = ['P1', 'P2', 'S', 'W', 'W2', 'W3'];
    const r = rankTeams(ids, ms, ['buchholz'], CHESS_POINTS);
    expect(r.indexOf('P2')).toBeLessThan(r.indexOf('P1'));
  });
  test('Sonneborn-Berger: level on points, beating the stronger player counts more', () => {
    // A beat S (who has 1 elsewhere) and lost to W; B beat W and lost to S. Both 1 point.
    const ms = [done('A', 'S', 'A', 1, 0), done('A', 'W', 'W', 0, 1), done('B', 'W', 'B', 1, 0), done('B', 'S', 'S', 0, 1), done('S', 'X', 'S', 1, 0)];
    const ids = ['A', 'B', 'S', 'W', 'X'];
    const r = rankTeams(ids, ms, ['sonneborn_berger'], CHESS_POINTS);
    // A's SB = S's points (2) ; B's SB = W's points (1)
    expect(r.indexOf('A')).toBeLessThan(r.indexOf('B'));
  });
});

describe('BUILD 4.2 · create and edit', () => {
  const tBody = { sport_id: 'sp', name: 'P3 Tiebreaks', format: 'league', max_teams: 4, entry_fee: 0, start_date: '2026-10-05' };
  test('create stores canonical names; a bad one → 400, nothing inserted', async () => {
    mockSportSlug = 'football';
    mockLog = [];
    mockNext = (q) => (q[0] === 'from:tournaments' && has(q, 'insert:') ? { data: { id: T } } : { data: null });
    expect((await run(createTournament, { body: { ...tBody, tiebreaker_rules: ['gd', 'h2h'] } })).statusCode).toBeLessThan(300);
    expect(written('tournaments', 'insert')[0].tiebreaker_rules).toEqual(['score_diff', 'head_to_head']);
    mockLog = [];
    const bad = await run(createTournament, { body: { ...tBody, tiebreaker_rules: ['toss'] } });
    expect([bad.statusCode, bad.body.code]).toEqual([400, 'INVALID_TIEBREAKS']);
    expect(mockLog.some((x) => has(x, 'insert:'))).toBe(false);
  });
  const row = { id: T, created_by: 'me', status: 'live', format: 'league', fixtures_generated: true, sport_id: 'sp', settings: null, tiebreaker_rules: ['head_to_head'] };
  test('edit before a result is stored; after one → 409 TIEBREAKS_LOCKED; the same order again is fine', async () => {
    mockSportSlug = 'football';
    mockLog = [];
    mockNext = (q) => (q[0] === 'from:tournaments' ? { data: row } : q[0] === 'from:matches' ? { count: 0 } : { data: null });
    expect((await run(updateTournament, { body: { tiebreaker_rules: ['wins'] } })).statusCode).toBe(200);
    expect(written('tournaments', 'update').find((u) => u.tiebreaker_rules)?.tiebreaker_rules).toEqual(['wins']);
    mockNext = (q) => (q[0] === 'from:tournaments' ? { data: row } : q[0] === 'from:matches' ? { count: 3 } : { data: null });
    const locked = await run(updateTournament, { body: { tiebreaker_rules: ['wins'] } });
    expect([locked.statusCode, locked.body.code]).toEqual([409, 'TIEBREAKS_LOCKED']);
    expect((await run(updateTournament, { body: { tiebreaker_rules: ['h2h'] } })).statusCode).toBe(200);
  });
});
