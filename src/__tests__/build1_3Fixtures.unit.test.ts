/**
 * BUILD 1.3 · tournament cricket fixtures carry their overs (T20, 20), so NRR
 * knows the quota; other sports' fixtures are unchanged.
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

// eslint-disable-next-line import/first
import { generateFixtures } from '../controllers/tournaments.controller';
const T = '22222222-2222-4222-8222-222222222222';
const has = (q: Q, s: string) => q.some((c) => c.startsWith(s));
const call = async () => {
  const r: any = { statusCode: 200, body: null, setHeader: jest.fn() };
  r.status = jest.fn((c: number) => { r.statusCode = c; return r; });
  r.json = jest.fn((b: unknown) => { r.body = b; return r; });
  await generateFixtures({ userId: 'me', params: { id: T }, query: {}, body: {} } as any, r);
  return r;
};
const inserted = () => mockLog.filter((q) => q[0] === 'from:matches' && has(q, 'insert:')).flatMap((q) => q.filter((c) => c.startsWith('insert:')).map((c) => JSON.parse(c.slice(7))));
const setup = (format: string) => {
  mockLog = [];
  mockNext = (q) => {
    if (q[0] === 'from:tournaments' && has(q, 'update:')) return { data: [{ id: T }] };
    if (q[0] === 'from:tournaments') return { data: { id: T, status: 'upcoming', sport_id: 'sp', format, start_date: '2026-10-05' } };
    if (q[0] === 'from:tournament_entries') return { data: ['a', 'b', 'c', 'd'].map((id) => ({ team_id: id, team: { id, name: id } })) };
    if (q[0] === 'from:matches' && has(q, 'insert:')) return { data: [{ id: 'm1' }] };
    return { data: [] };
  };
};
describe('fixtures carry cricket overs', () => {
  test.each(['knockout', 'round_robin', 'league', 'groups_knockout'])('%s: every cricket fixture is T20 / 20 overs', async (format) => {
    mockSportSlug = 'cricket';
    setup(format);
    const r = await call();
    expect(r.statusCode).toBe(200);
    const rows = inserted().flat();
    expect(rows.length).toBeGreaterThan(0);
    for (const row of rows) expect([row.format, row.overs]).toEqual(['T20', 20]);
    // BUILD 2.1: and their rules as data.
    for (const row of rows) expect(row.rules).toEqual({ v: 1, style: 'limited', overs: 20, players: null, lastManStands: false, retireAt: null, bowlerOvers: null, extraRuns: 1, rebowl: true, freeHit: false, inningsMinutes: null, powerplayOvers: null, oneTipOneHand: false, sixAndOut: false, noLbw: false, drawAllowed: true, tie: null });
  });
  test('a football fixture gets no overs', async () => {
    mockSportSlug = 'football';
    setup('round_robin');
    await call();
    for (const row of inserted().flat()) expect(row.overs).toBeUndefined();
    for (const row of inserted().flat()) expect(row.rules).toEqual({ v: 1, players: null, periods: 2, periodMinutes: null, halfTimeMinutes: null, penaltyKicks: 5, extraTimeMinutes: 0, walkoverGoals: 3, rollingSubs: false, offside: true, sinBinMinutes: null, drawAllowed: true, maxSubs: null, subWindows: null, goldenGoal: false, minOnPitch: null, subsPer: 'match', reentry: 'free', tie: null, shootoutSameTakers: null }); // Stage 15 · BB6: no series · Stage 16 · HK7 · Stage 8: four new fields, none set · Stage 14 · VB2: subs counted a match, free re-entry (as before)
  });
});
