/**
 * 6 Oct 2026 · team pickers (found on the 2.10.0 device pass): join by code
 * listed every team a captain had, of any sport, and the entry was refused
 * after the tap. GET /tournaments/code/:code names the code's tournament (its
 * sport, its category) first; POST /tournaments/:id/entry-check says, per
 * team, whether it can enter and why not — the entry's own checks. And the
 * organiser's add now reopens a rejected or withdrawn entry, as a captain's
 * entry does, instead of refusing it as "already registered".
 */
type Q = string[];
let mockLog: Q[] = [];
let mockNext: (q: Q) => { data?: unknown; error?: unknown; count?: number } = () => ({ data: null, error: null });
jest.mock('../utils/supabase', () => {
  const start = (t: string) => {
    const q: string[] = [`from:${t}`];
    mockLog.push(q);
    const chain: any = {};
    for (const m of ['select', 'in', 'not', 'eq', 'neq', 'is', 'limit', 'maybeSingle', 'single', 'update', 'delete', 'order', 'or', 'ilike', 'range', 'gte', 'gt', 'lt', 'upsert', 'insert']) {
      chain[m] = jest.fn((...a: unknown[]) => { q.push(`${m}:${JSON.stringify(a)}`); return chain; });
    }
    chain.then = (ok: (v: unknown) => unknown, bad?: (e: unknown) => unknown) => {
      try { return Promise.resolve(ok({ data: null, error: null, ...mockNext(q) })); } catch (e) { return bad ? bad(e) : Promise.reject(e); }
    };
    return chain;
  };
  return { supabase: { from: jest.fn(start), rpc: jest.fn(async () => ({ data: null, error: null })) } };
});
let mockOrganiser = true;
jest.mock('../utils/tournamentAuth', () => ({
  ...jest.requireActual('../utils/tournamentAuth'),
  isTournamentOrganiser: jest.fn(async () => mockOrganiser),
  logAdminAction: jest.fn(),
}));
const mockDisbanded = new Set<string>();
jest.mock('../utils/teamVisibility', () => ({ ...jest.requireActual('../utils/teamVisibility'), isTeamDisbanded: jest.fn(async (id: string) => mockDisbanded.has(id)) }));
jest.mock('../utils/tournamentChat', () => ({ syncTournamentChatMembers: jest.fn(async () => undefined), syncAfterSuccess: jest.fn(), canOpenTournamentChat: jest.fn(async () => false) }));
jest.mock('../utils/testContent', () => ({ hideTestFor: jest.fn(async () => false), excludeTest: (q: unknown) => q, testUserIdSet: jest.fn(async () => new Set()) }));
jest.mock('../utils/notify', () => ({
  notifyUser: jest.fn(), notifyUsers: jest.fn(), notifyUnlessBlocked: jest.fn(), sendPushToUsers: jest.fn(), allowedRecipients: jest.fn(async () => []),
  matchAudienceIds: jest.fn(async () => []), matchFollowerIds: jest.fn(async () => []),
}));

// eslint-disable-next-line import/first
import { directAddTeam, entryCheck, joinOptions, myTeamsForEntry, tournamentByCode } from '../controllers/tournaments.controller';

const T = '22222222-2222-4222-8222-222222222222';
const id = (n: number) => `33333333-3333-4333-8333-33333333333${n}`;
const [OK, BADMINTON, OLD, PENDING, NOT_MINE, REJECTED, GONE, CLASH, NOT_FOUND] = [1, 2, 3, 4, 5, 6, 7, 8, 9].map(id) as [string, string, string, string, string, string, string, string, string];
const LIONS = '44444444-4444-4444-8444-444444444444';
const has = (q: Q, s: string) => q.some((c) => c.startsWith(s));
const arg = (q: Q, m: string) => { const c = q.find((x) => x.startsWith(`${m}:`)); return c ? JSON.parse(c.slice(m.length + 1)) : null; };
const run = async (fn: any, req: object) => {
  const r: any = { statusCode: 200, body: null, setHeader: jest.fn() };
  r.status = jest.fn((c: number) => { r.statusCode = c; return r; });
  r.json = jest.fn((b: unknown) => { r.body = b; return r; });
  await fn({ userId: 'me', params: { id: T }, query: {}, body: {}, ...req } as any, r);
  return r;
};

let tournament: Record<string, unknown>;
let enteredRoster: Record<string, string[]> = {};
beforeEach(() => {
  mockLog = [];
  mockOrganiser = true;
  mockDisbanded.clear();
  tournament = { id: T, name: 'P3 U-19 Cup', status: 'upcoming', format: 'knockout', sport_id: 'ck', max_teams: 8, registration_deadline: null, fixtures_generated: false, created_by: 'org', entry_fee: 500, start_date: '2026-10-20', settings: { v: 1, category: { underAge: 19 } } };
  const sportOf: Record<string, string> = { [BADMINTON]: 'bd' };
  const roster: Record<string, string[]> = { [OLD]: ['uOld'], [CLASH]: ['uRavi'] };
  // teams already in (pending/approved): PENDING, and Lions, which has Ravi
  enteredRoster = { [PENDING]: ['u-' + PENDING], [LIONS]: ['uRavi'] };
  mockNext = (q) => {
    const ins = (field: string) => { const c = q.filter((x) => x.startsWith('in:')).map((x) => JSON.parse(x.slice(3))).find((a) => a[0] === field); return c ? (c[1] as string[]) : null; };
    if (q[0] === 'from:tournaments') return { data: tournament };
    if (q[0] === 'from:sports') return { data: { name: 'Cricket' } };
    if (q[0] === 'from:teams' && ins('id')) {
      if (arg(q, 'select')?.[0] === 'id, name') return { data: ins('id')!.map((tid) => ({ id: tid, name: 'Lions' })) };
      return { data: ins('id')!.filter((tid) => tid !== NOT_FOUND).map((tid) => ({ id: tid, sport_id: sportOf[tid] ?? 'ck', deleted_at: mockDisbanded.has(tid) ? '2026-10-01' : null })) };
    }
    if (q[0] === 'from:teams') { const tid = arg(q, 'eq')[1]; return { data: { id: tid, sport_id: sportOf[tid] ?? 'ck', deleted_at: null } }; }
    if (q[0] === 'from:team_members' && arg(q, 'eq')?.[0] === 'user_id') {
      return { data: [OK, BADMINTON, OLD, PENDING, REJECTED, GONE, CLASH].map((t) => ({ team_id: t, role: t === OK ? 'vice_captain' : 'captain' })) };
    }
    if (q[0] === 'from:team_members' && ins('user_id')) {
      // members of the entered teams, among the players asked about
      const users = ins('user_id')!;
      return { data: Object.entries(enteredRoster).flatMap(([tid, us]) => us.filter((u) => users.includes(u)).map((u) => ({ team_id: tid, user_id: u }))) };
    }
    if (q[0] === 'from:team_members' && ins('team_id')) return { data: ins('team_id')!.flatMap((tid) => (roster[tid] ?? ['u-' + tid]).map((u) => ({ team_id: tid, user_id: u }))) };
    if (q[0] === 'from:team_members') { const tid = arg(q, 'eq')?.[1]; return { data: (roster[tid] ?? ['u-' + tid]).map((u) => ({ user_id: u })) }; }
    if (q[0] === 'from:users') return { data: (arg(q, 'in')[1] as string[]).map((u) => ({ id: u, name: u === 'uOld' ? 'Arjun' : 'Kid', dob: u === 'uOld' ? '2000-01-01' : '2010-01-01', gender: 'male' })) };
    if (q[0] === 'from:tournament_entries' && arg(q, 'select')?.[0] === 'team_id, status') return { data: [{ team_id: PENDING, status: 'pending' }, { team_id: REJECTED, status: 'rejected' }] };
    if (q[0] === 'from:tournament_entries' && has(q, 'neq:')) return { data: [] }; // directAddTeam's own overlap check
    if (q[0] === 'from:tournament_entries' && arg(q, 'select')?.[0] === 'team_id') return { data: Object.keys(enteredRoster).map((tid) => ({ team_id: tid })) };
    if (q[0] === 'from:tournament_entries') return { data: null, count: 0 };
    return { data: [] };
  };
});

describe('GET /tournaments/code/:code', () => {
  test('names the tournament, its sport and category (code in capitals)', async () => {
    const r = await run(tournamentByCode, { params: { code: ' abc234 ' } });
    expect(r.statusCode).toBe(200);
    // Badminton gaps 1–2 add the entry kind and the event's place (a plain tournament: team, no parent).
    expect(r.body.tournament).toEqual({ id: T, name: 'P3 U-19 Cup', sport_id: 'ck', status: 'upcoming', format: 'knockout', entry_fee: 500, start_date: '2026-10-20', category: { underAge: 19 }, entry_kind: 'team', parent_id: null, event_label: null });
    expect(arg(mockLog.find((q) => q[0] === 'from:tournaments')!, 'eq')).toEqual(['entry_code', 'ABC234']);
  });
  test('no such code → 404 TOURNAMENT_NOT_FOUND; nonsense → 400', async () => {
    mockNext = () => ({ data: null });
    const r = await run(tournamentByCode, { params: { code: 'NOPE11' } });
    expect([r.statusCode, r.body.code, r.body.error]).toEqual([404, 'TOURNAMENT_NOT_FOUND', 'No tournament has that code. Check it with the organiser.']);
    expect((await run(tournamentByCode, { params: { code: 'X'.repeat(21) } })).statusCode).toBe(400);
  });
});

describe('POST /tournaments/:id/entry-check', () => {
  const verdicts = async (team_ids: string[], as = 'captain') => {
    const r = await run(entryCheck, { body: { team_ids, as } });
    expect(r.statusCode).toBe(200);
    return Object.fromEntries((r.body.teams as Array<{ team_id: string; ok: boolean; code: string | null; reason: string | null }>).map((t) => [t.team_id, t]));
  };

  test('as a captain: each team with the entry\'s own reason', async () => {
    const v = await verdicts([OK, BADMINTON, OLD, PENDING, NOT_MINE, REJECTED]);
    expect(v[OK]).toEqual({ team_id: OK, ok: true, code: null, reason: null });
    expect(v[BADMINTON]).toMatchObject({ ok: false, code: 'WRONG_SPORT', reason: 'This is a cricket tournament — enter a cricket team.' });
    expect(v[OLD]).toMatchObject({ ok: false, code: 'CATEGORY', reason: 'This is an under-19 event, and Arjun is 26 on the start date.' });
    expect(v[PENDING]).toMatchObject({ ok: false, code: 'ALREADY_ENTERED', reason: 'Already entered — waiting for the organiser.' });
    expect(v[NOT_MINE]).toMatchObject({ ok: false, code: 'NOT_CAPTAIN' });
    expect(v[REJECTED]!.ok).toBe(true); // a captain's entry reopens it
  });

  test('a disbanded team, a closed deadline', async () => {
    mockDisbanded.add(GONE);
    expect((await verdicts([GONE]))[GONE]).toMatchObject({ ok: false, code: 'TEAM_DISBANDED' });
    tournament = { ...tournament, registration_deadline: '2020-01-01T00:00:00Z' };
    expect((await verdicts([OK]))[OK]).toMatchObject({ ok: false, code: 'REGISTRATION_CLOSED' });
  });

  test('as the organiser: any team, no deadline, a pending one is theirs to approve', async () => {
    tournament = { ...tournament, registration_deadline: '2020-01-01T00:00:00Z' };
    const v = await verdicts([NOT_MINE, PENDING, OLD], 'organiser');
    expect(v[NOT_MINE]!.ok).toBe(true);
    expect(v[PENDING]).toMatchObject({ ok: false, reason: 'Already entered — approve it under Entries.' });
    expect(v[OLD]).toMatchObject({ ok: false, code: 'CATEGORY' });
  });

  test('as the organiser, only an organiser; bad ids → 400', async () => {
    mockOrganiser = false;
    expect((await run(entryCheck, { body: { team_ids: [OK], as: 'organiser' } })).statusCode).toBe(403);
    expect((await run(entryCheck, { body: { team_ids: ['nope'] } })).statusCode).toBe(400);
    expect((await run(entryCheck, { body: { team_ids: Array.from({ length: 31 }, () => OK) } })).statusCode).toBe(400);
  });

  test('a player already on an entered team → ROSTER_OVERLAP naming that team; a missing team → not found', async () => {
    const v = await verdicts([CLASH, NOT_FOUND], 'organiser');
    expect(v[CLASH]).toMatchObject({ ok: false, code: 'ROSTER_OVERLAP', reason: 'A player on this team is already registered with Lions in this tournament.' });
    expect(v[NOT_FOUND]).toMatchObject({ ok: false, code: 'TEAM_NOT_FOUND' });
  });

  test('the same few queries for 3 teams or 9, answered in the order asked (7 Oct: 4.7 s for nine on live)', async () => {
    const count = async (team_ids: string[]) => {
      mockLog = [];
      const r = await run(entryCheck, { body: { team_ids, as: 'organiser' } });
      expect(r.body.teams.map((x: { team_id: string }) => x.team_id)).toEqual(team_ids);
      return mockLog.length;
    };
    const three = await count([OK, OLD, BADMINTON]);
    const nine = await count([OLD, OK, PENDING, REJECTED, BADMINTON, GONE, CLASH, NOT_MINE, NOT_FOUND]);
    expect(nine - three).toBeLessThanOrEqual(1); // the clash adds one query, for its team's name
    expect(nine).toBeLessThanOrEqual(12);
  });

  test('it only reads — nothing is entered', async () => {
    await verdicts([OK, REJECTED]);
    expect(mockLog.some((q) => has(q, 'insert:') || has(q, 'update:'))).toBe(false);
  });
});

describe('the organiser adds a team that was rejected or withdrew', () => {
  test('its entry is reopened as approved (it was refused as "already registered")', async () => {
    tournament = { ...tournament, settings: { v: 1 } };
    const base = mockNext;
    mockNext = (q) => (q[0] === 'from:tournament_entries' && arg(q, 'select')?.[0] === 'id, status' ? { data: { id: 'e6', status: 'rejected' } }
      : q[0] === 'from:tournament_entries' && has(q, 'update:') ? { data: { id: 'e6', status: 'approved' } } : base(q));
    const r = await run(directAddTeam, { body: { team_id: REJECTED } });
    expect([r.statusCode, r.body.entry]).toEqual([200, { id: 'e6', status: 'approved' }]);
    const upd = mockLog.find((q) => q[0] === 'from:tournament_entries' && has(q, 'update:'))!;
    expect(arg(upd, 'update')[0].status).toBe('approved');
    expect(arg(upd, 'eq')).toEqual(['id', 'e6']);
    expect(mockLog.some((q) => q[0] === 'from:tournament_entries' && has(q, 'insert:'))).toBe(false);
  });
  test('a pending or approved one is still refused', async () => {
    tournament = { ...tournament, settings: { v: 1 } };
    const base = mockNext;
    mockNext = (q) => (q[0] === 'from:tournament_entries' && arg(q, 'select')?.[0] === 'id, status' ? { data: { id: 'e4', status: 'pending' } } : base(q));
    const r = await run(directAddTeam, { body: { team_id: PENDING } });
    expect([r.statusCode, r.body.code]).toEqual([400, 'ALREADY_ENTERED']);
  });
});

describe('GET /tournaments/code/:code/teams · join by code in one request', () => {
  const FOOTBALL = id(0);
  const withMemberships = (rows: Array<{ team_id: string; role: string; name: string; sport?: string; gone?: boolean }>) => {
    const base = mockNext;
    mockNext = (q) => (q[0] === 'from:team_members' && arg(q, 'select')?.[0]?.includes('team:teams')
      ? { data: rows.map((r) => ({ team_id: r.team_id, role: r.role, team: { id: r.team_id, name: r.name, sport_id: r.sport ?? 'ck', deleted_at: r.gone ? '2026-10-01' : null } })) }
      : base(q));
  };
  test('the tournament, and the caller\'s own teams of its sport with their verdicts', async () => {
    withMemberships([
      { team_id: OK, role: 'vice_captain', name: 'Alpha' },
      { team_id: OLD, role: 'captain', name: 'Veterans' },
      { team_id: PENDING, role: 'captain', name: 'Waiting XI' },
      { team_id: FOOTBALL, role: 'captain', name: 'Kickers', sport: 'fb' },
      { team_id: GONE, role: 'captain', name: 'Gone XI', gone: true },
    ]);
    const r = await run(joinOptions, { params: { code: ' abc234 ' } });
    expect(r.statusCode).toBe(200);
    expect(r.body.tournament).toMatchObject({ id: T, name: 'P3 U-19 Cup', sport_id: 'ck', category: { underAge: 19 } });
    expect(r.body.teams).toEqual([
      { id: OK, name: 'Alpha', sport_id: 'ck', my_role: 'vice_captain', ok: true, code: null, reason: null },
      { id: OLD, name: 'Veterans', sport_id: 'ck', my_role: 'captain', ok: false, code: 'CATEGORY', reason: 'This is an under-19 event, and Arjun is 26 on the start date.' },
      { id: PENDING, name: 'Waiting XI', sport_id: 'ck', my_role: 'captain', ok: false, code: 'ALREADY_ENTERED', reason: 'Already entered — waiting for the organiser.' },
    ]);
    expect(r.body.other_sport_teams).toBe(1); // the football team; the disbanded one isn't counted
    expect(arg(mockLog.find((q) => q[0] === 'from:tournaments')!, 'eq')).toEqual(['entry_code', 'ABC234']);
    expect(r.body.member_teams).toBe(4); // every live team they're on
  });
  test('no team of its sport → an empty list and the count of the others; a plain player is counted as a member', async () => {
    withMemberships([{ team_id: FOOTBALL, role: 'captain', name: 'Kickers', sport: 'fb' }, { team_id: NOT_MINE, role: 'player', name: 'Friends XI' }]);
    const r = await run(joinOptions, { params: { code: 'ABC234' } });
    expect([r.body.teams, r.body.other_sport_teams, r.body.member_teams]).toEqual([[], 1, 2]);
  });
  test('an unknown code → 404 TOURNAMENT_NOT_FOUND; nonsense → 400; it only reads', async () => {
    withMemberships([]);
    const base = mockNext;
    mockNext = (q) => (q[0] === 'from:tournaments' ? { data: null } : base(q));
    const r = await run(joinOptions, { params: { code: 'NOPE11' } });
    expect([r.statusCode, r.body.code]).toEqual([404, 'TOURNAMENT_NOT_FOUND']);
    expect((await run(joinOptions, { params: { code: '' } })).statusCode).toBe(400);
    expect(mockLog.some((q) => has(q, 'insert:') || has(q, 'update:'))).toBe(false);
  });
});

describe('GET /tournaments/:id/my-teams · Apply to enter in one request', () => {
  test('the same answer by tournament id; every team, not a first page', async () => {
    const many = Array.from({ length: 120 }, (_, i) => `55555555-5555-4555-8555-${String(i).padStart(12, '0')}`);
    const base = mockNext;
    mockNext = (q) => (q[0] === 'from:team_members' && arg(q, 'select')?.[0]?.includes('team:teams')
      ? { data: [{ team_id: OK, role: 'captain', team: { id: OK, name: 'Alpha', sport_id: 'ck', deleted_at: null } }, ...many.map((t) => ({ team_id: t, role: 'captain', team: { id: t, name: 'X', sport_id: 'fb', deleted_at: null } }))] }
      : base(q));
    const r = await run(myTeamsForEntry, { params: { id: T } });
    expect(r.statusCode).toBe(200);
    expect(r.body.teams.map((t: { id: string }) => t.id)).toEqual([OK]);
    expect(r.body.other_sport_teams).toBe(120);
    expect(arg(mockLog.find((q) => q[0] === 'from:tournaments')!, 'eq')).toEqual(['id', T]);
  });
  test('not a tournament → 404', async () => {
    expect((await run(myTeamsForEntry, { params: { id: 'nope' } })).statusCode).toBe(404);
    const base = mockNext;
    mockNext = (q) => (q[0] === 'from:tournaments' ? { data: null } : base(q));
    expect((await run(myTeamsForEntry, { params: { id: T } })).statusCode).toBe(404);
  });
});

