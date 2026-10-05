/**
 * Cricket gap 6 (5 Oct 2026) · a walkover on any tournament fixture (a league
 * or group match too, not only a knockout abandoned on the pad), with the
 * walkover points and no NRR; and the walkover rule teams are told — grace
 * minutes and the fewest players — as tournament settings.
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
// eslint-disable-next-line import/first
import { computeStats } from '../utils/standings';

const storedSummary = () => {
  for (const q of writes()) {
    const u = q.find((c) => c.startsWith('update:'));
    const row = u ? (JSON.parse(u.slice('update:'.length)) as Array<{ score_summary?: unknown }>)[0] : null;
    if (row?.score_summary) return row.score_summary as Record<string, unknown>;
  }
  return null;
};

describe('a walkover on a league fixture', () => {
  test('the team that turned up wins "by walkover", with the reason kept and no score', async () => {
    setup();
    const r = await call({ walkover: true, winner_team_id: TB, winner_side: 'B', walkover_reason: 'Lions didn’t turn up' });
    expect(r.statusCode).toBe(200);
    expect(storedSummary()).toMatchObject({ walkover: true, walkover_reason: 'Lions didn’t turn up', result: 'Tigers won by walkover' });
  });
  test('it still needs the winner', async () => {
    setup();
    // Refused (on a scheduled fixture the not-started guard answers first) and nothing written.
    expect((await call({ walkover: true })).statusCode).toBe(400);
    expect(writes()).toHaveLength(0);
  });
  test('the table: walkover points from the template, no NRR', () => {
    const m = { id: 'w', team_a_id: TA, team_b_id: TB, winner_team_id: TB, status: 'completed', voided_at: null, overs: 10, score_summary: { walkover: true } };
    const t = computeStats([TA, TB], [m as never], undefined, { win: 2, draw: 1, loss: 0, walkoverWin: 2, walkoverLoss: -1 } as never);
    expect(t.get(TB)).toMatchObject({ won: 1, points: 2, nrr: null });
    expect(t.get(TA)).toMatchObject({ lost: 1, points: -1, nrr: null });
  });
});

describe('the walkover rule in settings', () => {
  test('grace 5–60 min, fewest players 2–15; 0 clears; anything else refused', () => {
    expect(settingsRefusal('cricket', 'league', { graceMinutes: 15, minPlayers: 7 })).toBeNull();
    expect(settingsRefusal('cricket', 'league', { graceMinutes: 0, minPlayers: 0 })).toBeNull();
    expect(settingsRefusal('cricket', 'league', { graceMinutes: 4 })?.error).toBe('The grace time must be 5 to 60 minutes.');
    expect(settingsRefusal('cricket', 'league', { graceMinutes: 15.5 })?.error).toBe('The grace time must be 5 to 60 minutes.');
    expect(settingsRefusal('cricket', 'league', { minPlayers: 16 })?.error).toBe('The fewest players a team can play with must be 2 to 15.');
    const s = storedSettings({ graceMinutes: 15, minPlayers: 7 }, { v: 1, restMinutes: 30 });
    expect(s).toEqual({ v: 1, restMinutes: 30, graceMinutes: 15, minPlayers: 7 });
    expect(storedSettings({ graceMinutes: 0 }, s)).toEqual({ v: 1, restMinutes: 30, minPlayers: 7 });
  });
});
