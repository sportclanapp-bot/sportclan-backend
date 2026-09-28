/**
 * Phase 3 · B10 Wallet, gifts, services, venues (28 Sep 2026) — the backend
 * fixes. See the app repo's phase3/B10.md for each finding. Supabase is mocked:
 * every `from()` starts its own query, and each resolves to `mockNext(q)`,
 * where `q` lists that query's builder calls. `mockLog` keeps every query.
 */
import fs from 'fs';
import path from 'path';

type Q = string[];
let mockLog: Q[] = [];
let mockNext: (q: Q) => { data?: unknown; error?: unknown; count?: number } = () => ({ data: null, error: null });
const mockRpc = jest.fn(async (..._a: unknown[]) => ({ data: { status: 'sent', gift: { id: 'g1' }, new_balance: 5 }, error: null }));
jest.mock('../utils/supabase', () => {
  const start = (t: string) => {
    const q: string[] = [`from:${t}`];
    mockLog.push(q);
    const chain: any = {};
    for (const m of ['select', 'in', 'not', 'eq', 'neq', 'is', 'limit', 'maybeSingle', 'single', 'update', 'delete', 'order', 'or', 'ilike', 'range', 'gte', 'lt', 'upsert', 'like']) {
      chain[m] = jest.fn((...a: unknown[]) => { q.push(`${m}:${JSON.stringify(a)}`); return chain; });
    }
    chain.insert = jest.fn((row: unknown) => { q.push(`insert:${JSON.stringify(row)}`); return chain; });
    chain.then = (ok: (v: unknown) => unknown, bad?: (e: unknown) => unknown) => {
      try { return Promise.resolve(ok({ data: null, error: null, ...mockNext(q) })); } catch (e) { return bad ? bad(e) : Promise.reject(e); }
    };
    return chain;
  };
  return { supabase: { from: jest.fn(start), rpc: (...a: unknown[]) => mockRpc(...a) } };
});
jest.mock('../utils/blocks', () => ({
  isBlockedBetween: jest.fn(async () => false),
  blockedUserIds: jest.fn(async () => []),
  excludeIds: (q: unknown) => q,
}));
jest.mock('../utils/notify', () => ({ notifyUsers: jest.fn(async () => undefined) }));
jest.mock('../controllers/badges.controller', () => ({ awardBadgesSafe: jest.fn(async () => undefined) }));
jest.mock('../utils/testContent', () => ({ hideTestFor: jest.fn(async () => false), excludeTest: (q: unknown) => q, excludeTestEmbed: (q: unknown) => q }));

// eslint-disable-next-line import/first
import { sendGift, getReceivedGifts, getSentGifts, GIFT_MESSAGE_MAX } from '../controllers/gifts.controller';
// eslint-disable-next-line import/first
import { getTransactions, parseTxnTypes } from '../controllers/transactions.controller';
// eslint-disable-next-line import/first
import { searchVenues, createVenue } from '../controllers/venues.controller';
// eslint-disable-next-line import/first
import { getStats } from '../controllers/referrals.controller';
// eslint-disable-next-line import/first
import { queryText } from '../utils/validation';

const ME = '11111111-1111-4111-8111-111111111111';
const OTHER = '22222222-2222-4222-8222-222222222222';
const CITY = '33333333-3333-4333-8333-333333333333';
const res = () => {
  const r: any = { statusCode: 200, body: null, set: jest.fn(), setHeader: jest.fn() };
  r.status = jest.fn((c: number) => { r.statusCode = c; return r; });
  r.json = jest.fn((b: unknown) => { r.body = b; return r; });
  return r;
};
const call = async (fn: any, req: object) => { const r = res(); await fn({ userId: ME, params: {}, query: {}, body: {}, ...req }, r); return r; };
const src = (f: string) => fs.readFileSync(path.join(__dirname, '..', f), 'utf8');
const RANGE = { code: 'PGRST103', message: 'Requested range not satisfiable' };

beforeEach(() => {
  mockLog = [];
  mockNext = () => ({ data: null, error: null });
  mockRpc.mockClear();
});

describe('F1 · received gifts are only ever your own', () => {
  test('?userId=<someone else> still reads the caller\'s gifts', async () => {
    const r = await call(getReceivedGifts, { query: { userId: OTHER } });
    expect(r.statusCode).toBe(200);
    expect(mockLog[0]).toContain(`eq:${JSON.stringify(['receiver_id', ME])}`);
    expect(JSON.stringify(mockLog)).not.toContain(OTHER);
  });
});

describe('F2 · bad input is a 400 or an empty page, never a 500', () => {
  test('gifts: an offset past the end is an empty last page', async () => {
    mockNext = () => ({ data: null, error: RANGE, count: 2 });
    for (const fn of [getReceivedGifts, getSentGifts]) {
      const r = await call(fn, { query: { offset: '100' } });
      expect(r.statusCode).toBe(200);
      expect(r.body).toMatchObject({ gifts: [], has_more: false });
    }
  });
  test('gifts: a repeated or junk userId no longer matters', async () => {
    for (const userId of ['not-a-uuid', ['a', 'b']]) {
      const r = await call(getReceivedGifts, { query: { userId } });
      expect(r.statusCode).toBe(200);
    }
  });
  test('transactions: an offset past the end is an empty page', async () => {
    mockNext = () => ({ data: null, error: RANGE, count: 7 });
    const r = await call(getTransactions, { query: { limit: '5', offset: '100000' } });
    expect(r.statusCode).toBe(200);
    expect(r.body).toEqual({ transactions: [], total: 7 });
  });
  test('venues: a bad city_id is 400, a repeated q uses the first', async () => {
    expect((await call(searchVenues, { query: { city_id: 'bad' } })).statusCode).toBe(400);
    mockLog = [];
    const r = await call(searchVenues, { query: { q: ['Pune', 'x'] } });
    expect(r.statusCode).toBe(200);
    expect(mockLog[0]).toContain(`ilike:${JSON.stringify(['name', '%Pune%'])}`);
  });
  test('POST /venues: a bad or unknown city is 400 "Unknown city." before anything is written', async () => {
    for (const city_id of ['bad', 123]) {
      mockLog = [];
      const r = await call(createVenue, { body: { name: 'P3 Ground', city_id } });
      expect(r.statusCode).toBe(400);
      expect(r.body.error).toBe('Unknown city.');
      expect(mockLog.filter((q) => q[0] === 'from:venues')).toHaveLength(0);
    }
    mockLog = [];
    mockNext = (q) => (q[0] === 'from:cities' ? { data: null } : { data: null });
    const r = await call(createVenue, { body: { name: 'P3 Ground', city_id: CITY } });
    expect(r.statusCode).toBe(400);
    expect(r.body.error).toBe('Unknown city.');
  });
  test('services: a repeated type takes the first value (no .trim() on an array)', () => {
    expect(queryText(['coach', 'umpire'])).toBe('coach');
    expect(queryText({ x: 1 })).toBeUndefined();
    expect(queryText('umpire')).toBe('umpire');
    expect(src('routes/services.routes.ts')).toContain('const type = (queryText(req.query.type) ?? \'\').trim().toLowerCase();');
  });
});

describe('F7 · venue search: % and _ are literal', () => {
  test('escaped', async () => {
    await call(searchVenues, { query: { q: '50%_off' } });
    expect(mockLog[0]).toContain(`ilike:${JSON.stringify(['name', '%50\\%\\_off%'])}`);
  });
});

describe('F9 · the Gifts filter can ask for sent and received', () => {
  test('comma list → in(type, …); one → eq; junk → nothing', async () => {
    expect(parseTxnTypes('gift_sent,gift_received')).toEqual(['gift_sent', 'gift_received']);
    await call(getTransactions, { query: { type: 'gift_sent,gift_received' } });
    expect(mockLog[0]).toContain(`in:${JSON.stringify(['type', ['gift_sent', 'gift_received']])}`);
    mockLog = [];
    await call(getTransactions, { query: { type: 'gift_sent' } });
    expect(mockLog[0]).toContain(`eq:${JSON.stringify(['type', 'gift_sent'])}`);
    mockLog = [];
    // what the app sends: types= wins; type= is there for an older server
    await call(getTransactions, { query: { type: 'gift_sent', types: 'gift_sent,gift_received' } });
    expect(mockLog[0]).toContain(`in:${JSON.stringify(['type', ['gift_sent', 'gift_received']])}`);
    mockLog = [];
    const r = await call(getTransactions, { query: { type: 'Bad-Type!' } });
    expect(r.body).toEqual({ transactions: [], total: 0 });
    expect(mockLog).toHaveLength(0);
  });
});

describe('F14 + F16 · sendGift checks the message and the receiver before any charge', () => {
  const sender = (q: Q) => (q.some((c) => c.includes(`["id","${ME}"]`)) ? { data: { coin_balance: 100, name: 'Me' } } : { data: { id: OTHER } });
  test(`over ${GIFT_MESSAGE_MAX} characters → 400, no RPC`, async () => {
    mockNext = sender;
    const r = await call(sendGift, { body: { receiverId: OTHER, giftId: 'flowers', message: 'x'.repeat(GIFT_MESSAGE_MAX + 1) } });
    expect(r.statusCode).toBe(400);
    expect(r.body.error).toBe('Keep the message under 140 characters.');
    expect(mockRpc).not.toHaveBeenCalled();
  });
  test('a non-text message → 400, no RPC', async () => {
    mockNext = sender;
    const r = await call(sendGift, { body: { receiverId: OTHER, giftId: 'flowers', message: { a: 1 } } });
    expect(r.statusCode).toBe(400);
    expect(mockRpc).not.toHaveBeenCalled();
  });
  test('a blank message is sent as none; a message is trimmed', async () => {
    mockNext = sender;
    await call(sendGift, { body: { receiverId: OTHER, giftId: 'flowers', message: '   ' } });
    expect((mockRpc.mock.calls[0][1] as any).p_message).toBeNull();
    await call(sendGift, { body: { receiverId: OTHER, giftId: 'flowers', message: '  well played  ' } });
    expect((mockRpc.mock.calls[1][1] as any).p_message).toBe('well played');
  });
  test('a deleted (or unknown) receiver → 404, no RPC', async () => {
    mockNext = (q) => (q.some((c) => c.includes(`["id","${ME}"]`)) ? { data: { coin_balance: 100, name: 'Me' } } : { data: null });
    const r = await call(sendGift, { body: { receiverId: OTHER, giftId: 'flowers' } });
    expect(r.statusCode).toBe(404);
    expect(r.body.error).toBe('This account no longer exists.');
    expect(mockRpc).not.toHaveBeenCalled();
    const receiverQuery = mockLog.find((q) => q.some((c) => c.includes(OTHER)))!;
    expect(receiverQuery).toContain(`is:${JSON.stringify(['deleted_at', null])}`);
    const junk = await call(sendGift, { body: { receiverId: 'not-a-uuid', giftId: 'flowers' } });
    expect(junk.statusCode).toBe(404);
  });
});

describe('F15 · gift 401s are not publicly cacheable', () => {
  test('noStore runs before the auth check on every per-user route', () => {
    const r = src('routes/gifts.routes.ts');
    expect(r).toContain("router.post('/send', noStore, authenticateToken, sendGift);");
    expect(r).toContain("router.get('/received', noStore, authenticateToken, getReceivedGifts);");
    expect(r).toContain("router.get('/sent', noStore, authenticateToken, getSentGifts);");
  });
});

describe('F3 · /users/me carries the check-in state', () => {
  test('selected and turned into checked_in_today by the IST day', () => {
    const u = src('controllers/users.controller.ts');
    expect(u).toContain('.select(`${PUBLIC_FIELDS}, last_checkin_date, checkin_streak, city:cities!city_id(id, name)`)');
    expect(u).toContain('checked_in_today: (data as any).last_checkin_date === istDay(),');
  });
});

describe('F18 · referral stats say whether a code was already used', () => {
  test('alreadyApplied from referred_by', async () => {
    mockNext = (q) => (q.some((c) => c.startsWith('maybeSingle')) ? { data: { referral_code: 'SCX', referred_by: OTHER } } : { data: [], count: 0 });
    const r = await call(getStats, {});
    expect(r.body.alreadyApplied).toBe(true);
    mockNext = (q) => (q.some((c) => c.startsWith('maybeSingle')) ? { data: { referral_code: 'SCX', referred_by: null } } : { data: [], count: 0 });
    expect((await call(getStats, {})).body.alreadyApplied).toBe(false);
  });
});
