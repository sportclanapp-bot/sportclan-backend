/**
 * Phase 4 · K1 (backend fix commits) — tournament lifecycle fixes from July:
 * SC-86 no phantom champion, SC-87 re-record cascade, SC-88 withdrawal walkover,
 * SC-89 one shared ranking ladder, SC-99 registration closes at the draw.
 * Harness copied from phase3TournamentsB08.
 */
import fs from 'fs';
import path from 'path';

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
jest.mock('../utils/notify', () => ({
  notifyUser: jest.fn(), notifyUsers: jest.fn(), notifyUnlessBlocked: jest.fn(), sendPushToUsers: jest.fn(), allowedRecipients: jest.fn(async () => []),
  matchAudienceIds: jest.fn(async () => []), matchFollowerIds: jest.fn(async () => []),
}));
let mockManager = false;
jest.mock('../utils/teamAuth', () => ({ ...jest.requireActual('../utils/teamAuth'), isTeamManager: jest.fn(async () => mockManager) }));

// eslint-disable-next-line import/first
import {
  directAddTeam, createEntry, updateEntry, updateTournament, advanceTournamentWinner,
} from '../controllers/tournaments.controller';

const ME = '11111111-1111-4111-8111-111111111111';
const T = '22222222-2222-4222-8222-222222222222';
const TEAM = '33333333-3333-4333-8333-333333333333';
const FIX = '66666666-6666-4666-8666-666666666666';
const NEXT = '77777777-7777-4777-8777-777777777777';
const res = () => {
  const r: any = { statusCode: 200, body: null, setHeader: jest.fn(), once: jest.fn() };
  r.status = jest.fn((c: number) => { r.statusCode = c; return r; });
  r.json = jest.fn((b: unknown) => { r.body = b; return r; });
  return r;
};
const call = async (fn: any, req: object) => {
  const r = res();
  await fn({ userId: ME, params: { id: T }, query: {}, body: {}, ...req }, r);
  return r;
};
const writes = () => mockLog.filter((q) => q.some((c) => /^(insert|update|upsert|delete):/.test(c)));
const has = (q: Q, s: string) => q.some((c) => c.includes(s));
const STRANGER = '55555555-5555-4555-8555-555555555555';
const TB = '44444444-4444-4444-8444-444444444444';
const updatesOf = (tbl: string) => mockLog.filter((q) => q[0] === `from:${tbl}` && q.some((c) => c.startsWith('update:')));

beforeEach(() => { mockLog = []; mockNext = () => ({ data: null, error: null }); mockManager = false; });

describe('SC-86 · no champion while matches are unplayed', () => {
  const final = { id: FIX, tournament_id: T, winner_team_id: TEAM, next_match_id: null, round: 2, group_label: null, team_a_id: TEAM, team_b_id: TB, team_a_name: 'A', team_b_name: 'B' };
  const world = (unplayed: number) => (q: Q) => {
    if (q[0] === 'from:matches' && has(q, '"head":true')) return { count: unplayed };
    if (q[0] === 'from:matches') return { data: final };
    if (q[0] === 'from:tournaments' && has(q, 'select:["format"]')) return { data: { format: 'knockout' } };
    return { data: null };
  };
  test('K1-69a (c8b15a9): the final recorded before a semi does not complete the tournament', async () => {
    mockNext = world(1);
    await advanceTournamentWinner(FIX);
    expect(updatesOf('tournaments')).toHaveLength(0);
  });
  test('K1-69a (c8b15a9): control — the whole bracket played → crowned', async () => {
    mockNext = world(0);
    await advanceTournamentWinner(FIX);
    expect(updatesOf('tournaments')[0].join()).toContain('"status":"completed"');
  });
  test('K1-69b (c8b15a9): PATCH status completed with unplayed matches → 409 TOURNAMENT_INCOMPLETE', async () => {
    mockNext = (q) => {
      if (q[0] === 'from:tournaments') return { data: { id: T, created_by: ME, status: 'live', name: 'P3 Cup', start_date: null, end_date: null, venue: null } };
      if (q[0] === 'from:matches' && has(q, '"head":true')) return { count: 2 };
      return { data: null };
    };
    const r = await call(updateTournament, { body: { status: 'completed' } });
    expect([r.statusCode, r.body.code]).toEqual([409, 'TOURNAMENT_INCOMPLETE']);
    expect(updatesOf('tournaments')).toHaveLength(0);
  });
});

describe('SC-87 · a re-recorded result replaces the team already advanced', () => {
  const semi = { id: FIX, tournament_id: T, winner_team_id: TB, next_match_id: NEXT, next_slot: 'A', round: 1, group_label: null, team_a_id: TEAM, team_b_id: TB, team_a_name: 'A', team_b_name: 'B' };
  const world = (childStatus: string) => (q: Q) => {
    if (q[0] === 'from:matches' && has(q, `eq:["id","${FIX}"]`)) return { data: semi };
    if (q[0] === 'from:matches' && has(q, `eq:["id","${NEXT}"]`)) return { data: { id: NEXT, team_a_id: TEAM, status: childStatus } };
    if (q[0] === 'from:tournaments') return { data: { format: 'knockout' } };
    return { data: null };
  };
  test('K1-70 (6b79668): child still scheduled → its slot is overwritten with the new winner', async () => {
    mockNext = world('scheduled');
    await advanceTournamentWinner(FIX);
    const w = updatesOf('matches');
    expect(w).toHaveLength(1);
    expect(w[0].join()).toContain(`"team_a_id":"${TB}"`);
    expect(w[0].join()).toContain(`eq:["id","${NEXT}"]`);
  });
  test('K1-70 (6b79668): child already started → frozen, nothing rewritten', async () => {
    mockNext = world('live');
    await advanceTournamentWinner(FIX);
    expect(updatesOf('matches')).toHaveLength(0);
  });
});

describe('SC-88 · a mid-bracket withdrawal walks the opponent over', () => {
  const world = (q: Q) => {
    if (q[0] === 'from:tournament_entries' && has(q, 'update:')) return { data: { id: 'e1', status: 'withdrawn' } };
    if (q[0] === 'from:tournament_entries' && has(q, `eq:["team_id","${TB}"]`)) return { data: { status: 'approved' } };
    if (q[0] === 'from:tournament_entries') return { data: { id: 'e1', tournament_id: T, team_id: TEAM, status: 'approved' } };
    if (q[0] === 'from:tournaments') return { data: { id: T, name: 'P3 Cup', status: 'live', fixtures_generated: true, created_by: STRANGER, format: 'knockout' } };
    if (q[0] === 'from:matches' && has(q, 'or:')) return { data: [{ id: FIX, team_a_id: TEAM, team_b_id: TB, status: 'scheduled' }] };
    return { data: null };
  };
  test('K1-71 (d830567): the captain withdraws → the unplayed match is awarded to the opponent', async () => {
    mockManager = true;
    const { isTournamentOrganiser } = jest.requireMock('../utils/tournamentAuth');
    (isTournamentOrganiser as jest.Mock).mockResolvedValueOnce(false);
    mockNext = world;
    const r = await call(updateEntry, { params: { id: T, entryId: 'e1' }, body: { status: 'withdrawn' } });
    expect(r.statusCode).toBe(200);
    const walk = updatesOf('matches').find((q) => has(q, `eq:["id","${FIX}"]`))!;
    expect(walk.join()).toContain('"status":"abandoned"');
    expect(walk.join()).toContain(`"winner_team_id":"${TB}"`);
  });
  test('K1-71 (d830567): the organiser (not the captain) may withdraw a team too', async () => {
    mockManager = false;
    mockNext = world;
    const r = await call(updateEntry, { params: { id: T, entryId: 'e1' }, body: { status: 'withdrawn' } });
    expect(r.statusCode).toBe(200);
  });
});

describe('SC-89 · qualification and the table rank with the same ladder', () => {
  const code = (rel: string) => fs.readFileSync(path.join(__dirname, '..', rel), 'utf8');
  const body = (src: string, head: string) => { const i = src.indexOf(head); return src.slice(i, src.indexOf('\n}\n', i)); };
  test('K1-72b (9803959): maybeSeedKnockout and getTournamentStandings both call rankTeams', () => {
    expect(body(code('controllers/tournaments.controller.ts'), 'async function maybeSeedKnockout')).toMatch(/rankTeams\(/);
    // Stage 8 · F8: the same ladder, which also reports teams level on every tie-break.
    expect(body(code('controllers/features.controller.ts'), 'export async function getTournamentStandings')).toMatch(/rankTeams(Detailed)?\(/);
  });
});

describe('SC-99 · registration closes once the bracket is generated', () => {
  const world = (q: Q) => {
    if (q[0] === 'from:tournaments') return { data: { id: T, name: 'P3 Cup', status: 'upcoming', sport_id: 'sport-cricket', max_teams: 8, registration_deadline: null, fixtures_generated: true, created_by: ME } };
    if (q[0] === 'from:team_members') return { data: { role: 'captain' } };
    if (q[0] === 'from:teams') return { data: { id: TEAM, sport_id: 'sport-cricket' } };
    if (q[0] === 'from:tournament_entries') return { data: { id: 'e1', tournament_id: T, team_id: TEAM, status: 'pending' } };
    return { data: null };
  };
  test.each([
    ['organiser direct add', () => call(directAddTeam, { body: { team_id: TEAM } })],
    ['captain entry', () => call(createEntry, { body: { team_id: TEAM } })],
    ['approving a pending entry', () => call(updateEntry, { params: { id: T, entryId: 'e1' }, body: { status: 'approved' } })],
  ])('K1-76 (9951fc5): %s after the draw → 409 REGISTRATION_CLOSED, nothing written', async (_n, run) => {
    mockNext = world;
    const r = await run();
    expect([r.statusCode, r.body.code]).toEqual([409, 'REGISTRATION_CLOSED']);
    expect(writes()).toEqual([]);
  });
});
