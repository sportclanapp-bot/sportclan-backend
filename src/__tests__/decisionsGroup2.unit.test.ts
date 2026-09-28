/**
 * Dipak's decisions, group 2 (29 Sep 2026) — see the app repo's
 * phase3/DECISIONS.md, items 7, 9 and 10 (item 6 is app-only: PATCH
 * /tournaments/:id already edits and cancels).
 *  7 · a venue's creator (or an admin) edits it; a use is counted only when a
 *      match is created there — a repeat "Add venue" is not a use;
 *  9 · a friend's code only within 30 days of joining;
 * 10 · "Thanks — we read every message", and Admin › Feedback.
 * Supabase is mocked the way group 1 mocks it: each query resolves to
 * `mockNext(q)`, where `q` lists that query's builder calls.
 */
type Q = string[];
let mockLog: Q[] = [];
let mockNext: (q: Q) => { data?: unknown; error?: unknown; count?: number } = () => ({ data: null, error: null });
jest.mock('../utils/supabase', () => {
  const start = (first: string) => {
    const q: string[] = [first];
    mockLog.push(q);
    const chain: any = {};
    for (const m of ['select', 'in', 'not', 'eq', 'neq', 'is', 'limit', 'maybeSingle', 'single', 'update', 'delete', 'order', 'or', 'range', 'gt', 'lt', 'like', 'ilike', 'upsert']) {
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
jest.mock('../utils/coins', () => ({ awardCoins: jest.fn(async () => ({ newBalance: 20 })) }));
jest.mock('../utils/testContent', () => ({ hideTestFor: jest.fn(async () => false), excludeTest: (q: unknown) => q }));

// eslint-disable-next-line import/first
import { upsertVenue, updateVenue, createVenue } from '../controllers/venues.controller';
// eslint-disable-next-line import/first
import { applyReferral, getStats as referralStats, referralApplyUntil, REFERRAL_WINDOW_DAYS } from '../controllers/referrals.controller';
// eslint-disable-next-line import/first
import { submitFeedback } from '../controllers/account.controller';
// eslint-disable-next-line import/first
import { adminListFeedback, adminUpdateFeedback } from '../controllers/admin.controller';
// eslint-disable-next-line import/first
import { logAdminAction } from '../utils/tournamentAuth';
// eslint-disable-next-line import/first
import { awardCoins } from '../utils/coins';

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
const call = async (fn: any, req: any) => { const r = res(); await fn({ userId: ME, params: {}, query: {}, body: {}, ...req }, r); return r; };
const has = (q: Q, s: string) => q.some((x) => x.includes(s));
const writes = () => mockLog.filter((q) => q.some((x) => x.startsWith('update:') || x.startsWith('insert:')));

beforeEach(() => {
  mockLog = [];
  mockAdmin = false;
  mockNext = () => ({ data: null, error: null });
  jest.clearAllMocks();
});

describe('7 · a use is a match, not a repeat "Add venue"', () => {
  const existing = { id: V, name: 'P3 Ground', use_count: 4 };
  test('Add venue with an existing name returns it untouched', async () => {
    mockNext = (q) => (q[0].startsWith('rpc:venue_find_exact') ? { data: [existing] } : {});
    const row = await upsertVenue('P3 Ground', null, ME, { countUse: false });
    expect(row).toEqual(existing);
    expect(writes()).toHaveLength(0);
  });
  test('a match at an existing venue counts one use', async () => {
    mockNext = (q) => (q[0].startsWith('rpc:venue_find_exact') ? { data: [existing] } : {});
    const row = await upsertVenue('P3 Ground', null, ME, { countUse: true });
    expect(row.use_count).toBe(5);
    expect(writes()[0]).toContain('update:[{"use_count":5}]');
  });
  test('a venue added by hand starts at 0 uses; one made by a match at 1', async () => {
    mockNext = (q) => (q[0].startsWith('rpc:') ? { data: [] } : has(q, 'insert:') ? { data: { id: V } } : {});
    await upsertVenue('New Ground', null, ME, { countUse: false });
    expect(writes()[0].find((x) => x.startsWith('insert:'))).toContain('"use_count":0');
    mockLog = [];
    await upsertVenue('New Ground', null, ME);
    expect(writes()[0].find((x) => x.startsWith('insert:'))).toContain('"use_count":1');
  });
  test('POST /venues passes countUse:false; createMatch passes countUse:true', async () => {
    const fs = await import('fs');
    const path = await import('path');
    const v = fs.readFileSync(path.join(__dirname, '..', 'controllers', 'venues.controller.ts'), 'utf8');
    const m = fs.readFileSync(path.join(__dirname, '..', 'controllers', 'matches.controller.ts'), 'utf8');
    expect(v).toContain('await upsertVenue(clean, city_id || null, userId, { countUse: false });');
    expect(m).toContain('void upsertVenue(cleanVenue, city_id ?? null, userId, { countUse: true });');
  });
  test('the directory rows carry created_by, so the app can offer Edit', async () => {
    mockNext = () => ({ data: [] });
    const { searchVenues } = await import('../controllers/venues.controller');
    await call(searchVenues, {});
    expect(mockLog[0].join(' ')).toContain('created_by');
  });
  test('control: POST /venues still answers with the venue', async () => {
    mockNext = (q) => (q[0].startsWith('rpc:') ? { data: [{ id: V, name: 'P3 Ground', use_count: 2 }] } : {});
    const r = await call(createVenue, { body: { name: 'P3 Ground' } });
    expect(r.body.venue.id).toBe(V);
    expect(writes()).toHaveLength(0);
  });
});

describe('7 · PATCH /venues/:id — its creator or an admin', () => {
  const venueRow = (createdBy: string) => (q: Q) => {
    if (q[0] === 'from:venues' && has(q, 'maybeSingle')) return { data: { id: V, name: 'P3 Ground', city_id: null, created_by: createdBy } };
    if (q[0].startsWith('rpc:')) return { data: [] };
    if (q[0] === 'from:venues' && has(q, 'update:')) return { data: { id: V, name: 'P3 Ground 2' } };
    return {};
  };
  test('someone else → 403, nothing written', async () => {
    mockNext = venueRow(OTHER);
    const r = await call(updateVenue, { params: { id: V }, body: { name: 'Mine now' } });
    expect(r.statusCode).toBe(403);
    expect(writes()).toHaveLength(0);
  });
  test('the creator renames it', async () => {
    mockNext = venueRow(ME);
    const r = await call(updateVenue, { params: { id: V }, body: { name: '  P3 Ground 2 ' } });
    expect(r.statusCode).toBe(200);
    expect(writes()[0]).toContain('update:[{"name":"P3 Ground 2"}]');
  });
  test('an admin may edit someone else\'s venue; a cleared detail is null', async () => {
    mockAdmin = true;
    mockNext = venueRow(OTHER);
    const r = await call(updateVenue, { params: { id: V }, body: { surface: '' } });
    expect(r.statusCode).toBe(200);
    expect(writes()[0]).toContain('update:[{"surface":null}]');
  });
  test('renaming onto another venue\'s name → 409', async () => {
    mockNext = (q) => (q[0].startsWith('rpc:') ? { data: [{ id: V2 }] } : venueRow(ME)(q));
    const r = await call(updateVenue, { params: { id: V }, body: { name: 'Taken Ground' } });
    expect(r.statusCode).toBe(409);
    expect(r.body.code).toBe('VENUE_NAME_TAKEN');
    expect(writes()).toHaveLength(0);
  });
  test('bad id 400, missing 404, blank name 400, nothing to change 400', async () => {
    expect((await call(updateVenue, { params: { id: 'nope' }, body: { name: 'x' } })).statusCode).toBe(400);
    mockNext = () => ({ data: null });
    expect((await call(updateVenue, { params: { id: V }, body: { name: 'x' } })).statusCode).toBe(404);
    mockNext = venueRow(ME);
    expect((await call(updateVenue, { params: { id: V }, body: { name: '   ' } })).statusCode).toBe(400);
    expect((await call(updateVenue, { params: { id: V }, body: {} })).statusCode).toBe(400);
    expect(writes()).toHaveLength(0);
  });
});

describe('9 · a friend\'s code within 30 days of joining', () => {
  const daysAgo = (n: number) => new Date(Date.now() - n * 86400000).toISOString();
  const withMe = (createdAt: string) => (q: Q) => {
    if (q[0] === 'from:users' && has(q, '"referral_code"')) return { data: { id: OTHER, name: 'Ravi' } };
    if (q[0] === 'from:users' && has(q, 'maybeSingle')) return { data: { id: ME, referred_by: null, created_at: createdAt } };
    if (q[0] === 'from:users' && has(q, 'update:')) return { data: [{ id: ME }] };
    return {};
  };
  test('40 days after joining → 403, no claim, no coins', async () => {
    mockNext = withMe(daysAgo(40));
    const r = await call(applyReferral, { body: { code: 'scabc123' } });
    expect(r.statusCode).toBe(403);
    expect(r.body).toEqual({ error: 'A friend’s code can only be used within 30 days of joining.', code: 'REFERRAL_WINDOW_CLOSED' });
    expect(writes()).toHaveLength(0);
    expect(awardCoins).not.toHaveBeenCalled();
  });
  test('10 days after joining → applied', async () => {
    mockNext = withMe(daysAgo(10));
    const r = await call(applyReferral, { body: { code: 'SCABC123' } });
    expect(r.body.success).toBe(true);
    expect(awardCoins).toHaveBeenCalledTimes(2);
  });
  test('stats say when the window closes', async () => {
    const created = '2026-09-01T00:00:00.000Z';
    mockNext = (q) => (has(q, 'maybeSingle') ? { data: { referral_code: 'SCX', referred_by: null, created_at: created } } : { data: [], count: 0 });
    const r = await call(referralStats, {});
    expect(REFERRAL_WINDOW_DAYS).toBe(30);
    expect(r.body.applyUntil).toBe('2026-10-01T00:00:00.000Z');
    expect(referralApplyUntil(null)).toBeNull();
  });
});

describe('10 · feedback', () => {
  test('the success message makes no promise of a reply', async () => {
    const r = await call(submitFeedback, { body: { message: 'P3 hello', category: 'bug' } });
    expect(r.body).toEqual({ success: true, message: 'Thanks — we read every message.' });
  });
  test('Admin › Feedback: newest first, with who sent it; a bad status is 400', async () => {
    mockNext = (q) => (q[0] === 'from:feedback'
      ? { data: [{ id: 'F1', user_id: OTHER, category: 'bug', message: 'P3', status: 'open', created_at: 'x' }], count: 1 }
      : { data: [{ id: OTHER, name: 'Ravi', username: 'ravi' }] });
    const r = await call(adminListFeedback, { query: { status: 'open' } });
    expect(r.body.feedback[0].user).toEqual({ id: OTHER, name: 'Ravi', username: 'ravi' });
    expect(r.body.total).toBe(1);
    expect(mockLog[0]).toContain('order:["created_at",{"ascending":false}]');
    expect(mockLog[0]).toContain('eq:["status","open"]');
    expect((await call(adminListFeedback, { query: { status: 'bogus' } })).statusCode).toBe(400);
  });
  test('a failed query is a 500, not an empty queue', async () => {
    mockNext = () => ({ data: null, error: { message: 'boom', code: 'XX000' } });
    expect((await call(adminListFeedback, {})).statusCode).toBe(500);
  });
  test('mark done / reopen: logged; a bad status is 400; a missing row 404', async () => {
    mockNext = () => ({ data: { id: 'F1', status: 'resolved' } });
    const r = await call(adminUpdateFeedback, { params: { id: 'F1' }, body: { status: 'resolved' } });
    expect(r.body.feedback.status).toBe('resolved');
    expect(logAdminAction).toHaveBeenCalledWith(ME, 'resolve_feedback', 'feedback', 'F1', null);
    expect((await call(adminUpdateFeedback, { params: { id: 'F1' }, body: { status: 'deleted' } })).statusCode).toBe(400);
    mockNext = () => ({ data: null });
    expect((await call(adminUpdateFeedback, { params: { id: 'F1' }, body: { status: 'open' } })).statusCode).toBe(404);
  });
});
