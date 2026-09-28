/**
 * Phase 4 · K3 — auth gates, counts and input guards (SC-393/396). Supabase is a
 * recording chain: every from()/rpc() starts its own query and resolves to
 * mockNext(q). publicSurface.unit.test.ts states these rules on local copies;
 * these run the real routes and handlers.
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
jest.mock('../utils/tournamentAuth', () => ({ ...jest.requireActual('../utils/tournamentAuth'), isTournamentOrganiser: jest.fn(async () => true) }));
jest.mock('../utils/blocks', () => ({ ...jest.requireActual('../utils/blocks'), blockedUserIds: jest.fn(async () => new Set()), isBlockedBetween: jest.fn(async () => false) }));

// eslint-disable-next-line import/first
import type { Router } from 'express';
// eslint-disable-next-line import/first
import { authenticateToken } from '../middleware/auth.middleware';
// eslint-disable-next-line import/first
import servicesRouter from '../routes/services.routes';
// eslint-disable-next-line import/first
import badgesRouter from '../routes/badges.routes';
// eslint-disable-next-line import/first
import usersRouter from '../routes/users.routes';
// eslint-disable-next-line import/first
import { getTournamentAnalytics } from '../controllers/features.controller';
// eslint-disable-next-line import/first
import { evaluateBadgesForUser } from '../controllers/badges.controller';
// eslint-disable-next-line import/first
import { getTransactions } from '../controllers/transactions.controller';
// eslint-disable-next-line import/first
import { listProfilePostComments } from '../controllers/profilePosts.controller';
// eslint-disable-next-line import/first
import { createInvite } from '../controllers/invites.controller';
// eslint-disable-next-line import/first
import { getOrCreateDM } from '../controllers/messages.controller';

const ME = '11111111-1111-4111-8111-111111111111';
const OTHER = '22222222-2222-4222-8222-222222222222';
const res = () => {
  const r: any = { statusCode: 200, body: null };
  r.status = jest.fn((c: number) => { r.statusCode = c; return r; });
  r.json = jest.fn((b: unknown) => { r.body = b; return r; });
  return r;
};
const call = async (fn: any, req: object) => { const r = res(); await fn({ userId: ME, params: {}, query: {}, body: {}, headers: {}, ...req }, r); return r; };
const has = (q: Q, s: string) => q.some((c) => c.includes(s));
/** The handler chain Express runs for GET <path> on this router. */
const chain = (router: Router, path: string) => {
  const layer = (router as any).stack.find((l: any) => l.route?.path === path && l.route.methods.get);
  if (!layer) throw new Error(`no GET ${path}`);
  return layer.route.stack.map((s: any) => s.handle);
};

beforeEach(() => { mockLog = []; mockNext = () => ({ data: null, error: null }); });

describe('SC-393 / SC-396 · endpoints that need a token', () => {
  it('K3-39 (6a77e2b): GET /services runs authenticateToken first', () => {
    expect(chain(servicesRouter, '/')[0]).toBe(authenticateToken);
  });
  it.each([
    ['/badges/users/:id/badges', badgesRouter, '/users/:id/badges'],
    ['/users/:id/sport-profile/:sportId', usersRouter, '/:id/sport-profile/:sportId'],
    ['/users/:id/activity-heatmap', usersRouter, '/:id/activity-heatmap'],
    ['/users/:id/season-recap', usersRouter, '/:id/season-recap'],
    ['/users/:id/insights', usersRouter, '/:id/insights'],
  ])('K3-40 (548dd33): GET %s runs authenticateToken first', (_label, router, path) => {
    expect(chain(router as Router, path as string)[0]).toBe(authenticateToken);
  });
});

describe('SC-396 · tournament progress', () => {
  it('K3-40 (548dd33): counts come from count: exact, and 0 fixtures is 0%', async () => {
    mockNext = (q) => {
      if (q[0] === 'from:tournaments') return { data: { created_by: ME } };
      if (q[0] === 'from:tournament_entries') return { count: 8 };
      if (q[0] === 'from:matches' && has(q, '"completed"')) return { count: 1500 };
      if (q[0] === 'from:matches' && has(q, '"scheduled","live"')) return { count: 500, data: [] };
      if (q[0] === 'from:matches') return { count: 2000, data: Array.from({ length: 1000 }, () => ({ id: 'x', status: 'completed' })) };
      return {};
    };
    const r = await call(getTournamentAnalytics, { params: { id: 'T' } });
    expect(r.body).toMatchObject({ matches_completed: 1500, matches_pending: 500, completion_percentage: 75 });
    mockNext = (q) => (q[0] === 'from:tournaments' ? { data: { created_by: ME } } : { count: 0, data: [] });
    expect((await call(getTournamentAnalytics, { params: { id: 'T' } })).body.completion_percentage).toBe(0);
  });
});

describe('SC-396 · badges are not decided on incomplete counts', () => {
  it('K3-41 (150333a): a failed threshold count evaluates nothing — no award on partial data', async () => {
    mockNext = (q) => {
      if (q[0] === 'from:badges') return { data: [{ id: 'b-m', slug: 'first_match', category: 'matches', threshold: 1 }, { id: 'b-c', slug: 'poster', category: 'community', threshold: 1 }] };
      if (q[0] === 'from:user_badges' && !has(q, 'upsert:')) return { data: [] };
      if (q[0] === 'from:user_sport_profiles') return { data: [{ matches_played: 5, wins: 2 }] };
      if (q[0] === 'from:community_posts') return { error: { message: 'timeout' } };
      return { data: null };
    };
    const out = await evaluateBadgesForUser(ME);
    expect(out.awarded).toBe(0);
    expect(mockLog.some((q) => q[0] === 'from:user_badges' && has(q, 'upsert:'))).toBe(false);
  });
});

describe('SC-396 · hostile paging input', () => {
  it('K3-42 (9ba4912): /transactions?limit=-5&offset=-10 reads range(0, 49), not a negative range', async () => {
    mockNext = () => ({ data: [], count: 0 });
    await call(getTransactions, { query: { limit: '-5', offset: '-10' } });
    expect(mockLog.find((q) => q[0] === 'from:transactions')!.join()).toContain('range:[0,49]');
  });
  it('K3-42 (9ba4912): wall-post comments with offset=-10 / limit=-5 read from 0 with the default page', async () => {
    mockNext = (q) => (q[0] === 'from:profile_posts' ? { data: { id: 'p', deleted_at: null } } : { data: [], count: 0 });
    await call(listProfilePostComments, { params: { id: OTHER }, query: { limit: '-5', offset: '-10' } });
    expect(mockLog.find((q) => q[0] === 'from:profile_post_comments' && has(q, 'range:'))!.join()).toContain('range:[0,49]');
  });
});

describe('SC-396 · malformed ids and self-targeting', () => {
  it('K3-44 (65a28e3): an invite with a non-uuid sport or receiver → 400 INVALID_ID before any query', async () => {
    for (const body of [{ receiver_id: OTHER, sport_id: 'not-a-uuid' }, { receiver_id: 'nope', sport_id: OTHER }]) {
      mockLog = [];
      const r = await call(createInvite, { body });
      expect([r.statusCode, r.body.code]).toEqual([400, 'INVALID_ID']);
      expect(mockLog).toHaveLength(0);
    }
  });
  it('K3-44 (65a28e3): a DM with yourself → 400 SELF_DM; a malformed id → 400 INVALID_ID; no chat created', async () => {
    const self = await call(getOrCreateDM, { body: { user_id: ME } });
    expect([self.statusCode, self.body.code]).toEqual([400, 'SELF_DM']);
    const bad = await call(getOrCreateDM, { body: { user_id: 'abc' } });
    expect([bad.statusCode, bad.body.code]).toEqual([400, 'INVALID_ID']);
    expect(mockLog).toHaveLength(0);
  });
});

describe('SC-397 / SC-403 · id path params', () => {
  const routers: Array<[string, Router]> = [
    'account', 'admin', 'badges', 'community', 'invites', 'kudos', 'matches', 'messages',
    'notifications', 'profilePosts', 'scoring', 'teams', 'tournaments', 'users',
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  ].map((n) => [n, require(`../routes/${n}.routes`).default as Router]);
  it.each(routers)('K3-45 (973e163): the %s router turns a malformed :id into 400 INVALID_ID, and lets a uuid through', async (_n, router) => {
    const fns = (router as any).params?.id as Array<(...a: unknown[]) => unknown> | undefined;
    expect(fns?.length).toBeGreaterThan(0);
    const r = res(); const next = jest.fn();
    await fns![0]({}, r, next, 'not-an-id', 'id');
    expect([r.statusCode, r.body?.code]).toEqual([400, 'INVALID_ID']);
    const ok = res(); const next2 = jest.fn();
    await fns![0]({}, ok, next2, ME, 'id');
    expect(next2).toHaveBeenCalled();
  });
  it('K3-49 (6ded434): :sportId is not guarded — /users/:id/sport-profile/cricket takes a slug', () => {
    expect((usersRouter as any).params?.sportId).toBeUndefined();
  });
  it('K3-49 (6ded434): the query-alias middleware is mounted app-wide, ahead of the routes', () => {
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const idx: string = require('fs').readFileSync(require('path').join(__dirname, '..', 'index.ts'), 'utf8');
    const at = idx.indexOf('app.use(queryAliases)');
    expect(at).toBeGreaterThan(0);
    expect(at).toBeLessThan(idx.indexOf("app.use('/users'"));
  });
});
