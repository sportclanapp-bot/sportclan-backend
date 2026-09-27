/**
 * Phase 3 · B01 Auth (28 Sep 2026) — the backend fixes. See the app repo's
 * phase3/B01.md for each finding. Supabase, the OTP store and the SMS provider
 * are mocked; every query resolves to `mockNext()` (default: no rows).
 */
const mockCalls: string[] = [];
let mockInsert: any = null;
let mockNext: () => { data: unknown; error: unknown } = () => ({ data: null, error: null });
jest.mock('../utils/supabase', () => {
  const chain: any = {};
  for (const m of ['from', 'select', 'in', 'not', 'eq', 'neq', 'is', 'ilike', 'limit', 'maybeSingle', 'single', 'update', 'order']) {
    chain[m] = jest.fn((...a: unknown[]) => { mockCalls.push(`${m}:${JSON.stringify(a)}`); return chain; });
  }
  chain.insert = jest.fn((row: unknown) => { mockInsert = row; return chain; });
  chain.then = (ok: (v: unknown) => unknown) => ok(mockNext());
  return { supabase: chain };
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
jest.mock('axios', () => ({ __esModule: true, default: { get: jest.fn(async () => ({ data: { Status: 'Success' } })) } }));
jest.mock('bcryptjs', () => ({ hash: jest.fn(async () => 'hash'), compare: jest.fn(async () => false) }));

// eslint-disable-next-line import/first
import axios from 'axios';
// eslint-disable-next-line import/first
import express from 'express';
// eslint-disable-next-line import/first
import * as auth from '../controllers/auth.controller';
// eslint-disable-next-line import/first
import { signupProfileProblem } from '../utils/profileRules';
// eslint-disable-next-line import/first
import citiesRouter from '../routes/cities.routes';

const get = (axios as unknown as { get: jest.Mock }).get;
const res = () => {
  const r: any = { statusCode: 200, body: null };
  r.status = jest.fn((c: number) => { r.statusCode = c; return r; });
  r.json = jest.fn((b: unknown) => { r.body = b; return r; });
  return r;
};
const call = async (fn: any, body: object, extra: object = {}) => { const r = res(); await fn({ body, ...extra } as any, r); return r; };
const ENV = { ...process.env };

beforeEach(() => {
  mockCalls.length = 0;
  mockInsert = null;
  mockStore.clear();
  mockNext = () => ({ data: null, error: null });
  get.mockClear();
  process.env = { ...ENV, TWOFACTOR_API_KEY: 'k-test' };
  delete process.env.OTP_TEST_NUMBERS;
  delete process.env.OTP_TEST_CODE;
  delete process.env.ALLOW_TEST_OTP;
});
afterAll(() => { process.env = ENV; });

describe('F14 · send-otp takes only the four purposes', () => {
  test('anything else → 400, nothing sent', async () => {
    const r = await call(auth.sendOtp, { phone: '9876543210', purpose: 'admin' });
    expect(r.statusCode).toBe(400);
    expect(r.body.code).toBe('INVALID_PURPOSE');
    expect(get).not.toHaveBeenCalled();
    expect(auth.OTP_PURPOSES).toEqual(['login', 'register', 'reset', 'change_phone']);
  });
});

describe('F5 · a reset code needs an account', () => {
  test('no live account → 404, no code stored, no SMS', async () => {
    mockNext = () => ({ data: [], error: null });
    const r = await call(auth.sendOtp, { phone: '9876543210', purpose: 'reset' });
    expect(r.statusCode).toBe(404);
    expect(r.body).toEqual({ error: 'No SportClan account uses this number.', code: 'PHONE_NOT_REGISTERED' });
    expect(mockStore.size).toBe(0);
    expect(get).not.toHaveBeenCalled();
    expect(mockCalls).toContain('is:["deleted_at",null]');
  });
  test('a live account → sent', async () => {
    mockNext = () => ({ data: [{ id: 'u1' }], error: null });
    const r = await call(auth.sendOtp, { phone: '9876543210', purpose: 'reset' });
    expect(r.statusCode).toBe(200);
  });
  test('a query error fails open (sends), like the deleted check', async () => {
    mockNext = () => ({ data: null, error: { message: 'down' } });
    const r = await call(auth.sendOtp, { phone: '9876543210', purpose: 'reset' });
    expect(r.statusCode).toBe(200);
  });
});

describe('F4 · reset-password: 8 characters, on the server', () => {
  test('a short password → 400 before the code is checked', async () => {
    mockStore.set('+919876543210', { code: '482913', purpose: 'reset' });
    const r = await call(auth.resetPassword, { phone: '9876543210', code: '000000', newPassword: '1' });
    expect(r.statusCode).toBe(400);
    expect(r.body.error).toBe('Password must be at least 8 characters');
    expect(mockStore.has('+919876543210')).toBe(true); // no guess spent
  });
});

describe('F12 · a phone, email or password that isn\'t text → 400, not 500', () => {
  test.each([
    ['verifyOtp', { phone: 12345, code: '1' }],
    ['otpLogin', { phone: { a: 1 }, code: '1' }],
    ['register', { phone: 9876543210, code: '1', name: 'A', username: 'abc' }],
    ['resetPassword', { phone: 9876543210, code: '1', newPassword: 'longenough1' }],
  ])('%s', async (fn, body) => {
    const r = await call((auth as any)[fn], body);
    expect(r.statusCode).toBe(400);
    expect(r.body.code).toBe('INVALID_PHONE');
  });
  test('changePhone', async () => {
    const r = await call(auth.changePhone, { newPhone: 9876543210, code: '1' }, { userId: 'u1' });
    expect(r.statusCode).toBe(400);
    expect(r.body.code).toBe('INVALID_PHONE');
  });
  test.each([
    [{ email: 5, password: 'x' }],
    [{ email: 'a@b.co', password: 12345678 }],
    [{ phone: ['9876543210'], password: 'x' }],
  ])('login %j', async (body) => {
    const r = await call(auth.login, body);
    expect(r.statusCode).toBe(400);
  });
});

describe('F3 · sign-up applies Edit profile\'s rules', () => {
  const ok = { name: 'Arjun', username: 'arjun_19' };
  test.each([
    [{ ...ok, username: 'admin' }, 'USERNAME_RESERVED'],
    [{ ...ok, username: 'abc!' }, 'INVALID_USERNAME'],
    [{ ...ok, username: 'a'.repeat(31) }, 'INVALID_USERNAME'],
    [{ ...ok, name: '   ' }, 'INVALID_NAME'],
    [{ ...ok, email: 'not-an-email' }, 'INVALID_EMAIL'],
    [{ ...ok, profile_picture_url: 'https://evil.example.com/a.png' }, 'INVALID_IMAGE_URL'],
  ])('%j → %s', (f, code) => {
    expect(signupProfileProblem(f)?.code).toBe(code);
  });
  test('length, date and bio rules', () => {
    expect(signupProfileProblem({ ...ok, name: 'n'.repeat(61) })?.error).toBe('Name must be 60 characters or fewer');
    expect(signupProfileProblem({ ...ok, dob: '2999-01-01' })?.error).toMatch(/future/);
    expect(signupProfileProblem({ ...ok, bio: 'b'.repeat(501) })?.error).toMatch(/Bio must be 500/);
    expect(signupProfileProblem(ok)).toBeNull();
  });
  test('register refuses before the code is used', async () => {
    mockStore.set('+919876543210', { code: '482913', purpose: 'register' });
    const r = await call(auth.register, { phone: '9876543210', code: '482913', name: 'Arjun', username: 'admin' });
    expect(r.statusCode).toBe(400);
    expect(r.body.code).toBe('USERNAME_RESERVED');
    expect(mockStore.has('+919876543210')).toBe(true);
  });
  test('check-username: reserved or malformed is not "available"', async () => {
    for (const u of ['admin', 'a'.repeat(31), 'abc!']) {
      const r = res();
      await auth.checkUsername({ query: { username: u } } as any, r);
      expect(r.body).toEqual({ available: false });
    }
  });
  test('register: email lower-cased, checked case-insensitively; photo and trimmed names stored (F2)', async () => {
    mockStore.set('+919876543210', { code: '482913', purpose: 'register' });
    const photo = 'https://pub-abc.r2.dev/avatars/a.jpg';
    await call(auth.register, {
      phone: '9876543210', code: '482913', name: ' Arjun ', username: 'raj_1',
      email: ' Foo@X.com ', password: 'longenough1', profile_picture_url: photo,
    });
    expect(mockCalls).toContain('ilike:["email","foo@x.com"]');
    expect(mockCalls).toContain('ilike:["username","raj\\\\_1"]'); // F11: `_` escaped
    expect(mockInsert).toMatchObject({ name: 'Arjun', username: 'raj_1', email: 'foo@x.com', profile_picture_url: photo });
  });
});

describe('F11 · `_` is a literal in the username check', () => {
  test('check-username escapes it', async () => {
    await auth.checkUsername({ query: { username: 'qa_dev' } } as any, res());
    expect(mockCalls).toContain('ilike:["username","qa\\\\_dev"]');
  });
});

describe('F15 · /cities', () => {
  const app = express().use('/cities', citiesRouter);
  const hit = (url: string) => new Promise<{ status: number; body: any }>((resolve) => {
    const srv = app.listen(0, async () => {
      const port = (srv.address() as any).port;
      const r = await fetch(`http://127.0.0.1:${port}${url}`);
      resolve({ status: r.status, body: await r.json() });
      srv.close();
    });
  });
  test('wildcards are literal', async () => {
    mockNext = () => ({ data: [], error: null });
    await hit('/cities?q=%25');
    expect(mockCalls).toContain('ilike:["name","%\\\\%%"]');
  });
  test('a database error isn\'t passed through', async () => {
    mockNext = () => ({ data: null, error: { message: 'relation "cities" secret detail' } });
    const r = await hit('/cities/search?q=mum');
    expect(r.status).toBe(500);
    expect(r.body).toEqual({ error: 'Could not load cities. Try again.' });
  });
});
