/**
 * Phase 3 · B11 Settings & account (28 Sep 2026) — the backend fixes. See the
 * app repo's phase3/B11.md for each finding. Supabase, the OTP store and the SMS
 * provider are mocked; each query resolves to `mockNext(q)`, where `q` lists the
 * builder calls since its `from()`.
 */
import fs from 'fs';
import path from 'path';

let mockQ: string[] = [];
let mockInsert: any = null;
let mockNext: (q: string[]) => { data: unknown; error: unknown } = () => ({ data: null, error: null });
jest.mock('../utils/supabase', () => {
  const chain: any = {};
  for (const m of ['select', 'in', 'not', 'eq', 'neq', 'is', 'limit', 'maybeSingle', 'single', 'update', 'delete', 'order', 'or']) {
    chain[m] = jest.fn((...a: unknown[]) => { mockQ.push(`${m}:${JSON.stringify(a)}`); return chain; });
  }
  chain.from = jest.fn((t: string) => { mockQ = [`from:${t}`]; return chain; });
  chain.insert = jest.fn((row: unknown) => { mockInsert = row; mockQ.push('insert'); return chain; });
  chain.then = (ok: (v: unknown) => unknown) => ok(mockNext(mockQ));
  return { supabase: chain };
});
jest.mock('../utils/otpStore', () => ({
  setOtp: jest.fn(async () => undefined),
  getOtp: jest.fn(async () => null),
  deleteOtp: jest.fn(async () => undefined),
  bumpCounter: jest.fn(async () => 1),
  readCounter: jest.fn(async () => 0),
  clearCounter: jest.fn(async () => undefined),
}));
jest.mock('axios', () => ({ __esModule: true, default: { get: jest.fn(async () => ({ data: { Status: 'Success' } })) } }));

// eslint-disable-next-line import/first
import axios from 'axios';
// eslint-disable-next-line import/first
import { getSessions, submitFeedback, tombstoneFields, SESSIONS_LIMIT } from '../controllers/account.controller';
// eslint-disable-next-line import/first
import { sendOtp } from '../controllers/auth.controller';
// eslint-disable-next-line import/first
import { blockUser } from '../controllers/users.controller';
// eslint-disable-next-line import/first
import { setOtp } from '../utils/otpStore';

const get = (axios as unknown as { get: jest.Mock }).get;
const res = () => {
  const r: any = { statusCode: 200, body: null };
  r.status = jest.fn((c: number) => { r.statusCode = c; return r; });
  r.json = jest.fn((b: unknown) => { r.body = b; return r; });
  return r;
};
const src = (f: string) => fs.readFileSync(path.join(__dirname, '..', 'controllers', f), 'utf8');
const ENV = { ...process.env };

beforeEach(() => {
  mockInsert = null;
  mockNext = () => ({ data: null, error: null });
  get.mockClear();
  (setOtp as jest.Mock).mockClear();
  process.env = { ...ENV, TWOFACTOR_API_KEY: 'k-test' };
  delete process.env.OTP_TEST_NUMBERS;
  delete process.env.OTP_TEST_CODE;
});
afterAll(() => { process.env = ENV; });

describe('F1 · Active sessions: this device found by token, before any cap', () => {
  // 12 sign-ins, newest first; several on the same phone model.
  const rows = Array.from({ length: 12 }, (_, i) => ({
    id: `s${i}`,
    token: `tok-${i}`,
    created_at: new Date(Date.UTC(2026, 8, 28, 12 - i)).toISOString(),
    last_used_at: null,
    device_name: 'Google Pixel 7',
    device_os: 'Android 14',
    app_version: '2.5.0 (7)',
  }));
  const list = async (headers: Record<string, string>) => {
    mockNext = () => ({ data: rows, error: null });
    const r = res();
    await getSessions({ userId: 'u1', headers } as any, r);
    return r.body;
  };

  test('the 12th row, matching the header, is returned first and is the only current one', async () => {
    const b = await list({ 'x-refresh-token': 'tok-11' });
    expect(b.sessions[0]).toMatchObject({ id: 's11', is_current: true });
    expect(b.sessions.filter((s: any) => s.is_current)).toHaveLength(1);
    expect(b.total).toBe(12);
  });
  test('same-model sign-ins are each listed (each can be signed out)', async () => {
    const b = await list({ 'x-refresh-token': 'tok-0' });
    expect(b.sessions).toHaveLength(12);
    expect(SESSIONS_LIMIT).toBeGreaterThanOrEqual(12);
  });
  test('a header that matches nothing marks nothing current (no guessing)', async () => {
    const b = await list({ 'x-refresh-token': 'gone' });
    expect(b.sessions.some((s: any) => s.is_current)).toBe(false);
  });
  test('no header at all (an older app): the newest row is the best guess', async () => {
    const b = await list({});
    expect(b.sessions[0]).toMatchObject({ id: 's0', is_current: true });
  });
});

describe('F2 · Feedback: bad bodies are 400s, not 500s', () => {
  const send = async (body: object) => {
    const r = res();
    await submitFeedback({ userId: 'u1', body } as any, r);
    return r;
  };
  test.each([
    [{ message: 123 }],
    [{ message: ['a'] }],
    [{ message: { a: 1 } }],
    [{ message: '   ' }],
    [{ message: 'P3 probe', rating: 9 }],
    [{ message: 'P3 probe', rating: 'abc' }],
    [{ message: 'P3 probe', rating: 2.5 }],
    [{ message: 'P3 probe', email: 'not-an-email' }],
    [{ message: 'P3 probe', email: `${'a'.repeat(250)}@x.io` }],
  ])('%j → 400, nothing inserted', async (body) => {
    const r = await send(body);
    expect(r.statusCode).toBe(400);
    expect(mockInsert).toBeNull();
  });
  test('a good body is stored; an unknown category is filed as general', async () => {
    const r = await send({ message: ' P3 hello ', rating: 4, category: 'nonsense', email: ' a@b.co ' });
    expect(r.statusCode).toBe(200);
    expect(mockInsert).toEqual({ user_id: 'u1', category: 'general', message: 'P3 hello', rating: 4, email: 'a@b.co' });
  });
  test('a known category is kept', async () => {
    await send({ message: 'x', category: 'bug' });
    expect(mockInsert.category).toBe('bug');
  });
});

describe('F3 · the profile link is erased at deletion and at the purge', () => {
  test('tombstone', () => {
    expect(tombstoneFields('abcd1234-0000-0000-0000-000000000000', '2026-09-28T00:00:00Z')).toMatchObject({ link: null });
  });
  test('the delete scrub', () => {
    const s = src('account.controller.ts');
    const scrub = s.slice(s.indexOf('export async function deleteAccount('), s.indexOf("if (error) return res.status(500).json({ error: 'Could not deactivate account' });"));
    expect(scrub).toMatch(/link: null,/);
    expect(scrub).toMatch(/password_hash: null,/);
    expect(scrub).toMatch(/google_id: null,/);
  });
});

describe('F7 · Export: sign-ins, comments and privacy settings', () => {
  const s = src('account.controller.ts');
  test('sessions come from refresh_tokens, by explicit columns, never the token', () => {
    const m = s.match(/\['sessions', exportAll\('refresh_tokens', '([^']+)'/);
    expect(m).not.toBeNull();
    expect(m![1].split(/,\s*/)).not.toContain('token');
    expect(s).not.toMatch(/exportAll\('refresh_tokens', '\*'/);
  });
  test('comments by the user are exported', () => {
    expect(s).toMatch(/\['comments', exportAll\('post_comments', '[^']+', \(q\) => q\.eq\('author_id', userId\)\)\]/);
    expect(s).toMatch(/\['profile_post_comments', exportAll\('profile_post_comments', '[^']+', \(q\) => q\.eq\('author_id', userId\)\)\]/);
  });
  test('the profile carries the link and the privacy settings', () => {
    for (const f of ['link', 'show_dob', 'discoverability', 'message_privacy', 'tag_privacy', 'notification_preferences']) {
      expect(s).toMatch(new RegExp(`\\.select\\('id, phone, name[^']*\\b${f}\\b`));
    }
  });
});

describe('F16 · Change phone: no code for a number a live account already has', () => {
  const send = async () => {
    const r = res();
    await sendOtp({ body: { phone: '9876543210', purpose: 'change_phone' } } as any, r);
    return r;
  };
  test('taken → 409 PHONE_IN_USE, no code stored, no SMS', async () => {
    mockNext = (q) => (q.some((c) => c === 'is:["deleted_at",null]') ? { data: [{ id: 'u2' }], error: null } : { data: [], error: null });
    const r = await send();
    expect(r.statusCode).toBe(409);
    expect(r.body).toEqual({ error: 'That number is already on another SportClan account.', code: 'PHONE_IN_USE' });
    expect(setOtp).not.toHaveBeenCalled();
    expect(get).not.toHaveBeenCalled();
  });
  test('control: a free number gets its code', async () => {
    mockNext = () => ({ data: [], error: null });
    const r = await send();
    expect(r.statusCode).toBe(200);
    expect(setOtp).toHaveBeenCalled();
  });
  test('change-phone only accepts a code sent for change_phone', () => {
    const s = src('auth.controller.ts');
    const b = s.slice(s.indexOf('export async function changePhone('));
    expect(b).toMatch(/checkOtpCode\(p, code, \{ purpose: 'change_phone' \}\)/);
  });
});

describe('Block a well-formed id that matches nobody → 404', () => {
  test('FK violation on the insert', async () => {
    mockNext = (q) => (q.includes('insert') ? { data: null, error: { code: '23503', message: 'fk' } } : { data: null, error: null });
    const r = res();
    await blockUser({ userId: 'u1', params: { id: '00000000-0000-0000-0000-000000000000' } } as any, r);
    expect(r.statusCode).toBe(404);
    expect(r.body).toEqual({ error: 'User not found' });
  });
  test('the blocked list carries the username', () => {
    expect(src('users.controller.ts')).toContain("users:blocked_id (id, name, username, profile_picture_url)");
  });
});
