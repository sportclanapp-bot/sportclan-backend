/**
 * Phase 4 · K2 — regression tests for backend profile / user-read fixes (see
 * the app repo's phase4/K2.md). Supabase is mocked: every `from()` starts its
 * own query, resolved by `mockNext(q)` — a select naming a column that doesn't
 * exist can be made to error, as PostgREST does.
 */
type Q = string[];
let mockLog: Q[] = [];
let mockNext: (q: Q) => { data?: unknown; error?: unknown; count?: number } = () => ({ data: null, error: null });
jest.mock('../utils/supabase', () => {
  const start = (t: string) => {
    const q: string[] = [`from:${t}`];
    mockLog.push(q);
    const chain: any = {};
    for (const m of ['select', 'in', 'not', 'eq', 'neq', 'is', 'limit', 'maybeSingle', 'single', 'update', 'delete', 'order', 'or', 'ilike', 'range', 'gte', 'gt', 'lt', 'lte', 'upsert', 'contains', 'filter']) {
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
let mockBlockedPair = false;
jest.mock('../utils/blocks', () => ({
  ...jest.requireActual('../utils/blocks'),
  blockedUserIds: jest.fn(async () => mockBlocked),
  isBlockedBetween: jest.fn(async () => mockBlockedPair),
  targetUserHidden: jest.fn(async () => false),
}));
jest.mock('../utils/testContent', () => ({
  hideTestFor: jest.fn(async () => false), excludeTest: (q: unknown) => q, excludeTestEmbed: (q: unknown) => q, testUserIdSet: jest.fn(async () => new Set()),
}));
jest.mock('../utils/sportId', () => ({ resolveSportId: jest.fn(async (s?: string) => (s ? '99999999-9999-4999-8999-999999999999' : undefined)) }));
jest.mock('../utils/sports', () => ({ ...jest.requireActual('../utils/sports'), isSportInactive: jest.fn(async () => false) }));
let mockSlug = 'cricket';
jest.mock('../utils/sportCache', () => ({ ...jest.requireActual('../utils/sportCache'), getSport: jest.fn(async () => ({ slug: mockSlug })) }));
jest.mock('../utils/matchCounts', () => ({
  ...jest.requireActual('../utils/matchCounts'),
  countParticipantsByMatch: jest.fn(async (ids: string[]) => new Map(ids.map((i) => [i, 2]))),
}));
jest.mock('../utils/notify', () => ({ notifyUser: jest.fn(async () => undefined), notifyUsers: jest.fn(async () => undefined), notifyUnlessBlocked: jest.fn(async () => undefined) }));

// eslint-disable-next-line import/first
import { getRival, getUserById, updateMe, getActivityHeatmap, getSportProfile } from '../controllers/users.controller';
// eslint-disable-next-line import/first
import { getUserInsights } from '../controllers/insights.controller';
// eslint-disable-next-line import/first
import { getSeasonRecap } from '../controllers/features.controller';

const ME = '11111111-1111-4111-8111-111111111111';
const A = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const B = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
const PUNE = 'c1111111-1111-4111-8111-111111111111';
const MUMBAI = 'c2222222-2222-4222-8222-222222222222';
const DELHI = 'c3333333-3333-4333-8333-333333333333';
const res = () => {
  const r: any = { statusCode: 200, body: null, setHeader: jest.fn(), set: jest.fn() };
  r.status = jest.fn((c: number) => { r.statusCode = c; return r; });
  r.json = jest.fn((b: unknown) => { r.body = b; return r; });
  return r;
};
const call = async (fn: any, req: object) => { const r = res(); await fn({ userId: ME, params: {}, query: {}, body: {}, headers: {}, ...req }, r); return r; };
const has = (q: Q, s: string) => q.some((c) => c.includes(s));

beforeEach(() => {
  mockLog = [];
  mockNext = () => ({ data: null, error: null });
  mockBlocked = new Set();
  mockBlockedPair = false;
});

describe('K2-33 · the rival search’s state tier works (cities has no state_id)', () => {
  it('K2-33 (c1f3b71): with no rival in my city, the closest one in my STATE beats a closer one elsewhere', async () => {
    const STATE: Record<string, string> = { [PUNE]: 'Maharashtra', [MUMBAI]: 'Maharashtra', [DELHI]: 'Delhi' };
    mockNext = (q) => {
      if (q[0] === 'from:cities') {
        if (has(q, 'state_id')) return { data: null, error: { code: '42703', message: 'column cities.state_id does not exist' } };
        const id = JSON.parse(q.find((c) => c.startsWith('eq:["id"'))!.slice(3))[1];
        return { data: { state: STATE[id] } };
      }
      if (q[0] === 'from:user_sport_profiles' && has(q, 'gt:["rating"')) {
        return { data: [{ user_id: A, rating: 1210, matches_played: 3, wins: 2 }, { user_id: B, rating: 1250, matches_played: 3, wins: 2 }] };
      }
      if (q[0] === 'from:user_sport_profiles') return { data: { rating: 1200, matches_played: 5 } };
      if (q[0] === 'from:users' && has(q, 'in:["id"')) return { data: [{ id: A, name: 'A', city_id: DELHI }, { id: B, name: 'B', city_id: MUMBAI }] };
      if (q[0] === 'from:users') return { data: { city_id: PUNE } };
      return { data: null };
    };
    const r = await call(getRival, { params: { id: ME }, query: { sport_id: 'cricket' } });
    expect(r.body.rival.user_id).toBe(B);
  });
});

describe('K2-37a · another user’s profile carries their full account-type set (SC-221)', () => {
  it('K2-37a (6dcd12a): getUserById returns account_types from the join table', async () => {
    mockNext = (q) => (q[0] === 'from:users' ? { data: { id: A, name: 'A', account_type: 'player' } }
      : q[0] === 'from:user_account_types' ? { data: [{ account_type: 'player' }, { account_type: 'coach' }] } : { data: null });
    const r = await call(getUserById, { params: { id: A } });
    expect(r.body.user?.account_types ?? r.body.account_types).toEqual(['player', 'coach']);
  });
});

describe('K2-51 · profile privacy and validation (SC-246/247/248)', () => {
  it('K2-51a (32b4ff4): another viewer’s read never selects phone, email, coins, referral code, admin flag or prefs', async () => {
    mockNext = (q) => (q[0] === 'from:users' ? { data: { id: A, name: 'A' } } : { data: [] });
    await call(getUserById, { params: { id: A } });
    const sel = mockLog.find((q) => q[0] === 'from:users')!.find((c) => c.startsWith('select:'))!;
    for (const col of ['phone', 'email', 'coin_balance', 'referral_code', 'is_admin', 'notification_preferences', 'password_hash']) {
      expect(sel).not.toMatch(new RegExp(`\\b${col}\\b`));
    }
  });
  it.each(['dip ak', 'dipak!', 'ab', 'x'.repeat(31), '😀😀😀'])('K2-51b (32b4ff4): updateMe username %j → 400 INVALID_USERNAME', async (username) => {
    const r = await call(updateMe, { body: { username } });
    expect([r.statusCode, r.body.code]).toEqual([400, 'INVALID_USERNAME']);
  });
  it.each([
    ['2999-01-01', 'Date of birth can’t be in the future'],
    ['1850-01-01', 'Please enter a valid date of birth'],
    ['not-a-date', 'Date of birth is not a valid date'],
  ])('K2-51c (32b4ff4): updateMe dob %s → 400', async (dob, error) => {
    const r = await call(updateMe, { body: { dob } });
    expect([r.statusCode, r.body.error]).toEqual([400, error]);
  });
});

describe('K2-59 / K2-60 / K2-63 · insights form, streaks and wins', () => {
  const TA = 'aaaaaaaa-0000-4000-8000-00000000000a';
  const TB = 'aaaaaaaa-0000-4000-8000-00000000000b';
  const row = (id: string, day: number, side: 'A' | 'B', m: object) => ({
    team_side: side,
    match: { id, status: 'completed', is_ranked: true, winner_team_id: null, team_a_id: TA, team_b_id: TB, score_summary: {}, created_at: `2026-09-${String(day).padStart(2, '0')}T10:00:00Z`, voided_at: null, ...m },
  });
  const insights = (rows: object[]) => (q: Q) => {
    if (q[0] === 'from:match_participants') {
      // PostgREST can't order parents by a to-one embed — the old query errored.
      if (has(q, 'order:["match.created_at"')) return { data: null, error: { message: 'failed to parse order' } };
      return { data: rows };
    }
    return { data: [] };
  };
  const get = async (rows: object[]) => { mockNext = insights(rows); return (await call(getUserInsights, { params: { id: ME } })).body.insights; };
  it('K2-59 (fb53fa2): the participation query works (no embedded order) — totals and form are filled', async () => {
    const i = await get([row('m1', 1, 'A', { winner_team_id: TA }), row('m2', 2, 'A', { winner_team_id: TB })]);
    expect(i.totalMatches).toBe(2);
    expect(i.formTrend).toEqual(['L', 'W']); // newest first
  });
  it('K2-59 (fb53fa2): the current streak counts back from the MOST RECENT match', async () => {
    const i = await get([row('m1', 1, 'A', { winner_team_id: TB }), row('m2', 2, 'A', { winner_team_id: TA }), row('m3', 3, 'A', { winner_team_id: TA })]);
    expect([i.currentWinStreak, i.bestWinStreak]).toEqual([2, 2]);
  });
  it('K2-60 (ab04535): my side with no team and no winner is a draw, not a null===null win', async () => {
    const i = await get([row('m1', 1, 'A', { team_a_id: null, team_b_id: null, winner_team_id: null })]);
    expect(i.formTrend).toEqual(['D']);
    expect(i.currentWinStreak).toBe(0);
  });
  it('K2-63a (b683504): a teamless pickup won by my side (score_summary.winner_side) is a W in insights', async () => {
    const i = await get([row('m1', 1, 'B', { team_a_id: null, team_b_id: null, score_summary: { winner_side: 'B' } }), row('m2', 2, 'B', { team_a_id: null, team_b_id: null, score_summary: { winner_side: 'A' } })]);
    expect(i.formTrend).toEqual(['L', 'W']);
  });
  it('K2-63b (b683504): …and a win on the activity heatmap', async () => {
    const now = new Date().toISOString();
    mockNext = (q) => (q[0] === 'from:users' ? { data: { id: ME } } : q[0] === 'from:match_participants'
      ? { data: [{ team_side: 'A', match: { id: 'm1', status: 'completed', completed_at: now, winner_team_id: null, team_a_id: null, team_b_id: null, score_summary: { winner_side: 'A' }, voided_at: null } }] }
      : { data: [] });
    const r = await call(getActivityHeatmap, { params: { id: ME } });
    const today = r.body.heatmap[r.body.heatmap.length - 1];
    expect([today.matches, today.wins, today.type]).toEqual([1, 1, 'won']);
  });
});

describe('K2-72 · the 90-day recap’s W/L/D come from the same 90 days (SC-320)', () => {
  it('K2-72 (067de6f): lifetime profile totals don’t leak in; winner_side, then winner_team_id → side, else draw', async () => {
    const TA = 'aaaaaaaa-0000-4000-8000-00000000000a';
    const m = (id: string, extra: object) => ({ id, status: 'completed', is_ranked: true, team_a_id: TA, team_b_id: null, winner_team_id: null, score_summary: {}, created_at: '2026-09-20T10:00:00Z', voided_at: null, ...extra });
    mockNext = (q) => {
      if (q[0] === 'from:user_sport_profiles') return { data: [{ sport_id: 's1', rating: 1400, matches_played: 80, wins: 50, losses: 25, draws: 5 }] };
      if (q[0] === 'from:match_participants') return { data: [
        { team_side: 'A', match: m('m1', { score_summary: { winner_side: 'A' } }) },
        { team_side: 'A', match: m('m2', { winner_team_id: 'bbbbbbbb-0000-4000-8000-00000000000b', team_b_id: 'bbbbbbbb-0000-4000-8000-00000000000b' }) },
        { team_side: 'A', match: m('m3', {}) },
      ] };
      return { data: [], count: 0 };
    };
    const r = await call(getSeasonRecap, { params: { id: ME } });
    expect(r.body.recap).toMatchObject({ totalMatches: 3, wins: 1, losses: 1, draws: 1 });
  });
});

describe('K2-74b · the orphan sport-agnostic city_rank is gone from profile reads (SC-328)', () => {
  it('K2-74b (3408218): getUserById returns no city_rank', async () => {
    mockNext = (q) => (q[0] === 'from:users' ? { data: { id: A, name: 'A' } } : { data: null });
    const r = await call(getUserById, { params: { id: A } });
    expect(r.statusCode).toBe(200);
    expect('city_rank' in r.body.user).toBe(false);
  });
});

describe('K2-75 · Table Tennis’ slug is normalised for its per-sport stats (SC-343)', () => {
  afterEach(() => { mockSlug = 'cricket'; });
  it('K2-75 (e329caf): slug "table-tennis" gets the serve/point sportStats block', async () => {
    mockSlug = 'table-tennis';
    mockNext = (q) => {
      if (q[0] === 'from:user_sport_profiles' && has(q, 'maybeSingle')) return { data: { rating: 1200, matches_played: 2, wins: 1, losses: 1, draws: 0 } };
      if (q[0] === 'from:match_participants' && has(q, 'aces')) return { data: [{ aces: 3, double_faults: 1, first_serve_in: 8, first_serve_total: 10, break_points_won: 1, break_points_faced: 2 }] };
      if (q[0] === 'from:match_participants') return { data: [{ match_id: 'm1', match: { id: 'm1' } }] };
      return { data: [], count: 0 };
    };
    const r = await call(getSportProfile, { params: { id: ME, sportId: 'table-tennis' } });
    expect(r.body.profile.sportStats).toMatchObject({ total_aces: 3, total_double_faults: 1, first_serve_pct: 80 });
  });
});
