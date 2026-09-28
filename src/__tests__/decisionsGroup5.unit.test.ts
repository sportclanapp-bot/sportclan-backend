/**
 * Dipak's decisions, group 5 (29 Sep 2026) — see the app repo's
 * phase3/DECISIONS.md.
 *  22  "Prefer not to say" is its own gender (migration 111, applied);
 *   7  a venue's creator (or an admin) deletes it — soft, the row stays;
 *      deleted venues leave the directory and their name can be added again
 *      (migration 112, applied);
 * 14b  the "Announcements" switch: a broadcast's PUSH skips anyone who turned
 *      it off; the in-app notification still reaches everyone.
 * Supabase is mocked the way group 2 mocks it: each query resolves to
 * `mockNext(q)`, where `q` lists that query's builder calls.
 */
import fs from 'fs';
import path from 'path';

type Q = string[];
let mockLog: Q[] = [];
let mockNext: (q: Q) => { data?: unknown; error?: unknown; count?: number } = () => ({ data: null, error: null });
jest.mock('../utils/supabase', () => {
  const start = (first: string) => {
    const q: string[] = [first];
    mockLog.push(q);
    const chain: any = {};
    for (const m of ['select', 'in', 'not', 'eq', 'neq', 'is', 'limit', 'maybeSingle', 'single', 'update', 'delete', 'order', 'or', 'range', 'gt', 'gte', 'lt', 'like', 'ilike', 'upsert']) {
      chain[m] = jest.fn((...a: unknown[]) => { q.push(`${m}:${JSON.stringify(a)}`); return chain; });
    }
    chain.insert = jest.fn((row: unknown) => { q.push(`insert:${JSON.stringify(row)}`); return chain; });
    chain.then = (ok: (v: unknown) => unknown, bad?: (e: unknown) => unknown) => {
      try { return Promise.resolve(ok({ data: null, error: null, ...mockNext(q) })); } catch (e) { return bad ? bad(e) : Promise.reject(e); }
    };
    return chain;
  };
  return {
    supabase: {
      from: jest.fn((t: string) => start(`from:${t}`)),
      rpc: jest.fn((fn: string, args: unknown) => start(`rpc:${fn}:${JSON.stringify(args)}`)),
    },
  };
});
let mockAdmin = false;
jest.mock('../middleware/admin.middleware', () => ({ isAdminUser: jest.fn(async () => mockAdmin) }));
jest.mock('../utils/tournamentAuth', () => ({ logAdminAction: jest.fn(async () => undefined) }));
jest.mock('../utils/testContent', () => ({ hideTestFor: jest.fn(async () => false), excludeTest: (q: unknown) => q }));
jest.mock('../utils/expoPush', () => ({ sendPushToTokens: jest.fn(async (t: string[]) => t.length) }));

// eslint-disable-next-line import/first
import { updateMe } from '../controllers/users.controller';
// eslint-disable-next-line import/first
import { GENDERS } from '../utils/profileRules';
// eslint-disable-next-line import/first
import { searchVenues, deleteVenue, updateVenue, upsertVenue } from '../controllers/venues.controller';
// eslint-disable-next-line import/first
import { broadcastAnnouncement, wantsAnnouncementPush } from '../controllers/admin.controller';
// eslint-disable-next-line import/first
import { sendPushToTokens } from '../utils/expoPush';

const ME = '11111111-1111-4111-8111-111111111111';
const OTHER = '22222222-2222-4222-8222-222222222222';
const V = '33333333-3333-4333-8333-333333333333';
const V2 = '44444444-4444-4444-8444-444444444444';
const res = () => {
  const r: any = { statusCode: 200, body: null };
  r.status = jest.fn((c: number) => { r.statusCode = c; return r; });
  r.json = jest.fn((b: unknown) => { r.body = b; return r; });
  r.setHeader = jest.fn();
  return r;
};
const call = async (fn: any, req: any) => { const r = res(); await fn({ userId: ME, params: {}, query: {}, body: {}, headers: {}, ...req }, r); return r; };
const has = (q: Q, s: string) => q.some((x) => x.includes(s));
const updates = () => mockLog.filter((q) => q.some((x) => x.startsWith('update:')));
const inserts = () => mockLog.filter((q) => q.some((x) => x.startsWith('insert:')));
const flush = async () => { for (let i = 0; i < 10; i++) await new Promise((r) => setImmediate(r)); };
const root = path.join(__dirname, '..', '..');
const read = (f: string) => fs.readFileSync(path.join(root, f), 'utf8');
const push = sendPushToTokens as jest.Mock;

beforeEach(() => {
  mockLog = [];
  mockAdmin = false;
  mockNext = () => ({ data: null, error: null });
  jest.clearAllMocks();
});

describe('22 · "Prefer not to say" is its own gender', () => {
  test('the allowed list matches users_gender_check (migration 111)', () => {
    expect([...GENDERS]).toEqual(['male', 'female', 'other', 'prefer_not_to_say']);
    const m = read('supabase/migrations/111_gender_prefer_not_to_say.sql');
    expect(m).toContain('APPLIED by Dipak 29 Sep 2026');
    expect(m).toContain("CHECK (gender IN ('male', 'female', 'other', 'prefer_not_to_say'))");
  });
  test('PATCH /users/me stores prefer_not_to_say', async () => {
    mockNext = () => ({ data: { id: ME } });
    const r = await call(updateMe, { body: { gender: 'prefer_not_to_say' } });
    expect(r.statusCode).toBe(200);
    expect(updates()).toHaveLength(1);
    expect(updates()[0].find((c) => c.startsWith('update:'))).toContain('"gender":"prefer_not_to_say"');
  });
  test('an unknown value is still a worded 400 that names all four', async () => {
    const r = await call(updateMe, { body: { gender: 'xyz' } });
    expect(r.statusCode).toBe(400);
    expect(r.body).toEqual({ error: 'gender must be male, female, other, or prefer_not_to_say', code: 'INVALID_GENDER' });
    expect(updates()).toHaveLength(0);
  });
  test('sign-up uses the same list', () => {
    const auth = read('src/controllers/auth.controller.ts');
    expect(auth).toMatch(/if \(gender && !\(GENDERS as readonly string\[\]\)\.includes\(gender\)\) \{\s*return res\.status\(400\)\.json\(\{ error: GENDER_ERROR \}\);/);
    expect(auth).not.toContain("['male', 'female', 'other'].includes");
  });
});

describe('7 · venue delete (soft, creator or admin)', () => {
  test('migration 112 is codified as applied', () => {
    const m = read('supabase/migrations/112_venue_soft_delete.sql');
    expect(m).toContain('APPLIED by Dipak 29 Sep 2026');
    expect(m).toContain('ADD COLUMN IF NOT EXISTS deleted_at timestamptz');
    expect(m).toContain('ADD COLUMN IF NOT EXISTS deleted_by uuid REFERENCES public.users(id) ON DELETE SET NULL');
  });
  test('a bad id → 400; a missing (or already deleted) venue → 404; nothing written', async () => {
    expect((await call(deleteVenue, { params: { id: 'nope' } })).statusCode).toBe(400);
    const r = await call(deleteVenue, { params: { id: V } });
    expect(r.statusCode).toBe(404);
    expect(has(mockLog[0], 'is:["deleted_at",null]')).toBe(true);
    expect(updates()).toHaveLength(0);
  });
  test('someone else\'s venue → 403 unless admin', async () => {
    mockNext = (q) => (q[0] === 'from:venues' && !has(q, 'update:') ? { data: { id: V, created_by: OTHER } } : { data: [{ id: V }] });
    const r = await call(deleteVenue, { params: { id: V } });
    expect(r.statusCode).toBe(403);
    expect(updates()).toHaveLength(0);
    mockLog = [];
    mockAdmin = true;
    const ok = await call(deleteVenue, { params: { id: V } });
    expect(ok.body).toEqual({ deleted: true, id: V });
  });
  test('the creator deletes: deleted_at + deleted_by set, the row stays (no hard delete)', async () => {
    mockNext = (q) => (q[0] === 'from:venues' && !has(q, 'update:') ? { data: { id: V, created_by: ME } } : { data: [{ id: V }] });
    const r = await call(deleteVenue, { params: { id: V } });
    expect(r.body).toEqual({ deleted: true, id: V });
    const u = updates()[0];
    expect(u.find((c) => c.startsWith('update:'))).toMatch(/"deleted_at":"[^"]+","deleted_by":"11111111-1111-4111-8111-111111111111"/);
    expect(has(u, 'is:["deleted_at",null]')).toBe(true);
    expect(mockLog.some((q) => has(q, 'delete:'))).toBe(false);
  });
  test('the directory (and the match form picker) leaves deleted venues out', async () => {
    mockNext = () => ({ data: [] });
    await call(searchVenues, { query: { q: 'P3' } });
    expect(has(mockLog[0], 'is:["deleted_at",null]')).toBe(true);
  });
  test('a deleted venue can\'t be edited', async () => {
    const r = await call(updateVenue, { params: { id: V }, body: { name: 'New' } });
    expect(r.statusCode).toBe(404);
    expect(has(mockLog[0], 'is:["deleted_at",null]')).toBe(true);
  });
  test('its name can be added again: a deleted twin is skipped and a new venue is made', async () => {
    mockNext = (q) => {
      if (q[0].startsWith('rpc:venue_find_exact')) return { data: [{ id: V, name: 'P3 Ground', deleted_at: '2026-09-29T00:00:00Z' }] };
      if (q[0] === 'from:venues' && has(q, 'ilike:')) return { data: [] };
      if (has(q, 'insert:')) return { data: { id: V2, name: 'P3 Ground', use_count: 1 } };
      return {};
    };
    const row = await upsertVenue('P3 Ground', null, ME, { countUse: true });
    expect(row).toEqual({ id: V2, name: 'P3 Ground', use_count: 1 });
    const live = mockLog.find((q) => has(q, 'ilike:'))!;
    expect(has(live, 'is:["deleted_at",null]')).toBe(true);
    expect(inserts()).toHaveLength(1);
    expect(updates()).toHaveLength(0); // the deleted row's use_count is not bumped
  });
  test('a live venue behind a deleted twin is the one a match counts', async () => {
    mockNext = (q) => {
      if (q[0].startsWith('rpc:venue_find_exact')) return { data: [{ id: V, name: 'P3 Ground', deleted_at: '2026-09-29T00:00:00Z' }] };
      if (q[0] === 'from:venues' && has(q, 'ilike:')) return { data: [{ id: V2, name: 'P3 Ground', use_count: 3 }] };
      return {};
    };
    const row = await upsertVenue('P3 Ground', null, ME, { countUse: true });
    expect(row).toEqual({ id: V2, name: 'P3 Ground', use_count: 4 });
    expect(inserts()).toHaveLength(0);
    expect(updates()[0].some((c) => c.includes(`eq:["id","${V2}"]`))).toBe(true);
  });
});

describe('14b · the Announcements switch gates the broadcast push only', () => {
  test('opt-out: only an explicit false turns the push off', () => {
    expect(wantsAnnouncementPush(undefined)).toBe(true);
    expect(wantsAnnouncementPush({})).toBe(true);
    expect(wantsAnnouncementPush({ announcements: true, chat: false })).toBe(true);
    expect(wantsAnnouncementPush({ announcements: false })).toBe(false);
  });
  const people = [
    { id: 'u1', notification_preferences: null },
    { id: 'u2', notification_preferences: { announcements: false } },
    { id: 'u3', notification_preferences: { chat: false } },
  ];
  test('the dry-run counts everyone, and says how many get a push', async () => {
    mockNext = (q) => (q[0] === 'from:users' ? { data: people } : {});
    const r = await call(broadcastAnnouncement, { body: { title: 'Hi', body: 'There' } });
    expect(r.statusCode).toBe(400);
    expect(r.body).toMatchObject({ recipients: 3, push_recipients: 2, needsConfirm: true });
    expect(push).not.toHaveBeenCalled();
  });
  test('a confirmed broadcast: in-app rows for all 3, push tokens asked only for the 2 who want it', async () => {
    mockNext = (q) => {
      if (q[0] === 'from:users') return { data: people };
      if (q[0] === 'from:push_tokens') return { data: [{ token: 'ExponentPushToken[a]' }] };
      return {};
    };
    const r = await call(broadcastAnnouncement, { body: { title: 'Hi', body: 'There', confirm: true } });
    expect(r.body).toEqual({ ok: true, recipients: 3, queued: true });
    await flush();
    const rows = inserts()[0].find((c) => c.startsWith('insert:'))!;
    for (const id of ['u1', 'u2', 'u3']) expect(rows).toContain(`"user_id":"${id}"`);
    const tokens = mockLog.find((q) => q[0] === 'from:push_tokens')!;
    expect(tokens).toContain('in:["user_id",["u1","u3"]]');
    expect(push).toHaveBeenCalledTimes(1);
  });
});
