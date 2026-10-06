/**
 * Phase 3 · B08 Tournaments (28 Sep 2026) — the backend fixes. See the app
 * repo's phase3/B08.md for each finding. Supabase is mocked: every `from()`
 * starts its own query, and each resolves to `mockNext(q)`, where `q` lists that
 * query's builder calls. `mockLog` keeps every query in order.
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

// eslint-disable-next-line import/first
import {
  joinByCode, createEntry, directAddTeam, updateEntry, updateTournament, createTournament, listTournaments,
  generateFixtures, advanceTournamentWinner, updateFixtures, getTournamentChat,
} from '../controllers/tournaments.controller';
// eslint-disable-next-line import/first
import { addTournamentOfficial, getTournamentOfficials, getTournamentAnalytics } from '../controllers/features.controller';
// eslint-disable-next-line import/first
import { tournamentNameRefusal, tournamentDetailsRefusal, listStatusFilter } from '../utils/tournamentRules';
// eslint-disable-next-line import/first
import { notifyUnlessBlocked } from '../utils/notify';

const ME = '11111111-1111-4111-8111-111111111111';
const T = '22222222-2222-4222-8222-222222222222';
const TEAM = '33333333-3333-4333-8333-333333333333';
const TB = '44444444-4444-4444-8444-444444444444';
const STRANGER = '55555555-5555-4555-8555-555555555555';
const FIX = '66666666-6666-4666-8666-666666666666';
const NEXT = '77777777-7777-4777-8777-777777777777';
const CRICKET = 'sport-cricket';
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

/** A tournament world: the tournament row, the entering team, entry counts, roster. */
function world(o: {
  t?: Record<string, unknown> | null;
  team?: Record<string, unknown> | null;
  count?: number;
  role?: string;
  overlap?: boolean;
  existing?: unknown;
} = {}) {
  const t = o.t === null ? null : { id: T, name: 'P3 Cup', status: 'upcoming', sport_id: CRICKET, max_teams: 4, registration_deadline: null, fixtures_generated: false, created_by: STRANGER, ...(o.t ?? {}) };
  const team = o.team === null ? null : { id: TEAM, sport_id: CRICKET, name: 'P3 XI', ...(o.team ?? {}) };
  return (q: Q) => {
    const tbl = q[0];
    if (tbl === 'from:tournaments') return { data: has(q, 'select:["id"]') && has(q, 'entry_code') ? (t ? { id: T } : null) : t };
    if (tbl === 'from:teams') return { data: team };
    if (tbl === 'from:sports') return { data: { name: 'Cricket' } };
    if (tbl === 'from:team_members') {
      if (has(q, 'select:["role"]')) return { data: { role: o.role ?? 'captain' } };
      if (has(q, '"team_id",["')) return { data: o.overlap ? { team_id: TB } : null }; // the overlap probe
      return { data: [{ user_id: ME }] };
    }
    if (tbl === 'from:tournament_entries') {
      if (has(q, '{"count":"exact","head":true}')) return { count: o.count ?? 0 };
      if (has(q, 'update:')) return { data: null };
      if (has(q, 'insert:')) return { data: { id: 'entry-1', tournament_id: T, team_id: TEAM, status: 'pending' } };
      if (has(q, 'select:["team_id"]')) return { data: o.overlap ? [{ team_id: TB }] : [] };
      return { data: o.existing ?? null };
    }
    return { data: null };
  };
}

beforeEach(() => {
  mockLog = [];
  mockNext = () => ({ data: null, error: null });
  mockCanOpenChat = false;
  (notifyUnlessBlocked as jest.Mock).mockClear();
});

describe('F2 · the join code runs every entry rule', () => {
  const join = (body: object = { entry_code: 'abc234', team_id: TEAM }) => call(joinByCode, { params: {}, body });
  test('after the draw → 409 REGISTRATION_CLOSED, nothing inserted', async () => {
    mockNext = world({ t: { fixtures_generated: true } });
    const r = await join();
    expect([r.statusCode, r.body.code]).toEqual([409, 'REGISTRATION_CLOSED']);
    expect(writes()).toEqual([]);
  });
  test('full (pending requests hold a place) → 400 TOURNAMENT_FULL', async () => {
    mockNext = world({ count: 4 });
    const r = await join();
    expect([r.statusCode, r.body.code]).toEqual([400, 'TOURNAMENT_FULL']);
    expect(mockLog.some((q) => q[0] === 'from:tournament_entries' && has(q, 'in:["status",["pending","approved"]]'))).toBe(true);
  });
  test('a player already on another entered team → 409 ROSTER_OVERLAP', async () => {
    mockNext = world({ overlap: true });
    expect((await join()).body.code).toBe('ROSTER_OVERLAP');
  });
  test('F4 · a cancelled tournament → 409 TOURNAMENT_FINISHED', async () => {
    mockNext = world({ t: { status: 'cancelled' } });
    const r = await join();
    expect([r.statusCode, r.body]).toEqual([409, { error: 'This tournament was cancelled.', code: 'TOURNAMENT_FINISHED' }]);
  });
  test('F9 · a badminton team into a cricket cup → 400 WRONG_SPORT, in words', async () => {
    mockNext = world({ team: { sport_id: 'sport-badminton' } });
    const r = await join();
    expect([r.statusCode, r.body]).toEqual([400, { error: 'This is a cricket tournament — enter a cricket team.', code: 'WRONG_SPORT' }]);
  });
  test('the code is matched in capitals; success notifies the organiser and names the tournament', async () => {
    mockNext = world();
    const r = await join();
    expect(r.statusCode).toBe(200);
    expect(r.body.tournament_id).toBe(T);
    expect(r.body.entry.status).toBe('pending');
    expect(mockLog.some((q) => q[0] === 'from:tournaments' && has(q, 'eq:["entry_code","ABC234"]'))).toBe(true);
    expect(notifyUnlessBlocked).toHaveBeenCalledWith(ME, expect.objectContaining({ userId: STRANGER, type: 'entry_requested' }));
  });
  test('a withdrawn entry is reopened, not duplicated', async () => {
    const base = world();
    mockNext = (q) => (q[0] === 'from:tournament_entries' && has(q, 'update:') ? { data: { id: 'e-old', status: 'pending' } } : base(q));
    const r = await join();
    expect(r.body.entry.id).toBe('e-old');
    expect(mockLog.some((q) => has(q, 'insert:'))).toBe(false);
  });
  test('unknown code → 404 in words; a non-text code → 400', async () => {
    mockNext = world({ t: null });
    expect((await join()).body).toEqual({ error: 'No tournament uses that code. Check it and try again.', code: 'INVALID_CODE' });
    expect((await join({ entry_code: { a: 1 }, team_id: TEAM })).statusCode).toBe(400);
  });
  test('the captain form and the code are the same routine', () => {
    const src = fs.readFileSync(path.join(__dirname, '..', 'controllers', 'tournaments.controller.ts'), 'utf8');
    const body = (n: string) => src.slice(src.indexOf(`export async function ${n}(`), src.indexOf('\nexport ', src.indexOf(`export async function ${n}(`) + 10));
    expect(body('createEntry')).toContain('await enterTeam(');
    expect(body('joinByCode')).toContain('await enterTeam(');
  });
});

describe('F11 · entries: bad ids are 400, unknown ones 404', () => {
  test('POST /:id/entries for a missing tournament → 404, nothing written', async () => {
    mockNext = world({ t: null });
    const r = await call(createEntry, { body: { team_id: TEAM } });
    expect(r.statusCode).toBe(404);
    expect(writes()).toEqual([]);
  });
  test('direct add: "nope" → 400; an unknown team → 404', async () => {
    mockNext = world();
    expect((await call(directAddTeam, { body: { team_id: 'nope' } })).statusCode).toBe(400);
    mockNext = world({ team: null });
    expect((await call(directAddTeam, { body: { team_id: TEAM } })).statusCode).toBe(404);
  });
  test('seed "abc" → 400; a long group label → 400', async () => {
    mockNext = world();
    expect((await call(updateEntry, { params: { id: T, entryId: 'e1' }, body: { seed: 'abc' } })).statusCode).toBe(400);
    expect((await call(updateEntry, { params: { id: T, entryId: 'e1' }, body: { group_label: 'x'.repeat(30) } })).statusCode).toBe(400);
  });
});

describe('F8 · max_teams holds on direct add, approve and edit', () => {
  test('direct add counts approved entries, and refuses at the cap', async () => {
    mockNext = world({ count: 4 });
    const r = await call(directAddTeam, { body: { team_id: TEAM } });
    expect(r.body.code).toBe('TOURNAMENT_FULL');
    expect(mockLog.some((q) => q[0] === 'from:tournament_entries' && has(q, 'in:["status",["approved"]]'))).toBe(true);
  });
  test('approving a pending entry into a full league → 400 TOURNAMENT_FULL, no update', async () => {
    const base = world({ count: 2, t: { max_teams: 2 } });
    mockNext = (q) => (q[0] === 'from:tournament_entries' && has(q, 'select:["id, tournament_id, team_id, status"]')
      ? { data: { id: 'e1', tournament_id: T, team_id: TEAM, status: 'pending' } } : base(q));
    const r = await call(updateEntry, { params: { id: T, entryId: 'e1' }, body: { status: 'approved' } });
    expect([r.statusCode, r.body.code]).toEqual([400, 'TOURNAMENT_FULL']);
    expect(writes()).toEqual([]);
  });
  test('F9 · approving a team of another sport → 400 WRONG_SPORT', async () => {
    const base = world({ team: { sport_id: 'sport-badminton' } });
    mockNext = (q) => (q[0] === 'from:tournament_entries' && has(q, 'select:["id, tournament_id, team_id, status"]')
      ? { data: { id: 'e1', tournament_id: T, team_id: TEAM, status: 'pending' } } : base(q));
    expect((await call(updateEntry, { params: { id: T, entryId: 'e1' }, body: { status: 'approved' } })).body.code).toBe('WRONG_SPORT');
  });
  test('lowering max_teams below the approved count → 400', async () => {
    mockNext = (q) => (q[0] === 'from:tournaments' ? { data: { created_by: ME, status: 'upcoming', name: 'P3', start_date: null, end_date: null } }
      : q[0] === 'from:tournament_entries' ? { count: 3 } : { data: null });
    const r = await call(updateTournament, { body: { max_teams: 2 } });
    expect([r.statusCode, r.body.code]).toEqual([400, 'MAX_BELOW_APPROVED']);
    expect(writes()).toEqual([]);
  });
});

describe('F6/F11/F12 · tournament details', () => {
  const current = (q: Q) => (q[0] === 'from:tournaments'
    ? { data: { created_by: ME, status: 'upcoming', name: 'P3', start_date: '2026-10-05', end_date: '2026-10-07' } }
    : { count: 0 });
  test.each([
    [{ status: 'registration' }, 'Invalid status'],
    [{ name: '   ' }, 'at least 3'],
    [{ name: '' }, 'at least 3'],
    [{ name: 12345 }, 'at least 3'],
    [{ end_date: '2026-10-01' }, 'can’t be before'],
    [{ entry_fee: -5 }, '0 or more'],
    [{ start_date: 'garbage' }, 'must be a date'],
    [{ match_duration_minutes: 'abc' }, 'whole number'],
    [{ city_id: 'nope' }, 'valid city'],
  ])('edit %j → 400', async (body, words) => {
    mockNext = current;
    const r = await call(updateTournament, { body });
    expect(r.statusCode).toBe(400);
    expect(r.body.error).toContain(words);
    expect(writes()).toEqual([]);
  });
  test('create: "   ", an object name, or start "soon" → 400', async () => {
    for (const body of [{ name: '   ' }, { name: { a: 1 } }, { name: 'P3 Cup', start_date: 'soon' }]) {
      const r = await call(createTournament, { body: { sport_id: CRICKET, format: 'knockout', max_teams: 4, ...body } });
      expect(r.statusCode).toBe(400);
    }
    expect(writes()).toEqual([]);
  });
  test('the rules themselves', () => {
    expect(tournamentNameRefusal('  P3 Cup ')).toBeNull();
    expect(tournamentDetailsRefusal({ start_date: '2026-10-05', end_date: '2026-10-05', entry_fee: 0, ground_count: 2, daily_start_time: '09:00' })).toBeNull();
    expect(tournamentDetailsRefusal({ daily_start_time: '9am' })?.code).toBe('INVALID_TIME');
    expect(tournamentDetailsRefusal({ start_date: '2026-10-09' }, { end_date: '2026-10-07' })?.code).toBe('END_BEFORE_START');
  });
  test('list: a bad city → 400; an older build\'s "registration" reads as upcoming', async () => {
    expect((await call(listTournaments, { query: { city_id: 'bad' } })).statusCode).toBe(400);
    expect((await call(listTournaments, { query: { status: 'nonsense' } })).statusCode).toBe(400);
    mockLog = [];
    await call(listTournaments, { query: { status: 'registration' } });
    expect(mockLog[0]).toContain('eq:["status","upcoming"]');
    expect(listStatusFilter(undefined)).toBeNull();
  });
});

describe('F3/F4 · generating fixtures', () => {
  test('a cancelled tournament → 409, status untouched, no claim', async () => {
    mockNext = (q) => (q[0] === 'from:tournaments' ? { data: { id: T, status: 'cancelled', format: 'knockout' } } : { data: null });
    const r = await call(generateFixtures, {});
    expect([r.statusCode, r.body.code]).toEqual([409, 'TOURNAMENT_FINISHED']);
    expect(writes()).toEqual([]);
  });
  test('a schedule that does not fit gives the claim back', async () => {
    mockNext = (q) => {
      if (q[0] === 'from:tournaments' && has(q, 'update:')) return { data: [{ id: T }] };
      if (q[0] === 'from:tournaments') {
        return { data: { id: T, status: 'upcoming', sport_id: CRICKET, format: 'knockout', start_date: '2026-10-05', end_date: '2026-10-05', daily_start_time: '09:00', daily_end_time: '09:30', match_duration_minutes: 60, buffer_minutes: 0, ground_count: 1 } };
      }
      if (q[0] === 'from:tournament_entries') return { data: [{ team_id: TEAM, team: { id: TEAM, name: 'A' } }, { team_id: TB, team: { id: TB, name: 'B' } }] };
      return { data: [] };
    };
    const r = await call(generateFixtures, {});
    expect([r.statusCode, r.body.code]).toEqual([400, 'SCHEDULE_CAPACITY']);
    const last = writes().pop()!;
    expect(last).toContain('update:[{"fixtures_generated":false}]');
  });
  test('every capacity return releases it', () => {
    const src = fs.readFileSync(path.join(__dirname, '..', 'controllers', 'tournaments.controller.ts'), 'utf8');
    const caps = src.match(/code: 'SCHEDULE_CAPACITY'/g) ?? [];
    const released = src.match(/await releaseFixtureClaim\(id\); return res\.status\(400\)\.json\(\{ error: sched\w*\.error, code: 'SCHEDULE_CAPACITY' \}\)/g) ?? [];
    expect(caps.length).toBe(4); // BUILD 4.15 adds the Swiss draw
    expect(released.length).toBe(4);
  });
});

describe('F7 · results before the start date still crown', () => {
  test('the final on an upcoming tournament completes it', async () => {
    mockNext = (q) => {
      if (q[0] === 'from:matches' && has(q, 'select:["id, tournament_id')) {
        return { data: { id: FIX, tournament_id: T, winner_team_id: TEAM, next_match_id: null, round: 2, team_a_id: TEAM, team_b_id: TB, team_a_name: 'A', team_b_name: 'B' } };
      }
      if (q[0] === 'from:tournaments' && has(q, 'select:["format"]')) return { data: { format: 'knockout' } };
      if (q[0] === 'from:matches') return { count: 0, data: [] };
      return { data: null };
    };
    await advanceTournamentWinner(FIX);
    const crown = mockLog.find((q) => q[0] === 'from:tournaments' && has(q, '"champion_team_id"'))!;
    expect(crown).toContain('in:["status",["upcoming","live"]]');
  });
});

describe('F5/F10 · the fixture editor', () => {
  const fixture = (extra: object = {}) => ({ id: FIX, status: 'completed', team_a_id: TEAM, team_b_id: TB, winner_team_id: TEAM, next_match_id: NEXT, next_slot: 'A', ...extra });
  const on = (cur: object, child: object = { status: 'scheduled' }) => (q: Q) => {
    if (q[0] === 'from:tournaments') return { data: { created_by: ME } };
    if (q[0] === 'from:teams') return { data: { name: 'P3 Spare' } };
    if (q[0] === 'from:matches' && has(q, 'update:') && has(q, `"${FIX}"`)) return { data: { id: FIX, ...cur } };
    if (q[0] === 'from:matches' && has(q, 'select:["status"]')) return { data: child };
    if (q[0] === 'from:matches' && has(q, `eq:["id","${FIX}"]`)) return { data: cur };
    return { data: null };
  };
  const save = (updates: unknown) => call(updateFixtures, { body: { updates } });
  test('a stranger as winner → 400 in words, nothing written', async () => {
    mockNext = on(fixture({ status: 'scheduled', winner_team_id: null }));
    const r = await save([{ fixture_id: FIX, winner_team_id: STRANGER, status: 'completed' }]);
    expect([r.statusCode, r.body.error]).toEqual([400, 'The winner must be one of the two teams in this match.']);
    expect(writes()).toEqual([]);
  });
  test('"No winner" on a completed fixture: back to scheduled, and out of the next round', async () => {
    mockNext = on(fixture());
    const r = await save([{ fixture_id: FIX, winner_team_id: null }]);
    expect(r.body.updated).toBe(1);
    const upd = writes();
    expect(upd[0]).toContain('update:[{"winner_team_id":null,"status":"scheduled"}]');
    const unadvance = upd.find((q) => has(q, `eq:["id","${NEXT}"]`))!;
    expect(unadvance).toContain('update:[{"team_a_id":null,"team_a_name":null}]');
    expect(unadvance).toContain(`eq:["team_a_id","${TEAM}"]`);
  });
  test('picking a team sends its name with the id', async () => {
    mockNext = on(fixture({ status: 'scheduled', winner_team_id: null }));
    await save([{ fixture_id: FIX, team_b_id: STRANGER }]);
    expect(writes()[0]).toContain(`update:[{"team_b_id":"${STRANGER}","team_b_name":"P3 Spare"}]`);
  });
  test('[null], a bogus status, a bad time, an unknown fixture → 400 with the reason', async () => {
    mockNext = on(fixture());
    expect((await save([null])).statusCode).toBe(400);
    expect((await save([{ fixture_id: FIX, status: 'bogus' }])).body.error).toContain('status must be');
    expect((await save([{ fixture_id: FIX, scheduled_at: 'tuesday' }])).body.error).toContain('date and time');
    mockNext = (q) => (q[0] === 'from:tournaments' ? { data: { created_by: ME } } : { data: null });
    expect((await save([{ fixture_id: FIX, scheduled_at: '2026-10-05T09:00:00Z' }])).body.error).toBe('That fixture isn’t in this tournament.');
  });
  test('several items: the skipped ones come back with reasons', async () => {
    mockNext = on(fixture({ status: 'scheduled', winner_team_id: null }));
    const r = await save([{ fixture_id: FIX, scheduled_at: '2026-10-05T09:00:00Z' }, { fixture_id: 'nope' }]);
    expect(r.statusCode).toBe(200);
    expect(r.body.skipped).toEqual([{ id: 'nope', reason: 'That fixture isn’t in this tournament.' }]);
  });
  test('the next round has started → 409 in words', async () => {
    mockNext = on(fixture(), { status: 'live' });
    const r = await save([{ fixture_id: FIX, winner_team_id: TB, status: 'completed' }]);
    expect([r.statusCode, r.body.code]).toEqual([409, 'NEXT_ROUND_STARTED']);
  });
  test('getTournament sends each entry\'s team_id', () => {
    const src = fs.readFileSync(path.join(__dirname, '..', 'controllers', 'tournaments.controller.ts'), 'utf8');
    // Gap 10: organisers also get fee_paid_at, fee_note (the select is built per viewer).
    // Oct 2026: the columns live in entryCols (shared by the tournament and the entries page).
    expect(src).toContain("const entryCols = (organiser: boolean) => `id, team_id, status, seed, group_label, club, entered_at,${organiser ? ' fee_paid_at, fee_note,' : ''} team:team_id (id, name, short_name, logo_url, sport_id)`;");
  });
});

describe('F13/F14/F19', () => {
  test('a stranger asking for the chat writes nothing', async () => {
    mockNext = (q) => (q[0] === 'from:tournaments' ? { data: { id: T, name: 'P3', sport_metadata: {}, created_by: ME } } : { data: null });
    const r = await call(getTournamentChat, {});
    expect(r.statusCode).toBe(403);
    expect(writes()).toEqual([]);
  });
  test('officials of an unknown tournament → 404; bad id, bad role, unknown person refused', async () => {
    mockNext = () => ({ data: null });
    expect((await call(getTournamentOfficials, {})).statusCode).toBe(404);
    expect((await call(addTournamentOfficial, { body: { user_id: 'nope', role: 'umpire' } })).statusCode).toBe(400);
    expect((await call(addTournamentOfficial, { body: { user_id: STRANGER, role: 'x'.repeat(3000) } })).statusCode).toBe(400);
    expect((await call(addTournamentOfficial, { body: { user_id: STRANGER, role: { a: 1 } } })).statusCode).toBe(400);
    mockNext = (q) => (q[0] === 'from:tournaments' ? { data: { created_by: ME } } : { data: null });
    expect((await call(addTournamentOfficial, { body: { user_id: STRANGER, role: 'umpire' } })).statusCode).toBe(404);
    expect(writes()).toEqual([]);
  });
  test('analytics counts the teams in it (approved), like the Overview', async () => {
    mockNext = (q) => (q[0] === 'from:tournaments' ? { data: { created_by: ME } } : { count: 4 });
    await call(getTournamentAnalytics, {});
    expect(mockLog.find((q) => q[0] === 'from:tournament_entries')).toContain('eq:["status","approved"]');
  });
  test('the offline pack carries each entry\'s status (and, BUILD 1.7, its group)', () => {
    const src = fs.readFileSync(path.join(__dirname, '..', 'controllers', 'tournamentHub.controller.ts'), 'utf8');
    expect(src).toContain(".select('id, team_id, status, group_label, team:teams(id, name, short_name, logo_url)')");
  });
});
