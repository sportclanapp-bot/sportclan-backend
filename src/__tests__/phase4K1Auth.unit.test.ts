/**
 * Phase 4 · K1 — regression tests for the early auth fixes (April–July).
 * Supabase, the OTP store, coins and the SMS provider are mocked; every
 * `from()` starts its own query and resolves to `mockNext(q)`, where `q` lists
 * that query's builder calls. No network, no SMS.
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
    for (const m of ['select', 'in', 'not', 'eq', 'neq', 'is', 'ilike', 'limit', 'maybeSingle', 'single', 'update', 'delete', 'order', 'or', 'range', 'gte', 'lt']) {
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
const mockStore = new Map<string, { code: string; purpose: string }>();
jest.mock('../utils/otpStore', () => ({
  setOtp: jest.fn(async (p: string, code: string, purpose: string) => { mockStore.set(p, { code, purpose }); }),
  getOtp: jest.fn(async (p: string) => mockStore.get(p) ?? null),
  deleteOtp: jest.fn(async (p: string) => { mockStore.delete(p); }),
  bumpCounter: jest.fn(async () => 1),
  readCounter: jest.fn(async () => 0),
  clearCounter: jest.fn(async () => undefined),
}));
jest.mock('../utils/coins', () => ({ awardCoins: jest.fn(async () => ({ awarded: true, newBalance: 0 })) }));
jest.mock('../utils/sessionDevice', () => ({ insertRefreshToken: jest.fn(async () => 'sid-1'), refreshedDeviceFields: () => ({}) }));
jest.mock('../utils/sessionRevocation', () => ({ revokeSessionsNow: jest.fn(async () => undefined) }));
jest.mock('../utils/sessionDeny', () => ({ denySessions: jest.fn(async () => undefined) }));
jest.mock('../utils/deletedNumber', () => ({
  deletedNumberState: jest.fn(async () => ({ heldUntil: null, expiredIds: [] })),
  deletedResponse: jest.fn(() => ({ error: 'deleted' })),
  holdUntil: jest.fn(() => null),
  releaseNumber: jest.fn(async () => true),
}));
jest.mock('../utils/sportId', () => ({ resolveSportId: jest.fn(async () => undefined) }));
jest.mock('axios', () => ({ __esModule: true, default: { get: jest.fn(async () => ({ data: { Status: 'Success', Details: 's1' } })) } }));
jest.mock('bcryptjs', () => ({ hash: jest.fn(async () => 'hash'), compare: jest.fn(async () => true) }));

// eslint-disable-next-line import/first
import axios from 'axios';
// eslint-disable-next-line import/first
import * as auth from '../controllers/auth.controller';

const get = (axios as unknown as { get: jest.Mock }).get;
const res = () => {
  const r: any = { statusCode: 200, body: null };
  r.status = jest.fn((c: number) => { r.statusCode = c; return r; });
  r.json = jest.fn((b: unknown) => { r.body = b; return r; });
  return r;
};
const call = async (fn: any, body: object, extra: object = {}) => {
  const r = res();
  await fn({ body, headers: {}, ...extra } as any, r);
  return r;
};
const selects = (table: string) => mockLog.filter((q) => q[0] === `from:${table}`).flatMap((q) => q.filter((c) => c.startsWith('select:')));
const inserts = (table: string) => mockLog.filter((q) => q[0] === `from:${table}`).flatMap((q) => q.filter((c) => c.startsWith('insert:')).map((c) => JSON.parse(c.slice(7))));
const ENV = { ...process.env };
const PHONE = '+919876543210';

beforeEach(() => {
  mockLog = [];
  mockStore.clear();
  mockNext = () => ({ data: null, error: null });
  get.mockClear();
  get.mockImplementation(async () => ({ data: { Status: 'Success', Details: 's1' } }));
  process.env = { ...ENV, NODE_ENV: 'test' };
  delete process.env.OTP_TEST_NUMBERS;
  delete process.env.OTP_TEST_CODE;
  delete process.env.ALLOW_TEST_OTP;
  delete process.env.TWOFACTOR_SMS_TEMPLATE_ID;
});
afterAll(() => { process.env = ENV; });

describe('K1-7 (be7c932) · OTP goes through 2Factor.in with TWOFACTOR_API_KEY; a failed send is never a 500', () => {
  test('K1-7 (be7c932): the key is read from TWOFACTOR_API_KEY and the call goes to 2factor.in (voice when asked)', async () => {
    process.env.TWOFACTOR_API_KEY = 'k-2f';
    const r = await call(auth.sendOtp, { phone: '9876543210', purpose: 'login', channel: 'voice' });
    expect(r.statusCode).toBe(200);
    expect(get).toHaveBeenCalledTimes(1);
    const url = String(get.mock.calls[0][0]);
    expect(url.startsWith('https://2factor.in/API/V1/k-2f/VOICE/9876543210/')).toBe(true);
    expect(url).not.toMatch(/fast2sms/i);
  });
  test('K1-7 (be7c932): the provider throwing gives a handled 503 with a message, not a 500', async () => {
    process.env.TWOFACTOR_API_KEY = 'k-2f';
    get.mockImplementation(async () => { throw new Error('ECONNRESET'); });
    const r = await call(auth.sendOtp, { phone: '9876543210', purpose: 'login' });
    expect(r.statusCode).not.toBe(500);
    expect(r.statusCode).toBe(503);
    expect(r.body.code).toBe('OTP_SEND_FAILED');
  });
});

/** Rows for a register that gets all the way through. */
const registerDb = (q: Q) => {
  const s = q.join(' ');
  if (q[0] === 'from:users' && s.includes('insert:')) {
    return { data: { id: 'u-new', phone: PHONE, name: 'Arjun', username: 'arjun_19', coin_balance: 0, account_type: 'player' } };
  }
  if (q[0] === 'from:users' && s.includes('select:["coin_balance"]')) return { data: { coin_balance: 60 } };
  return { data: null };
};

describe('K1-19 / K1-20 (32eeee6, e827933) · the dev test-OTP bypass works on every OTP-guarded flow', () => {
  beforeEach(() => {
    process.env.ALLOW_TEST_OTP = 'true';
    // sendOtp stored the REAL code, not 123456.
    mockStore.set(PHONE, { code: '482913', purpose: 'register' });
  });
  test('K1-19 (32eeee6): register with 123456 passes the code check and creates the account', async () => {
    mockNext = registerDb;
    const r = await call(auth.register, { phone: '9876543210', code: '123456', name: 'Arjun', username: 'arjun_19' });
    expect(r.statusCode).toBe(200);
    expect(r.body.isNewUser).toBe(true);
    expect(inserts('users')).toHaveLength(1);
  });
  test('K1-20 (e827933): reset-password with 123456 passes the code check', async () => {
    mockNext = (q) => (q[0] === 'from:users' && q.some((c) => c.startsWith('update:')) ? { data: [{ id: 'u1' }] } : { data: null });
    const r = await call(auth.resetPassword, { phone: '9876543210', code: '123456', newPassword: 'longenough1' });
    expect(r.statusCode).toBe(200);
    expect(r.body).toEqual({ success: true });
  });
  test('K1-20 (e827933): change-phone with 123456 passes the code check', async () => {
    const r = await call(auth.changePhone, { newPhone: '9876543210', code: '123456' }, { userId: 'u1' });
    expect(r.statusCode).toBe(200);
    expect(mockLog.some((q) => q[0] === 'from:users' && q.some((c) => c.startsWith('update:')))).toBe(true);
  });
  test('K1-19/20: the bypass stays off in production — the real code is still required', async () => {
    process.env.NODE_ENV = 'production';
    const r = await call(auth.resetPassword, { phone: '9876543210', code: '123456', newPassword: 'longenough1' });
    expect(r.statusCode).toBe(400);
  });
});

describe('K1-21e (a90eae1) · sign-up normalises account types', () => {
  beforeEach(() => { mockStore.set(PHONE, { code: '482913', purpose: 'register' }); });
  test('K1-21e (a90eae1): mixed-case, duplicate and junk types are cleaned; player first; primary column is canonical', async () => {
    mockNext = registerDb;
    const r = await call(auth.register, {
      phone: '9876543210', code: '482913', name: 'Arjun', username: 'arjun_19',
      account_types: ['Coach', 'fan', 'PLAYER', 'coach', ' umpire '],
    });
    expect(r.statusCode).toBe(200);
    expect(inserts('user_account_types')[0]).toEqual([
      { user_id: 'u-new', account_type: 'player' },
      { user_id: 'u-new', account_type: 'coach' },
      { user_id: 'u-new', account_type: 'umpire' },
    ]);
    expect(inserts('users')[0].account_type).toBe('player');
  });
  test('K1-21e (a90eae1): nothing valid → player (never the old "fan")', async () => {
    mockNext = registerDb;
    await call(auth.register, { phone: '9876543210', code: '482913', name: 'Arjun', username: 'arjun_19', account_types: ['fan'] });
    expect(inserts('users')[0].account_type).toBe('player');
    expect(inserts('user_account_types')[0]).toEqual([{ user_id: 'u-new', account_type: 'player' }]);
  });
});

describe('K1-32 (d9e7a7e) · the sign-up response carries the balance AFTER the welcome coins', () => {
  test('K1-32 (d9e7a7e): user.coin_balance is re-read after the grants (60, not the insert-time 0)', async () => {
    mockStore.set(PHONE, { code: '482913', purpose: 'register' });
    mockNext = registerDb;
    const r = await call(auth.register, { phone: '9876543210', code: '482913', name: 'Arjun', username: 'arjun_19' });
    expect(r.statusCode).toBe(200);
    expect(r.body.user.coin_balance).toBe(60);
  });
});

describe('K1-22 / K1-29c (04ac4a4, 1b1d38b) · is_admin reaches the app on sign-in and on /users/me', () => {
  test('K1-22 (04ac4a4): OTP login selects is_admin and returns it', async () => {
    mockStore.set(PHONE, { code: '482913', purpose: 'login' });
    mockNext = (q) => (q[0] === 'from:users' && q.some((c) => c.startsWith('select:["id, phone')) ? { data: { id: 'u1', phone: PHONE, is_admin: true, deleted_at: null } } : { data: null });
    const r = await call(auth.otpLogin, { phone: '9876543210', code: '482913' });
    expect(r.statusCode).toBe(200);
    expect(selects('users').some((s) => s.startsWith('select:["id, phone') && s.includes('is_admin'))).toBe(true);
    expect(r.body.user.is_admin).toBe(true);
  });
  test('K1-29c (1b1d38b): password login selects is_admin and returns it', async () => {
    // A real (cost 4) hash of 'longenough1': this passes whether the controller
    // gets the bcryptjs mock or, as happened rarely in full runs, the real module.
    mockNext = (q) => (q[0] === 'from:users' && q.some((c) => c.includes('password_hash'))
      ? { data: { id: 'u1', phone: PHONE, password_hash: '$2b$04$DZGGOYllgnNctwgZ0XiVwuYmVn.XGAOgw9duirp3M75g/DXEiOeCu', is_admin: true, deleted_at: null } }
      : { data: null });
    const r = await call(auth.login, { phone: '9876543210', password: 'longenough1' });
    expect({ status: r.statusCode, body: r.statusCode === 200 ? 'ok' : r.body }).toEqual({ status: 200, body: 'ok' });
    expect(selects('users').some((s) => s.includes('password_hash') && s.includes('is_admin'))).toBe(true);
    expect(r.body.user.is_admin).toBe(true);
  });
  test('K1-22 (04ac4a4): /users/me PUBLIC_FIELDS includes is_admin', () => {
    const src = fs.readFileSync(path.join(__dirname, '..', 'controllers', 'users.controller.ts'), 'utf8');
    const m = src.match(/const PUBLIC_FIELDS =\s*'([^']+)'/);
    expect(m).not.toBeNull();
    expect(m![1].split(',').map((s) => s.trim())).toContain('is_admin');
  });
});
