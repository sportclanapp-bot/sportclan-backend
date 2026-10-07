/**
 * Stage 9 · T9 · a default ("def."): the referee, umpire or organiser
 * defaults a side during play — the other side wins with the score as it
 * stood (rated, like a retirement); a scorer can't. And the ladder as a rule,
 * the timeline's violation line.
 */
type Q = string[];
let mockLog: Q[] = [];
let mockNext: (q: Q) => { data?: unknown; error?: unknown; count?: number } = () => ({ data: null, error: null });
const mockRpc = jest.fn(async (..._a: unknown[]): Promise<any> => ({ data: null, error: null }));
jest.mock('../utils/supabase', () => {
  const start = (t: string) => {
    const q: string[] = [`from:${t}`];
    mockLog.push(q);
    const chain: any = {};
    for (const m of ['select', 'in', 'not', 'eq', 'neq', 'is', 'limit', 'maybeSingle', 'single', 'update', 'delete', 'order', 'or', 'ilike', 'range', 'gte', 'gt', 'lt', 'lte', 'upsert']) {
      chain[m] = jest.fn((...a: unknown[]) => { q.push(`${m}:${JSON.stringify(a)}`); return chain; });
    }
    chain.insert = jest.fn((row: unknown) => { q.push(`insert:${JSON.stringify(row)}`); return chain; });
    chain.then = (ok: (v: unknown) => unknown, bad?: (e: unknown) => unknown) => {
      try { return Promise.resolve(ok({ data: null, error: null, ...mockNext(q) })); } catch (e) { return bad ? bad(e) : Promise.reject(e); }
    };
    return chain;
  };
  return { supabase: { from: jest.fn(start), rpc: (...a: unknown[]) => mockRpc(...a) } };
});
let mockBlocked = new Set<string>();
jest.mock('../utils/blocks', () => ({ ...jest.requireActual('../utils/blocks'), blockedUserIds: jest.fn(async () => mockBlocked) }));
let mockOrganiser = false;
let mockMayDefault = true;
jest.mock('../utils/tournamentAuth', () => ({
  ...jest.requireActual('../utils/tournamentAuth'),
  canOfficiateMatch: jest.fn(async () => true),
  isTournamentOrganiser: jest.fn(async () => mockOrganiser),
  canDefault: jest.fn(async () => mockMayDefault),
}));
jest.mock('../utils/scoringLease', () => ({
  ...jest.requireActual('../utils/scoringLease'),
  checkLease: jest.fn(async () => ({ ok: true })),
}));
jest.mock('../utils/singles', () => ({
  ...jest.requireActual('../utils/singles'),
  pendingRankedOpponent: jest.fn(async () => ({ pending: false, opponentName: null })),
}));
let mockSport: Record<string, unknown> = { slug: 'badminton', allows_draw: false };
jest.mock('../utils/sportCache', () => ({
  ...jest.requireActual('../utils/sportCache'),
  getSport: jest.fn(async () => mockSport),
}));
jest.mock('../utils/testContent', () => ({
  ...jest.requireActual('../utils/testContent'),
  hideTestFor: jest.fn(async () => false),
}));
const mockNotify = jest.fn(async (..._a: unknown[]) => undefined);
jest.mock('../utils/notify', () => ({
  ...jest.requireActual('../utils/notify'),
  notifyUsers: (...a: unknown[]) => mockNotify(...a),
  notifyUser: jest.fn(async () => undefined),
}));

jest.mock('../controllers/tournaments.controller', () => ({
  ...jest.requireActual('../controllers/tournaments.controller'),
  advanceTournamentWinner: jest.fn(async () => undefined),
  recrownAfterVoidChange: jest.fn(async () => undefined),
}));
// eslint-disable-next-line import/first
import { completeMatch } from '../controllers/matches.controller';

const ME = '11111111-1111-4111-8111-111111111111';
const MATCH = '22222222-2222-4222-8222-222222222222';
const TA = '44444444-4444-4444-8444-444444444444';
const TB = '55555555-5555-4555-8555-555555555555';
const call = async (body: object) => {
  const r: any = { statusCode: 200, body: null, setHeader: jest.fn() };
  r.status = jest.fn((c: number) => { r.statusCode = c; return r; });
  r.json = jest.fn((b: unknown) => { r.body = b; return r; });
  await completeMatch({ userId: ME, params: { id: MATCH }, query: {}, body, headers: {}, get: () => undefined, header: () => undefined } as any, r);
  return r;
};
const writes = () => mockLog.filter((q) => q.some((c) => /^(update|upsert):/.test(c)));
let events: unknown[] = [];
let format = 'round_robin';
let parts: unknown[] = [];
const setup = (extra: Record<string, unknown> = {}) => {
  mockNext = (q) => {
    if (q[0] === 'from:matches') {
      return { data: { id: MATCH, created_by: ME, umpire_id: null, status: 'scheduled', team_a_id: TA, team_b_id: TB, sport_id: 's',
        is_ranked: false, tournament_id: 'T', round: 1, next_match_id: null, group_label: null, team_a_name: 'Lions', team_b_name: 'Tigers',
        score_summary: {}, voided_at: null, format: 'T10', overs: 10, rules: { v: 1, style: 'limited', overs: 10, players: 11 }, toss_choice: null, ...extra } };
    }
    if (q[0] === 'from:tournaments') return { data: { format } };
    if (q[0] === 'from:match_events') return { data: events, count: events.length };
    if (q[0] === 'from:match_participants') return { data: parts };
    return { data: null };
  };
};
beforeEach(() => {
  mockLog = [];
  mockSport = { slug: 'cricket', allows_draw: true };
  format = 'round_robin';
  events = [];
  parts = [];
});
// eslint-disable-next-line import/first
import { settingsRefusal, storedSettings } from '../utils/tournamentSettings';

const storedSummary = () => {
  for (const q of writes()) {
    const u = q.find((c) => c.startsWith('update:'));
    const row = u ? (JSON.parse(u.slice('update:'.length)) as Array<{ score_summary?: unknown }>)[0] : null;
    if (row?.score_summary) return row.score_summary as Record<string, unknown>;
  }
  return null;
};
// eslint-disable-next-line import/first
import { rulesRefusal, standardRules, conductLadder } from '../utils/matchRules';
// eslint-disable-next-line import/first
import { sportCommentary } from '../utils/commentary';

const SCORE = { A: { sets: [6, 3] }, B: { sets: [4, 2] } };
describe('a default', () => {
  test('the other side wins; the score stays; the result says who was defaulted', async () => {
    mockSport = { slug: 'tennis', allows_draw: false };
    mockMayDefault = true;
    setup({ status: 'live', score_summary: SCORE, rules: { v: 1, bestOf: 3 }, format: null, overs: null });
    const r = await call({ defaulted: true, defaulted_team_id: TA, winner_team_id: TB, winner_side: 'B', walkover_reason: 'Unsportsmanlike conduct' });
    expect(r.statusCode).toBe(200);
    expect(storedSummary()).toMatchObject({ defaulted: { team_id: TA, side: 'A', reason: 'Unsportsmanlike conduct' }, result: 'Tigers won (Lions defaulted)' });
    const typed = writes().map((q) => q.find((c) => c.startsWith('update:'))).filter(Boolean).map((u) => JSON.parse(u!.slice(7))[0]).find((u) => u.result_type);
    expect(typed.result_type).toBe('default');
  });
  test('only the referee, umpire or organiser; a named side; while live', async () => {
    mockSport = { slug: 'tennis', allows_draw: false };
    setup({ status: 'live' });
    mockMayDefault = false;
    expect((await call({ defaulted: true, defaulted_team_id: TA, winner_team_id: TB })).body.code).toBe('NOT_REFEREE');
    mockMayDefault = true;
    expect((await call({ defaulted: true, winner_team_id: TB })).body.code).toBe('BAD_DEFAULT');
    setup({ status: 'scheduled' });
    expect((await call({ defaulted: true, defaulted_team_id: TA, winner_team_id: TB })).body.code).toBe('NOT_LIVE');
    expect(writes()).toHaveLength(0);
  });
});

test('the ladder as a rule: each sport’s standard, the organiser’s own, refusals', () => {
  expect(conductLadder('tennis', null)).toEqual(['warning', 'point', 'game', 'default']);
  expect(conductLadder('table-tennis', null)).toEqual(['warning', 'point', 'point2', 'default']);
  expect(conductLadder('badminton', { penaltyLadder: 'warning,default' })).toEqual(['warning', 'default']);
  expect(conductLadder('football', null)).toEqual([]);
  expect(rulesRefusal('tennis', { ...standardRules('tennis'), penaltyLadder: 'warning,default,point' })?.error).toMatch(/only be the last step/);
  expect(rulesRefusal('badminton', { ...standardRules('badminton'), penaltyLadder: 'warning,game' })?.error).toMatch(/isn’t a penalty here/);
  expect(rulesRefusal('football', { ...standardRules('football'), penaltyLadder: 'warning' })?.error).toMatch(/doesn’t apply to this sport/);
});

test('the timeline says the violation and its penalty', () => {
  const ctx = { sport: 'tennis', teamA: 'Lions', teamB: 'Tigers', period: 0, move: 0, clockSeconds: null, regulation: 2, periodMinutes: null } as never;
  expect(sportCommentary('note', { kind: 'violation', team_side: 'A', offence: 'abuse', penalty: 'point', player_name: 'Ravi' }, ctx)).toBe('⚠️ Code violation — Ravi (Lions) · racket or ball abuse · point penalty');
});
