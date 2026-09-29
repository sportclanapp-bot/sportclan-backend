/**
 * BUILD 1.1 · a match's format and overs are fixed once it has started.
 * PATCH /matches/:id accepted format/overs on live and finished matches, which
 * re-decided the match (best-of, overs, time control) on the next recompute.
 */
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
let mockBlocked = new Set<string>();
jest.mock('../utils/blocks', () => ({ ...jest.requireActual('../utils/blocks'), blockedUserIds: jest.fn(async () => mockBlocked) }));
jest.mock('../utils/tournamentAuth', () => ({
  ...jest.requireActual('../utils/tournamentAuth'),
  canOfficiateMatch: jest.fn(async () => true),
  isTournamentOrganiser: jest.fn(async () => true),
}));
jest.mock('../utils/scoringLease', () => ({
  ...jest.requireActual('../utils/scoringLease'),
  checkLease: jest.fn(async () => ({ ok: true })),
  claimLease: jest.fn(async () => ({ taken: true, lease: null })),
  takeOverLease: jest.fn(async () => ({ ok: true, lease: null })),
}));
let mockPending = false;
jest.mock('../utils/singles', () => ({
  ...jest.requireActual('../utils/singles'),
  pendingRankedOpponent: jest.fn(async () => ({ pending: mockPending, opponentName: 'QA Device B' })),
}));
jest.mock('../utils/sportCache', () => ({
  ...jest.requireActual('../utils/sportCache'),
  getSport: jest.fn(async () => ({ slug: 'cricket' })),
}));
jest.mock('../utils/sportId', () => ({ resolveSportId: jest.fn(async (s?: string) => (s === 'cricket' ? 'sport-cricket' : undefined)) }));
jest.mock('../utils/notify', () => ({
  notifyUser: jest.fn(), notifyUsers: jest.fn(), notifyUnlessBlocked: jest.fn(),
  matchAudienceIds: jest.fn(async () => []), matchFollowerIds: jest.fn(async () => []),
}));

// eslint-disable-next-line import/first
import { updateMatch } from '../controllers/matches.controller';

const ME = '11111111-1111-4111-8111-111111111111';
const MATCH = '22222222-2222-4222-8222-222222222222';
const call = async (body: object) => {
  const r: any = { statusCode: 200, body: null, setHeader: jest.fn() };
  r.status = jest.fn((c: number) => { r.statusCode = c; return r; });
  r.json = jest.fn((b: unknown) => { r.body = b; return r; });
  await updateMatch({ userId: ME, params: { id: MATCH }, query: {}, body, headers: {}, get: () => undefined, header: () => undefined } as any, r);
  return r;
};
const writes = () => mockLog.filter((q) => q.some((c) => /^(insert|update|upsert|delete):/.test(c)));
const row = (status: string, sport = 'cricket') => ({
  id: MATCH, created_by: ME, umpire_id: null, status, team_a_id: null, team_b_id: null, tournament_id: null,
  sport_id: `sport-${sport}`, is_open: false, format: sport === 'cricket' ? 'T20' : 'bo3', overs: sport === 'cricket' ? 20 : null,
  team_a_name: 'A', team_b_name: 'B',
});
beforeEach(() => { mockLog = []; });

describe('format / overs lock once the match starts', () => {
  test.each(['live', 'completed', 'abandoned'])('%s cricket match: overs → 409 RULES_LOCKED, nothing written', async (status) => {
    mockNext = (q) => (q[0] === 'from:matches' ? { data: row(status) } : { data: null });
    const r = await call({ overs: 10, format: 'T10' });
    expect([r.statusCode, r.body.code]).toEqual([409, 'RULES_LOCKED']);
    expect(writes()).toHaveLength(0);
  });
  test('live best-of match: format → 409', async () => {
    mockNext = (q) => (q[0] === 'from:matches' ? { data: row('live', 'badminton') } : { data: null });
    const r = await call({ format: 'bo1' });
    expect([r.statusCode, r.body.code]).toEqual([409, 'RULES_LOCKED']);
  });
  test('a scheduled match can still change its overs', async () => {
    mockNext = (q) => (q[0] === 'from:matches' ? { data: row('scheduled') } : { data: null });
    const r = await call({ overs: 10, format: 'T10' });
    expect(r.statusCode).toBe(200);
    expect(writes()[0]!.join()).toContain('"overs":10');
  });
  test('a live match can still change its venue', async () => {
    mockNext = (q) => (q[0] === 'from:matches' ? { data: row('live') } : { data: null });
    const r = await call({ venue: 'Oval Maidan' });
    expect(r.statusCode).toBe(200);
  });
});
