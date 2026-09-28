/**
 * Phase 4 · D1 — match / tournament bugs from WORKING_NOTES fixed in feat
 * commits (not fix: commits). Harness as phase4K1F2RankedSingles: every from()
 * is its own query, resolved by mockNext(q) where q is its call log.
 *  SC-260 · SC-261 · SC-263 (4d27cff)  pickup join: notify, block gate, suggestions
 *  Z-2b (a60b7e1)                      an umpire restructured a tournament fixture
 *  Z-5a (86aaed4)                      a decisive sport completed with no winner
 *  SC-251 · SC-253 · SC-254 (2f8f488)  unranked fixtures, uncrowned champion, empty-lineup result
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
jest.mock('../utils/tournamentAuth', () => ({
  ...jest.requireActual('../utils/tournamentAuth'),
  canOfficiateMatch: jest.fn(async () => true),
  isTournamentOrganiser: jest.fn(async () => mockOrganiser),
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

// eslint-disable-next-line import/first
import fs from 'fs';
// eslint-disable-next-line import/first
import path from 'path';
// eslint-disable-next-line import/first
import { joinOpenMatch, listOpenMatches, updateMatch, completeMatch } from '../controllers/matches.controller';
// eslint-disable-next-line import/first
import { advanceTournamentWinner } from '../controllers/tournaments.controller';

const ME = '11111111-1111-4111-8111-111111111111';
const MATCH = '22222222-2222-4222-8222-222222222222';
const CREATOR = '33333333-3333-4333-8333-333333333333';
const TA = '44444444-4444-4444-8444-444444444444';
const TB = '55555555-5555-4555-8555-555555555555';
const T = '66666666-6666-4666-8666-666666666666';
const res = () => {
  const r: any = { statusCode: 200, body: null, setHeader: jest.fn() };
  r.status = jest.fn((c: number) => { r.statusCode = c; return r; });
  r.json = jest.fn((b: unknown) => { r.body = b; return r; });
  return r;
};
const call = async (fn: any, req: object) => {
  const r = res();
  await fn({ userId: ME, params: { id: MATCH }, query: {}, body: {}, headers: { 'x-device-id': 'dev-1' }, get: () => 'dev-1', header: () => 'dev-1', ...req }, r);
  return r;
};
const has = (q: Q, s: string) => q.some((c) => c.includes(s));
const settle = async () => { for (let i = 0; i < 5; i++) await new Promise((r) => setTimeout(r, 0)); };
const src = (f: string) => fs.readFileSync(path.join(__dirname, '..', f), 'utf8');

beforeEach(() => {
  mockLog = [];
  mockNext = () => ({ data: null, error: null });
  mockBlocked = new Set();
  mockOrganiser = false;
  mockSport = { slug: 'badminton', allows_draw: false };
  mockRpc.mockReset();
  mockRpc.mockImplementation(async () => ({ data: null, error: null }));
  mockNotify.mockClear();
});

describe('open-match join (4d27cff)', () => {
  const openMatch = (q: Q) => {
    if (q[0] === 'from:matches' && has(q, 'join_policy')) return { data: { join_policy: 'open', status: 'scheduled' } };
    if (q[0] === 'from:matches') return { data: { created_by: CREATOR, sport_id: 's', team_a_name: 'A', team_b_name: 'B' } };
    if (q[0] === 'from:match_participants') return { data: [{ user_id: CREATOR }] };
    if (q[0] === 'from:users') return { data: { name: 'Me' } };
    return { data: null };
  };

  test('SC-261 (4d27cff): a user blocked with the creator cannot join — refused before the join RPC', async () => {
    mockBlocked = new Set([CREATOR]);
    mockNext = openMatch;
    const r = await call(joinOpenMatch, {});
    expect([r.statusCode, r.body.code]).toEqual([403, 'BLOCKED_FROM_MATCH']);
    expect(mockRpc).not.toHaveBeenCalled();
  });

  test('SC-260 (4d27cff): a successful join tells the organiser', async () => {
    mockNext = openMatch;
    mockRpc.mockImplementation(async () => ({ data: [{ status: 'joined', players_needed: 1 }], error: null }));
    const r = await call(joinOpenMatch, {});
    await settle();
    expect(r.body).toEqual({ success: true, players_needed: 1 });
    expect(mockNotify).toHaveBeenCalledWith([CREATOR], expect.objectContaining({ type: 'match_joined' }), { actorId: ME });
  });

  test('SC-263 (4d27cff): suggestions leave out your own, full and already-joined matches', async () => {
    mockNext = (q) => {
      if (q[0] === 'from:match_participants') return { data: [{ match_id: 'joined-1' }] };
      if (q[0] === 'from:matches') return { data: [] };
      return { data: null };
    };
    await call(listOpenMatches, {});
    const list = mockLog.find((q) => q[0] === 'from:matches' && has(q, 'is_open'))!;
    expect(list).toContain(`neq:["created_by","${ME}"]`);
    expect(list).toContain('gt:["players_needed",0]');
    expect(list).toContain('not:["id","in","(joined-1)"]');
  });
});

describe('tournament fixtures', () => {
  test('Z-2b (a60b7e1): the assigned umpire cannot reschedule or re-team a tournament fixture', async () => {
    mockNext = (q) => (q[0] === 'from:matches'
      ? { data: { created_by: CREATOR, umpire_id: ME, status: 'scheduled', tournament_id: T } }
      : { data: null });
    const r = await call(updateMatch, { body: { scheduled_at: '2099-01-01T10:00:00Z' } });
    expect([r.statusCode, r.body.error]).toEqual([403, 'Only the tournament organiser can change a tournament fixture.']);
    expect(mockLog.some((q) => has(q, 'update:'))).toBe(false);
  });

  test('SC-251 (2f8f488): every fixture-generation path creates ranked matches', () => {
    const t = src('controllers/tournaments.controller.ts');
    // knockout bracket rows (built by the bracket helper), round-robin / league, and group stage
    expect((t.match(/^\s*is_ranked: true,/gm) ?? []).length).toBeGreaterThanOrEqual(3);
  });

  test('SC-253 (2f8f488): the final crowns the champion and announces it, once', async () => {
    mockNext = (q) => {
      if (q[0] === 'from:matches' && has(q, 'select:["id, tournament_id')) {
        return { data: { id: MATCH, tournament_id: T, winner_team_id: TA, next_match_id: null, round: 2, team_a_id: TA, team_b_id: TB, team_a_name: 'Kings', team_b_name: 'Lions' } };
      }
      if (q[0] === 'from:tournaments' && has(q, 'select:["format"]')) return { data: { format: 'knockout' } };
      if (q[0] === 'from:tournaments' && has(q, '"champion_team_id"')) return { data: { id: T, name: 'Cup' } };
      if (q[0] === 'from:matches') return { count: 0, data: [] };
      if (q[0] === 'from:tournament_entries') return { data: [{ team_id: TA }, { team_id: TB }] };
      if (q[0] === 'from:team_members') return { data: [{ user_id: ME, team_id: TA }, { user_id: CREATOR, team_id: TB }] };
      return { data: null };
    };
    await advanceTournamentWinner(MATCH);
    const crown = mockLog.find((q) => q[0] === 'from:tournaments' && has(q, '"champion_team_id"'))!;
    expect(crown.join()).toContain(`"champion_team_id":"${TA}"`);
    expect(mockNotify).toHaveBeenCalledWith([ME], expect.objectContaining({ type: 'tournament_champion' }));
    expect(mockNotify).toHaveBeenCalledWith([CREATOR], expect.objectContaining({ type: 'tournament_champion' }));
  });
});

describe('completing a match', () => {
  const liveMatch = (extra: object = {}) => ({
    id: MATCH, created_by: ME, umpire_id: null, status: 'live', team_a_id: TA, team_b_id: TB, sport_id: 's',
    is_ranked: false, tournament_id: null, team_a_name: 'Kings', team_b_name: 'Lions', score_summary: {}, voided_at: null, ...extra,
  });
  const on = (match: object, parts: unknown[] = []) => (q: Q) => {
    if (q[0] === 'from:matches') return { data: match };
    if (q[0] === 'from:match_participants') return { data: parts };
    if (q[0] === 'from:match_events') return { data: [], count: 1 };
    return { data: null };
  };

  test('Z-5a (86aaed4): a decisive sport (allows_draw = false) cannot be completed without a winner', async () => {
    mockNext = on(liveMatch());
    const r = await call(completeMatch, { body: {} });
    expect([r.statusCode, r.body.code]).toEqual([400, 'NEEDS_DECISIVE_WINNER']);
  });

  test('SC-254 (2f8f488): a walkover must name the winner', async () => {
    mockNext = on(liveMatch());
    const r = await call(completeMatch, { body: { walkover: true } });
    expect([r.statusCode, r.body.error]).toEqual([400, 'A walkover needs a winning team.']);
  });

  test('SC-254 (2f8f488): a ranked result with an empty line-up is refused unless it is a walkover', async () => {
    mockSport = { slug: 'cricket', allows_draw: true };
    mockNext = on(liveMatch({ is_ranked: true }), []);
    const played = await call(completeMatch, { body: { winner_team_id: TA } });
    expect(played.statusCode).toBe(400);
    expect(String(played.body.error)).toMatch(/lineup/i);
  });
});
