/**
 * Phase 3 · B04 Profile & wall (28 Sep 2026) — the backend fixes. See the app
 * repo's phase3/B04.md for each finding. Supabase is mocked: every `from()`
 * starts its own query, and each resolves to `mockNext(q)`, where `q` lists
 * that query's builder calls. `mockLog` keeps every query in order.
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
    for (const m of ['select', 'in', 'not', 'eq', 'neq', 'is', 'limit', 'maybeSingle', 'single', 'update', 'delete', 'order', 'or', 'ilike', 'range', 'gte', 'lt', 'upsert']) {
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

// eslint-disable-next-line import/first
import { updateMe, followUser, getFollowers, getFollowing, getRival, getRatingHistory, getSportProfile, updateSportProfile } from '../controllers/users.controller';
// eslint-disable-next-line import/first
import { getSeasonRecap } from '../controllers/features.controller';
// eslint-disable-next-line import/first
import { getUserInsights } from '../controllers/insights.controller';
// eslint-disable-next-line import/first
import { getUserBadges } from '../controllers/badges.controller';
// eslint-disable-next-line import/first
import { listReceivedKudos, getKudosCount } from '../controllers/kudos.controller';
// eslint-disable-next-line import/first
import { listProfilePosts } from '../controllers/profilePosts.controller';

const ME = '11111111-1111-4111-8111-111111111111';
const GHOST = '00000000-0000-4000-8000-000000000000';
const res = () => {
  const r: any = { statusCode: 200, body: null };
  r.status = jest.fn((c: number) => { r.statusCode = c; return r; });
  r.json = jest.fn((b: unknown) => { r.body = b; return r; });
  return r;
};
const call = async (fn: any, req: object) => { const r = res(); await fn({ userId: ME, params: {}, query: {}, body: {}, ...req }, r); return r; };
const tables = () => mockLog.map((q) => q[0]);
const updates = () => mockLog.filter((q) => q.some((c) => c.startsWith('update:')));
const src = (f: string) => fs.readFileSync(path.join(__dirname, '..', 'controllers', f), 'utf8');

beforeEach(() => {
  mockLog = [];
  mockNext = () => ({ data: null, error: null });
});

describe('F1 · PATCH /users/me: bad shapes are worded 400s, never written', () => {
  test.each([
    [{ gender: 'xyz' }, 'INVALID_GENDER'],
    [{ is_available: 'abc' }, 'INVALID_FIELD'],
    [{ show_dob: 'abc' }, 'INVALID_FIELD'],
    [{ city_id: 'xyz' }, 'INVALID_CITY'],
    [{ city_id: GHOST }, 'INVALID_CITY'], // well-formed, but no such city
  ])('%j → 400 %s', async (body, code) => {
    const r = await call(updateMe, { body });
    expect(r.statusCode).toBe(400);
    expect(r.body.code).toBe(code);
    expect(updates()).toHaveLength(0);
  });
  test('good values still save: a known city, a boolean, gender null, other', async () => {
    mockNext = (q) => (q[0] === 'from:cities' ? { data: { id: GHOST } } : { data: { id: ME } });
    for (const body of [{ city_id: GHOST }, { is_available: false }, { gender: null }, { gender: 'other' }]) {
      mockLog = [];
      const r = await call(updateMe, { body });
      expect(r.statusCode).toBe(200);
      expect(updates()).toHaveLength(1);
    }
  });
  test('dob: "" is stored as no date (it used to be written as "")', async () => {
    await call(updateMe, { body: { dob: '' } });
    expect(updates()[0].find((c) => c.startsWith('update:'))).toContain('"dob":null');
  });
});

describe('F7 · a case-only username change is saved, with no cooldown', () => {
  test('qadev → Qadev', async () => {
    mockNext = (q) => (q[0] === 'from:users' && q.some((c) => c.includes('last_username_changed_at'))
      ? { data: { username: 'qadev', last_username_changed_at: new Date().toISOString() } } // inside the cooldown
      : { data: { id: ME } });
    const r = await call(updateMe, { body: { username: 'Qadev' } });
    expect(r.statusCode).toBe(200);
    const u = updates()[0].find((c) => c.startsWith('update:'))!;
    expect(u).toContain('"username":"Qadev"');
    expect(u).not.toContain('last_username_changed_at');
  });
  test('the same username exactly is still left out of the write', async () => {
    mockNext = (q) => (q.some((c) => c.includes('last_username_changed_at')) ? { data: { username: 'qadev' } } : { data: { id: ME } });
    await call(updateMe, { body: { username: 'qadev' } });
    expect(updates()[0].find((c) => c.startsWith('update:'))).not.toContain('username');
  });
});

describe('F2 · a deleted or blocked target is 404 on every profile sub-read', () => {
  // The users lookup finds nobody live → hidden.
  const cases: Array<[string, any, object]> = [
    ['season-recap', getSeasonRecap, { params: { id: GHOST } }],
    ['insights', getUserInsights, { params: { id: GHOST } }],
    ['badges', getUserBadges, { params: { id: GHOST } }],
    ['kudos received', listReceivedKudos, { params: { userId: GHOST } }],
    ['kudos count', getKudosCount, { params: { userId: GHOST } }],
    ['followers', getFollowers, { params: { id: GHOST } }],
    ['following', getFollowing, { params: { id: GHOST } }],
  ];
  test.each(cases)('%s', async (_n, fn, req) => {
    const r = await call(fn, req);
    expect(r.statusCode).toBe(404);
    expect(r.body).toEqual({ error: 'User not found' });
    expect(tables().filter((t) => !['from:users', 'from:user_blocks'].includes(t))).toEqual([]);
  });
  test('blocked either way → 404 too (a live row, but a block between them)', async () => {
    mockNext = (q) => (q[0] === 'from:users' ? { data: { id: GHOST } } : q[0] === 'from:user_blocks' ? { data: { id: 'b1' } } : { data: [] });
    const r = await call(getUserBadges, { params: { id: GHOST } });
    expect(r.statusCode).toBe(404);
  });
  test('rival reads `:id`\'s rating, so it is gated too', () => {
    expect(src('users.controller.ts')).toMatch(/export async function getRival[\s\S]*?if \(await targetUserHidden\(id, userId\)\)/);
  });
});

describe('F3 · an unknown sport is a 400 on all four per-sport reads/writes', () => {
  beforeEach(() => { mockNext = (q) => (q[0] === 'from:sports' ? { data: [{ id: 'sp1', name: 'Cricket', slug: 'cricket' }] } : { data: null }); });
  test.each([
    ['rating-history', getRatingHistory, { params: { id: ME }, query: { sport_id: 'xyz' } }],
    ['sport-profile', getSportProfile, { params: { id: ME, sportId: 'xyz' } }],
    ['sport-profile save', updateSportProfile, { params: { id: ME, sportId: 'xyz' }, body: { role: 'batter' } }],
    ['rival', getRival, { params: { id: ME }, query: { sport_id: 'xyz' } }],
  ])('%s', async (_n, fn: any, req) => {
    const r = await call(fn, req);
    expect(r.statusCode).toBe(400);
    expect(r.body.code).toBe('INVALID_SPORT');
  });
  test('the made-up fallback is gone', () => {
    expect(src('users.controller.ts')).not.toMatch(/resolveSportId\(rawSportId\)\) \?\? rawSportId/);
  });
});

describe('F10 · follow: only a live account', () => {
  test('unknown or deleted target → 404, no insert', async () => {
    const r = await call(followUser, { params: { id: GHOST } });
    expect(r.statusCode).toBe(404);
    expect(mockLog.some((q) => q.some((c) => c.startsWith('insert:')))).toBe(false);
  });
  test('a foreign-key miss on insert → 404, not 500', async () => {
    mockNext = (q) => (q.some((c) => c.startsWith('insert:')) ? { error: { code: '23503', message: 'fk' } }
      : q[0] === 'from:users' ? { data: { id: GHOST } } : { data: null });
    const r = await call(followUser, { params: { id: GHOST } });
    expect(r.statusCode).toBe(404);
  });
});

describe('F14 · GET /profile-posts: malformed user_id or cursor → 400', () => {
  test.each([
    [{ user_id: 'xyz' }, 'INVALID_ID'],
    [{ user_id: ME, cursor: 'abc' }, 'INVALID_CURSOR'],
    [{ user_id: ME, cursor: '2026-01-01T00:00:00Z|xyz' }, 'INVALID_CURSOR'],
  ])('%j', async (query, code) => {
    const r = await call(listProfilePosts, { query });
    expect(r.statusCode).toBe(400);
    expect(r.body.code).toBe(code);
    expect(tables()).not.toContain('from:profile_posts');
  });
  test('a good keyset cursor still pages', async () => {
    mockNext = () => ({ data: [] });
    const r = await call(listProfilePosts, { query: { user_id: ME, cursor: `2026-01-01T00:00:00Z|${GHOST}` } });
    expect(r.statusCode).toBe(200);
  });
});

describe('F16 · kudos count uses the list\'s exclusions', () => {
  test('deleted senders are left out of the count', async () => {
    mockNext = (q) => (q[0] === 'from:users' ? { data: { id: GHOST } } : { data: null, count: 3 });
    const r = await call(getKudosCount, { params: { userId: GHOST } });
    expect(r.body).toEqual({ count: 3 });
    const kudos = mockLog.find((q) => q[0] === 'from:kudos')!;
    expect(kudos.join()).toContain('sender:users!from_user_id!inner(id)');
    expect(kudos).toContain('is:["sender.deleted_at",null]');
  });
});

describe('F5 / F15 / F17 · worded errors and the review rating', () => {
  test('the wall link error is worded for a person', () => {
    expect(src('profilePosts.controller.ts')).toContain("error: 'Enter a link that starts with https://', code: 'INVALID_LINK'");
    expect(src('profilePosts.controller.ts')).not.toContain('link_url must be');
  });
  test('upload errors never echo the image library', () => {
    const u = src('uploads.controller.ts');
    expect(u).not.toMatch(/json\(\{ error: '[^']*' \+ \(err/);
    expect(u.match(/That file isn\\u2019t an image we can use\. Try a JPG, PNG, WebP or HEIC photo\./g)).toHaveLength(3);
  });
  test('a review rating must be a whole number of stars; the comment is capped', () => {
    const s = src('users.controller.ts');
    expect(s).toContain("if (!Number.isInteger(rating) || rating < 1 || rating > 5) return res.status(400).json({ error: 'rating 1-5 required' });");
    expect(s).toMatch(/comment\.length > LIMITS\.postTextMax/);
  });
});
