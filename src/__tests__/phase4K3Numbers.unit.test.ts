/**
 * Phase 4 · K3 — displayed numbers that were wrong (SC-368/370/371): the weekly
 * digest, review totals, cricket BEST, team member count. Supabase is a
 * recording chain: every from()/rpc() starts its own query and resolves to
 * mockNext(q). A query against a table/column prod does not have resolves to
 * an error, as PostgREST would.
 */
type Q = string[];
let mockLog: Q[] = [];
let mockNext: (q: Q) => { data?: unknown; error?: unknown; count?: number | null } = () => ({ data: null, error: null });
jest.mock('../utils/supabase', () => {
  const start = (head: string) => {
    const q: string[] = [head];
    mockLog.push(q);
    const chain: any = {};
    for (const m of ['select', 'in', 'not', 'eq', 'neq', 'is', 'limit', 'update', 'delete', 'order', 'or', 'ilike', 'range', 'gte', 'gt', 'lt', 'lte', 'upsert', 'insert', 'filter', 'match', 'contains', 'overlaps', 'textSearch', 'returns', 'abortSignal']) {
      chain[m] = jest.fn((...a: unknown[]) => { q.push(`${m}:${JSON.stringify(a)}`); return chain; });
    }
    const done = () => ({ data: null, error: null, ...mockNext(q) });
    chain.single = jest.fn(async () => { q.push('single'); return done(); });
    chain.maybeSingle = jest.fn(async () => { q.push('maybeSingle'); return done(); });
    chain.then = (ok: (v: unknown) => unknown, bad?: (e: unknown) => unknown) => {
      try { return Promise.resolve(ok(done())); } catch (e) { return bad ? bad(e) : Promise.reject(e); }
    };
    return chain;
  };
  return { supabase: { from: jest.fn((t: string) => start(`from:${t}`)), rpc: jest.fn((n: string, args?: unknown) => start(`rpc:${n}:${JSON.stringify(args ?? null)}`)) } };
});
jest.mock('../utils/notify', () => ({ notifyUser: jest.fn(async () => undefined), notifyUsers: jest.fn(), notifyUnlessBlocked: jest.fn() }));
jest.mock('../utils/blocks', () => ({
  ...jest.requireActual('../utils/blocks'),
  blockedUserIds: jest.fn(async () => new Set()),
  targetUserHidden: jest.fn(async () => false),
}));
jest.mock('../utils/sportId', () => ({ resolveSportId: jest.fn(async () => '99999999-9999-4999-8999-999999999999') }));
jest.mock('../utils/sports', () => ({ ...jest.requireActual('../utils/sports'), isSportInactive: jest.fn(async () => false) }));
jest.mock('../utils/sportCache', () => ({ getSport: jest.fn(async () => ({ slug: 'cricket' })) }));
jest.mock('../utils/teamRecord', () => ({ computeTeamRecord: jest.fn(async () => ({ played: 0 })) }));

// eslint-disable-next-line import/first
import { weeklyDigest } from '../controllers/notifications.controller';
// eslint-disable-next-line import/first
import { getReviews, getSportProfile } from '../controllers/users.controller';
// eslint-disable-next-line import/first
import { getTeam } from '../controllers/teams.controller';

const ME = '11111111-1111-4111-8111-111111111111';
const SCORER = '22222222-2222-4222-8222-222222222222';
const TEAM = '33333333-3333-4333-8333-333333333333';
const res = () => {
  const r: any = { statusCode: 200, body: null };
  r.status = jest.fn((c: number) => { r.statusCode = c; return r; });
  r.json = jest.fn((b: unknown) => { r.body = b; return r; });
  return r;
};
const call = async (fn: any, req: object) => { const r = res(); await fn({ userId: ME, params: {}, query: {}, body: {}, ...req }, r); return r; };
const has = (q: Q, s: string) => q.some((c) => c.includes(s));
const missing = { data: null, error: { code: '42703', message: 'column does not exist' } };

beforeEach(() => { mockLog = []; mockNext = () => ({ data: null, error: null }); });

describe('weekly digest', () => {
  const recent = new Date(Date.now() - 86400000).toISOString();
  const digest = (q: Q) => {
    if (q[0] === 'from:posts') return { data: null, error: { code: 'PGRST205', message: "Could not find the table 'public.posts'" } };
    if (q[0] === 'from:community_posts') return has(q, '"author_id"') ? { data: [{ id: 'p1' }, { id: 'p2' }] } : missing;
    if (q[0] === 'from:post_likes') return { count: 4 };
    if (q[0] === 'from:match_participants') {
      if (has(q, 'created_at')) return missing; // match_participants has no created_at
      return { data: [
        { match_id: 'm1', match: { status: 'completed', updated_at: recent, scheduled_at: recent } },
        { match_id: 'm2', match: { status: 'completed', updated_at: recent, scheduled_at: recent } },
        { match_id: 'm3', match: { status: 'upcoming', updated_at: recent, scheduled_at: recent } },
        { match_id: 'm4', match: { status: 'completed', updated_at: '2020-01-01T00:00:00Z', scheduled_at: '2020-01-01T00:00:00Z' } },
      ] };
    }
    return { data: null };
  };
  it('K3-14 (561487d): likes received are read from community_posts by author_id (there is no posts table)', async () => {
    mockNext = digest;
    const r = await call(weeklyDigest, {});
    expect(r.body.stats.posts_liked).toBe(4);
  });
  it('K3-19 (cebe83e): matches_played counts completed matches in the window, dated by the match', async () => {
    mockNext = digest;
    const r = await call(weeklyDigest, {});
    expect(r.body.stats.matches_played).toBe(2);
  });
});

describe('SC-370 · review count and average cover every review, not the 50-row page', () => {
  it('K3-18 (c1ee88e): 120 reviews → count 120 and the true mean', async () => {
    const page = Array.from({ length: 50 }, (_, i) => ({ id: `r${i}`, rating: 5 }));
    const all = [...Array.from({ length: 50 }, () => ({ rating: 5 })), ...Array.from({ length: 70 }, () => ({ rating: 1 }))];
    mockNext = (q) => (q[0] === 'from:user_reviews' ? (has(q, 'select:["id, rating') ? { data: page } : { data: all }) : { data: null });
    const r = await call(getReviews, { params: { id: ME } });
    expect(r.body.count).toBe(120);
    expect(r.body.avgRating).toBe(Math.round(((50 * 5 + 70) / 120) * 10) / 10);
    expect(r.body.reviews).toHaveLength(50);
  });
});

describe('SC-371 · cricket profile from match events', () => {
  it('K3-20a (05ed1fd): BEST is the best single match, and a ball is credited to the batsman, not the scorer', async () => {
    const ev = (match_id: string, runs: number, created_by: string, batsman_id?: string) => ({ match_id, event_type: 'ball', created_by, payload: { runs, ...(batsman_id ? { batsman_id } : {}) } });
    mockNext = (q) => {
      if (q[0] === 'from:user_sport_profiles' && q.includes('maybeSingle')) return { data: { rating: 1200, matches_played: 2 } };
      if (q[0] === 'from:match_participants') return { data: [{ match_id: 'm1' }, { match_id: 'm2' }] };
      if (q[0] === 'from:innings_stats') return { data: [] };
      if (q[0] === 'from:match_events') return { data: [
        ev('m1', 4, SCORER, ME), ev('m1', 6, SCORER, ME),   // 10 in match 1, entered by the scorer
        ev('m2', 4, SCORER, ME),                            // 4 in match 2
        ev('m2', 6, ME, SCORER),                            // I entered it, the other batter faced it
      ] };
      return { data: null };
    };
    const r = await call(getSportProfile, { params: { id: ME, sportId: 'cricket' } });
    const s = r.body.profile.sportStats ?? r.body.sportStats ?? r.body.profile;
    expect(s.total_runs).toBe(14);
    expect(s.highest_score).toBe(10);
  });
});

describe('SC-371 · team member_count is a real count', () => {
  it('K3-20b (05ed1fd): member_count and is_full come from count: exact, not the loaded array length', async () => {
    mockNext = (q) => {
      if (q[0] === 'from:teams') return { data: { id: TEAM, name: 'Pune XI', is_public: true } };
      if (q[0] === 'from:team_members' && has(q, '"head":true')) return { count: 50 };
      if (q[0] === 'from:team_members' && q.includes('maybeSingle')) return { data: { id: 'm' } };
      if (q[0] === 'from:team_members') return { data: [{ id: 'a', user: { id: ME } }] }; // only one row loaded
      return { data: null, count: 0 };
    };
    const r = await call(getTeam, { params: { id: TEAM } });
    const t = r.body.team ?? r.body;
    expect(t.member_count).toBe(50);
    // Oct 2026 (Dipak): no member cap — never full, no max_members.
    expect(t.is_full).toBe(false);
    expect(t.max_members).toBeUndefined();
  });
});
