/**
 * BUILD 4.14 · categories: gender, an age limit on the start date, a rating
 * band in the sport. Every way in (a captain's entry, the join code, the
 * organiser's add, an approval) checks every player on the team; a refusal
 * names the player and what to fix. No category = open, as before.
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
jest.mock('../utils/teamAuth', () => ({ ...jest.requireActual('../utils/teamAuth'), isTeamManager: jest.fn(async () => true) }));
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
import { createEntry, directAddTeam, generateFixtures } from '../controllers/tournaments.controller';
// eslint-disable-next-line import/first
import { ageOn, categoryLabel, categoryProblem, categoryRefusal } from '../utils/tournamentSettings';

const on = new Date('2026-10-10T00:00:00Z');
const P = (name: string, gender: string | null, dob: string | null, rating: number | null = null) => ({ name, gender, dob, rating });

describe('BUILD 4.14 · the rules', () => {
  test('age on the start date', () => {
    expect(ageOn('2012-10-10', on)).toBe(14);
    expect(ageOn('2012-10-11', on)).toBe(13);
  });
  test.each([
    [{ gender: 'women' }, [P('Asha', 'female', null), P('Ravi', 'male', null)], 'This is a women’s event, and Ravi can’t play in it.'],
    [{ gender: 'men' }, [P('Kiran', null, null)], 'Kiran’s profile doesn’t list their gender as man. Add it to the profile first.'],
    [{ gender: 'mixed' }, [P('A', 'male', null), P('B', 'male', null)], 'A mixed event needs at least one man and one woman on the team.'],
    [{ underAge: 14 }, [P('Tara', 'female', '2012-10-10')], 'This is an under-14 event, and Tara is 14 on the start date.'],
    [{ underAge: 14 }, [P('Tara', 'female', '2012-10-11')], null],
    [{ underAge: 14 }, [P('Neel', 'male', null)], 'Neel’s profile doesn’t list their date of birth, and this event has an age limit. Add it to the profile first.'],
    [{ minAge: 40 }, [P('Old', 'male', '1990-01-01')], 'This event is for 40 and over, and Old is 36 on the start date.'],
    [{ maxRating: 1600 }, [P('Magnus', 'male', null, 1650.4)], 'This event is for players rated up to 1600, and Magnus is rated 1650.'],
    [{ maxRating: 1600 }, [P('New', 'male', null, null)], null],
    [{ minRating: 1800 }, [P('New', 'male', null, null)], 'New has no rating in this sport yet (this event is for 1800 and up).'],
  ])('%j', (c, players, why) => {
    expect(categoryProblem(c as never, players, on)).toBe(why);
  });
  test('checked, and labelled', () => {
    expect(categoryRefusal({ underAge: 14, minAge: 40 })?.error).toBe('A category is an under-age limit or a minimum age, not both.');
    expect(categoryRefusal({ minRating: 2000, maxRating: 1600 })?.error).toBe('The lowest rating can’t be above the highest.');
    expect(categoryRefusal({ gender: 'boys' })?.error).toBe('A category is men’s, women’s, mixed or open.');
    expect(categoryLabel({ gender: 'women', underAge: 19, maxRating: 1600 })).toBe('Women’s · Under 19 · Rated up to 1600');
    expect(categoryLabel({})).toBeNull();
  });
});

describe('BUILD 4.14 · entries', () => {
  const TEAM = '33333333-3333-4333-8333-333333333333';
  const setup = (category: unknown, users: object[]) => {
    mockLog = [];
    mockNext = (q) => {
      if (q[0] === 'from:team_members') return has(q, 'maybeSingle:') ? { data: { role: 'captain' } } : { data: users.map((u: any) => ({ user_id: u.id })) };
      if (q[0] === 'from:users') return { data: users };
      if (q[0] === 'from:teams') return { data: { id: TEAM, name: 'P3 XI', sport_id: 'sp', deleted_at: null } };
      if (q[0] === 'from:tournaments') return { data: { id: T, name: 'P3 U14', status: 'upcoming', sport_id: 'sp', max_teams: 8, registration_deadline: null, fixtures_generated: false, created_by: 'me', start_date: '2026-10-10', settings: { v: 1, category } } };
      if (q[0] === 'from:tournament_entries' && has(q, 'insert:')) return { data: { id: 'e1', status: 'pending' } };
      if (q[0] === 'from:tournament_entries') return { data: null, count: 0 };
      return { data: [], count: 0 };
    };
  };
  test('a player too old → 400 CATEGORY naming them, nothing inserted', async () => {
    setup({ underAge: 14 }, [{ id: 'u1', name: 'Tara', gender: 'female', dob: '2012-10-11' }, { id: 'u2', name: 'Arjun', gender: 'male', dob: '2011-05-01' }]);
    const r = await run(createEntry, { body: { team_id: TEAM } });
    expect([r.statusCode, r.body.code, r.body.error]).toEqual([400, 'CATEGORY', 'This is an under-14 event, and Arjun is 15 on the start date.']);
    expect(written('tournament_entries', 'insert')).toEqual([]);
  });
  test('the organiser’s add is checked too', async () => {
    setup({ gender: 'women' }, [{ id: 'u1', name: 'Ravi', gender: 'male', dob: null }]);
    const r = await run(directAddTeam, { body: { team_id: TEAM } });
    expect([r.statusCode, r.body.code]).toEqual([400, 'CATEGORY']);
  });
  test('everyone fits → in', async () => {
    setup({ underAge: 14 }, [{ id: 'u1', name: 'Tara', gender: 'female', dob: '2012-10-11' }]);
    const r = await run(createEntry, { body: { team_id: TEAM } });
    expect(r.statusCode).toBe(200);
  });
});

describe('BUILD 4.14 · the draw re-checks', () => {
  test('a player who joined after the entry → the draw is refused, naming team and player', async () => {
    mockLog = [];
    mockNext = (q) => {
      if (q[0] === 'from:tournaments' && has(q, 'update:')) return { data: [{ id: T }] };
      if (q[0] === 'from:tournaments') return { data: { id: T, status: 'upcoming', sport_id: 'sp', format: 'knockout', start_date: '2026-10-10', settings: { v: 1, category: { underAge: 14 } } } };
      if (q[0] === 'from:tournament_entries') return { data: [{ id: 'e1', team_id: 'tA', team: { name: 'P3 Juniors' } }, { id: 'e2', team_id: 'tB', team: { name: 'P3 Colts' } }] };
      if (q[0] === 'from:team_members') return { data: [{ user_id: 'u9' }] };
      if (q[0] === 'from:users') return { data: [{ id: 'u9', name: 'Late Joiner', gender: 'male', dob: '2000-01-01' }] };
      return { data: [] };
    };
    const r = await run(generateFixtures, {});
    expect([r.statusCode, r.body.code, r.body.error]).toEqual([400, 'CATEGORY', 'P3 Juniors: This is an under-14 event, and Late Joiner is 26 on the start date.']);
    expect(mockLog.some((q) => q[0] === 'from:matches' && has(q, 'insert:'))).toBe(false);
  });
});
