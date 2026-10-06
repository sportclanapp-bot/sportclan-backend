/**
 * Phase 4 · K1 (rows K1-40c/d, K1-41a/b/d, K1-42, K1-44, K1-45a, K1-50e) —
 * clean 400s instead of 500s, bounds on text and money, the 5xx backstop that
 * scrubs only 500s, a closed poll, /users/me totals, a racing team join.
 * Supabase is mocked: each from() is its own query → mockNext(q).
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
jest.mock('../utils/blocks', () => ({
  ...jest.requireActual('../utils/blocks'),
  isBlockedBetween: jest.fn(async () => false),
  blockedUserIds: jest.fn(async () => new Set()),
}));
jest.mock('../utils/notify', () => ({
  notifyUser: jest.fn(), notifyUsers: jest.fn(), notifyUnlessBlocked: jest.fn(), sendPushToUsers: jest.fn(), allowedRecipients: jest.fn(async () => []),
  matchAudienceIds: jest.fn(async () => []), matchFollowerIds: jest.fn(async () => []),
}));
jest.mock('../utils/testContent', () => ({ hideTestFor: jest.fn(async () => false), excludeTest: (q: unknown) => q, testUserIdSet: jest.fn(async () => new Set()) }));

// eslint-disable-next-line import/first
import { votePoll, createPost, createComment, updatePost } from '../controllers/community.controller';
// eslint-disable-next-line import/first
import { validateSportForCreate } from '../utils/sports';
// eslint-disable-next-line import/first
import { createTournament } from '../controllers/tournaments.controller';
// eslint-disable-next-line import/first
import { cleanTeamName, joinTeamByCode } from '../controllers/teams.controller';
// eslint-disable-next-line import/first
import { sanitizeErrorResponses } from '../middleware/errorSanitizer';
// eslint-disable-next-line import/first
import { sanitizeError } from '../utils/response';
// eslint-disable-next-line import/first
import { addExpense } from '../controllers/teamExpenses.controller';
// eslint-disable-next-line import/first
import { updateMe, getMe } from '../controllers/users.controller';

const ME = '11111111-1111-4111-8111-111111111111';
const X = '22222222-2222-4222-8222-222222222222';
const SPORT = '33333333-3333-4333-8333-333333333333';
const res = () => {
  const r: any = { statusCode: 200, body: null, setHeader: jest.fn() };
  r.status = jest.fn((c: number) => { r.statusCode = c; return r; });
  r.json = jest.fn((b: unknown) => { r.body = b; return r; });
  return r;
};
const call = async (fn: any, req: object) => {
  const r = res();
  await fn({ userId: ME, params: {}, query: {}, body: {}, headers: {}, get: () => undefined, header: () => undefined, ...req }, r);
  return r;
};
const writes = () => mockLog.filter((q) => q.some((c) => /^(insert|update|upsert|delete):/.test(c)));

beforeEach(() => { mockLog = []; mockNext = () => ({ data: null, error: null }); });

describe('K1-40c (41618ad) · SC-43 a closed poll takes no votes', () => {
  it('K1-40c (41618ad): voting on a closed poll → 409, nothing written', async () => {
    mockNext = (q) => (q[0] === 'from:community_posts'
      ? { data: { id: X, poll_options: [{ id: 'o1', text: 'a', vote_count: 0 }], post_type: 'poll', is_closed: true, author_id: X, allow_multiple: false, deleted_at: null } }
      : { data: null });
    const r = await call(votePoll, { params: { id: X }, body: { option_id: 'o1' } });
    expect(r.statusCode).toBe(409);
    expect(r.body.error).toBe('This poll is closed');
    expect(writes()).toHaveLength(0);
  });
});

describe('K1-40d (41618ad) · SC-40 post and comment text is capped at 500', () => {
  const long = 'a'.repeat(501);
  it('K1-40d (41618ad): create post → 400', async () => {
    const r = await call(createPost, { body: { content: long, post_type: 'general' } });
    expect(r.statusCode).toBe(400);
    expect(r.body.error).toBe('Post must be 500 characters or fewer');
    expect(writes()).toHaveLength(0);
  });
  it('K1-40d (41618ad): edit post → 400', async () => {
    const r = await call(updatePost, { params: { id: X }, body: { content: long } });
    expect(r.statusCode).toBe(400);
    expect(r.body.error).toBe('Post must be 500 characters or fewer');
  });
  it('K1-40d (41618ad): comment → 400', async () => {
    const r = await call(createComment, { params: { id: X }, body: { content: long } });
    expect(r.statusCode).toBe(400);
    expect(r.body.error).toBe('Comment must be 500 characters or fewer');
  });
});

describe('K1-41a (d5aa529) · SC-36 a bad sport is a 400, not a uuid-cast 500', () => {
  it('K1-41a (d5aa529): malformed id refused before any query', async () => {
    expect(await validateSportForCreate('cricket')).toBe('A valid sport is required');
    expect(await validateSportForCreate(null)).toBe('A valid sport is required');
    expect(mockLog).toHaveLength(0);
  });
  it('K1-41a (d5aa529): unknown / deactivated / fine', async () => {
    mockNext = () => ({ data: null });
    expect(await validateSportForCreate(SPORT)).toBe('Unknown sport');
    mockNext = () => ({ data: { id: SPORT, is_active: false } });
    expect(await validateSportForCreate(SPORT)).toBe('This sport is not available');
    mockNext = () => ({ data: { id: SPORT, is_active: true } });
    expect(await validateSportForCreate(SPORT)).toBeNull();
  });
});

describe('K1-41b (d5aa529) · SC-37/39 tournament format and size, team name', () => {
  const base = { sport_id: SPORT, name: 'Monsoon Cup', format: 'knockout', max_teams: 8 };
  beforeEach(() => { mockNext = (q) => (q[0] === 'from:sports' ? { data: { id: SPORT, is_active: true, slug: 'cricket' } } : { data: null }); });
  it('K1-41b (d5aa529): an unknown format → 400 naming the formats, nothing inserted', async () => {
    const r = await call(createTournament, { body: { ...base, format: 'double_elimination' } }); // BUILD 4.15: swiss is a format now
    expect(r.statusCode).toBe(400);
    expect(r.body.error).toMatch(/^Invalid format\. Must be one of: knockout, league, round_robin, groups_knockout, swiss/);
    expect(writes()).toHaveLength(0);
  });
  // Oct 2026 (Dipak): no upper cap — 65 (or 512) is fine; below 2 or fractional still refused.
  it.each([1, 0, 2.5])('K1-41b (d5aa529): max_teams %p → 400', async (n) => {
    const r = await call(createTournament, { body: { ...base, max_teams: n } });
    expect(r.statusCode).toBe(400);
    expect(r.body.error).toBe('max_teams must be a whole number, at least 2');
  });
  it('K1-41b (d5aa529): a team name over 60 characters is refused', () => {
    expect(cleanTeamName('x'.repeat(61)).error).toBe('Team name must be 60 characters or fewer');
    expect(cleanTeamName('x'.repeat(60)).value).toHaveLength(60);
  });
});

describe('K1-41d / K1-44 · the 5xx backstop', () => {
  const run = (status: number, body: object) => {
    const r: any = { statusCode: status };
    const sent: unknown[] = [];
    r.json = (b: unknown) => { sent.push(b); return r; };
    const spy = jest.spyOn(console, 'error').mockImplementation(() => undefined);
    sanitizeErrorResponses({ method: 'GET', originalUrl: '/x' } as any, r, () => undefined);
    r.json(body);
    spy.mockRestore();
    return sent[0] as any;
  };
  it('K1-41d (d5aa529): a 500 carrying a raw Postgres message goes out generic', () => {
    expect(run(500, { error: 'duplicate key value violates unique constraint "teams_join_code_key"' })).toEqual({ error: 'Internal server error' });
    expect(run(500, { message: 'relation "x" does not exist' })).toEqual({ message: 'Internal server error' });
    expect(run(400, { error: 'Content is required' })).toEqual({ error: 'Content is required' });
  });
  it('K1-41d (d5aa529): sanitizeError never returns the DB text', () => {
    const spy = jest.spyOn(console, 'error').mockImplementation(() => undefined);
    expect(sanitizeError({ message: 'column users.full_name does not exist' })).toBe('Internal server error');
    spy.mockRestore();
  });
  it('K1-41d (d5aa529): the backstop is mounted before the routes, the final handler after', () => {
    const idx = fs.readFileSync(path.join(__dirname, '..', 'index.ts'), 'utf8');
    expect(idx.indexOf('app.use(sanitizeErrorResponses)')).toBeGreaterThan(0);
    expect(idx.indexOf('app.use(sanitizeErrorResponses)')).toBeLessThan(idx.indexOf("app.use('/auth'"));
    expect(idx.indexOf('app.use(globalErrorHandler)')).toBeGreaterThan(idx.indexOf("app.use('/auth'"));
  });
  it('K1-44 (b63f79c): an intentional 503 keeps its message', () => {
    expect(run(503, { error: 'We could not send a code to that number. Please try again.' }))
      .toEqual({ error: 'We could not send a code to that number. Please try again.' });
  });
});

describe('K1-42 (0520757) · SC-38/39 money and profile bounds', () => {
  const member = (q: Q) => (q[0] === 'from:team_members' ? { data: { id: 'm' } } : { data: null });
  it.each([-5, 0, 1_000_000_000])('K1-42 (0520757): expense amount %p → 400, nothing inserted', async (amount) => {
    mockNext = member;
    const r = await call(addExpense, { params: { id: X }, body: { title: 'Balls', amount, category: 'equipment' } });
    expect(r.statusCode).toBe(400);
    expect(writes()).toHaveLength(0);
  });
  it('K1-42 (0520757): bio over 500 / name over 60 on profile edit → 400, nothing written', async () => {
    let r = await call(updateMe, { body: { bio: 'b'.repeat(501) } });
    expect([r.statusCode, r.body.error]).toEqual([400, 'Bio must be 500 characters or fewer']);
    r = await call(updateMe, { body: { name: 'n'.repeat(61) } });
    expect([r.statusCode, r.body.error]).toEqual([400, 'Name must be 60 characters or fewer']);
    expect(writes()).toHaveLength(0);
  });
});

describe('K1-45a (5d4ac1a) · SC-46 /users/me carries real totals', () => {
  it('K1-45a (5d4ac1a): total_matches is the sum of matches_played across sports', async () => {
    mockNext = (q) => {
      if (q[0] === 'from:users' && q.some((c) => c.startsWith('maybeSingle'))) return { data: { id: ME, name: 'Me', account_type: 'player' } };
      if (q[0] === 'from:user_sport_profiles') return { data: [{ matches_played: 7 }, { matches_played: 5 }, { matches_played: null }] };
      return { data: [], count: 0 };
    };
    const r = await call(getMe, {});
    expect(r.statusCode).toBe(200);
    expect(r.body.user.total_matches).toBe(12);
  });
});

describe('K1-50e (34c2985) · SC-64 a racing second join is a 409, not a 500', () => {
  it('K1-50e (34c2985): the unique violation on insert → 409 "Already a member"', async () => {
    mockNext = (q) => {
      if (q[0] === 'from:teams') return { data: { id: X, name: 'Pune XI', join_policy: 'open', deleted_at: null } };
      if (q[0] === 'from:team_members' && q.some((c) => c.startsWith('insert:'))) return { data: null, error: { code: '23505', message: 'duplicate key value violates unique constraint' } };
      return { data: null, count: 0 };
    };
    const r = await call(joinTeamByCode, { body: { join_code: 'abc123' } });
    expect(r.statusCode).toBe(409);
    expect(r.body).toEqual({ error: 'Already a member of this team' });
  });
});
