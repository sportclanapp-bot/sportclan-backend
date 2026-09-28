/**
 * Phase 4 · K3 — what counts toward a record, frozen expense splits, and the
 * post-count endpoint (SC-413/417/434). Supabase is a recording chain: every
 * from()/rpc() starts its own query and resolves to mockNext(q).
 */
type Q = string[];
let mockLog: Q[] = [];
let mockNext: (q: Q) => { data?: unknown; error?: unknown; count?: number | null } = () => ({ data: null, error: null });
jest.mock('../utils/supabase', () => {
  const start = (head: string) => {
    const q: string[] = [head];
    mockLog.push(q);
    const chain: any = {};
    for (const m of ['select', 'in', 'not', 'eq', 'neq', 'is', 'limit', 'update', 'delete', 'order', 'or', 'ilike', 'range', 'gte', 'gt', 'lt', 'lte', 'upsert', 'insert', 'filter', 'match', 'contains', 'overlaps', 'textSearch', 'returns', 'abortSignal', 'like', 'not', 'csv']) {
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
jest.mock('../utils/blocks', () => ({ ...jest.requireActual('../utils/blocks'), targetUserHidden: jest.fn(async () => false) }));

// eslint-disable-next-line import/first
import { getSeasonRecap } from '../controllers/features.controller';
// eslint-disable-next-line import/first
import { getUserInsights } from '../controllers/insights.controller';
// eslint-disable-next-line import/first
import { getExpenseSummary } from '../controllers/teamExpenses.controller';
// eslint-disable-next-line import/first
import { getMyPostCount } from '../controllers/community.controller';

const ME = '11111111-1111-4111-8111-111111111111';
const B = '22222222-2222-4222-8222-222222222222';
const C = '33333333-3333-4333-8333-333333333333';
const TEAM = '44444444-4444-4444-8444-444444444444';
const res = () => {
  const r: any = { statusCode: 200, body: null };
  r.status = jest.fn((c: number) => { r.statusCode = c; return r; });
  r.json = jest.fn((b: unknown) => { r.body = b; return r; });
  return r;
};
const call = async (fn: any, req: object) => { const r = res(); await fn({ userId: ME, params: {}, query: {}, body: {}, ...req }, r); return r; };
const has = (q: Q, s: string) => q.some((c) => c.includes(s));

beforeEach(() => { mockLog = []; mockNext = () => ({ data: null, error: null }); });

describe('SC-413 · recap and insights use the SC-283 rule', () => {
  const recent = new Date().toISOString();
  const m = (id: string, extra: object = {}) => ({ id, status: 'completed', is_ranked: false, winner_team_id: null, team_a_id: null, team_b_id: null, score_summary: { winner_side: 'A' }, created_at: recent, voided_at: null, sport_id: 's', ...extra });
  const db = (q: Q) => {
    if (q[0] === 'from:match_participants' && has(q, 'match:matches')) return { data: [
      { match_id: 'solo', team_side: 'A', match: m('solo') },     // casual vs a phantom: 1 real participant
      { match_id: 'real', team_side: 'A', match: m('real') },     // casual, 2 real participants
      { match_id: 'rank', team_side: 'A', match: m('rank', { is_ranked: true }) },
    ] };
    if (q[0] === 'from:match_participants') return { data: [{ match_id: 'solo' }, { match_id: 'real' }, { match_id: 'real' }, { match_id: 'rank' }] };
    return { data: [], count: 0 };
  };
  it('K3-51 (ca954c3): the season recap skips a casual match with one real participant', async () => {
    mockNext = db;
    const r = await call(getSeasonRecap, { params: { id: ME } });
    expect(r.body.recap.totalMatches).toBe(2);
    expect(r.body.recap.wins).toBe(2);
  });
  it('K3-51 (ca954c3): insights skip it too', async () => {
    mockNext = db;
    const r = await call(getUserInsights, { params: { id: ME } });
    expect(r.body.insights.totalMatches).toBe(2);
    expect(r.body.insights.formTrend).toEqual(['W', 'W']);
  });
});

describe('SC-417 · a recorded split does not move when the roster does', () => {
  it('K3-53 (b3d766a): ₹132 captured across 3 stays ₹44 each after a member leaves (roster now 2)', async () => {
    mockNext = (q) => {
      if (q[0] === 'from:team_members' && q.includes('maybeSingle')) return { data: { id: 'm' } };
      if (q[0] === 'from:team_members') return { data: [{ user_id: ME }, { user_id: B }], count: 2 };
      if (q[0] === 'from:team_expenses') return { data: [{ amount: 132, split_among: [ME, B, C] }] };
      return { data: null };
    };
    const r = await call(getExpenseSummary, { params: { id: TEAM } });
    expect([r.body.total, r.body.memberCount, r.body.perMember]).toEqual([132, 3, 44]);
  });
});

describe('SC-434 · no post limit is reported', () => {
  it('K3-60 (9b284cd): /community/posts/my-count answers limit and remaining as null, not 5 / 0', async () => {
    mockNext = () => ({ count: 8 });
    const r = await call(getMyPostCount, {});
    expect(r.body).toEqual({ count: 16, limit: null, remaining: null });
  });
});
