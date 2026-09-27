/**
 * A deleted account's number (decided 22 + 28 Sep 2026):
 *  - within 30 days of deletion: refused — no SMS — and the refusal says when
 *    the number is free again (available_from);
 *  - after 30 days: free. Sign-up / Change phone work as for any new number
 *    (an expired row still carrying it is released; the hourly purge erases it);
 *  - WhatsApp OTP is gone.
 * Behavioural for sendOtp (SMS provider, OTP store and Supabase mocked).
 */
import fs from 'fs';
import path from 'path';

const DAY = 86400000;
let deletedRows: Array<{ id: string; deleted_at: string }> = [];
const mockCtr = new Map<string, number>();
jest.mock('../utils/otpStore', () => ({
  setOtp: jest.fn(async () => undefined),
  getOtp: jest.fn(async () => null),
  deleteOtp: jest.fn(async () => undefined),
  bumpCounter: jest.fn(async (k: string) => { const n = (mockCtr.get(k) ?? 0) + 1; mockCtr.set(k, n); return n; }),
  readCounter: jest.fn(async (k: string) => mockCtr.get(k) ?? 0),
  clearCounter: jest.fn(async (k: string) => { mockCtr.delete(k); }),
}));
jest.mock('axios', () => ({ __esModule: true, default: { get: jest.fn(async () => ({ data: { Status: 'Success' } })) } }));
jest.mock('../utils/supabase', () => {
  const chain: any = {};
  for (const m of ['from', 'select', 'in', 'not', 'eq', 'is', 'limit', 'maybeSingle', 'update', 'insert']) chain[m] = jest.fn(() => chain);
  // every awaited query resolves to the deleted rows under test
  chain.then = (ok: (v: unknown) => unknown) => ok({ data: deletedRows, error: null });
  return { supabase: chain };
});

// eslint-disable-next-line import/first
import axios from 'axios';
// eslint-disable-next-line import/first
import { sendOtp } from '../controllers/auth.controller';
// eslint-disable-next-line import/first
import { setOtp } from '../utils/otpStore';
// eslint-disable-next-line import/first
import { holdUntil, deletedResponse, NUMBER_HOLD_MS, numberHoldMs } from '../utils/deletedNumber';
// eslint-disable-next-line import/first
import { tombstoneFields } from '../controllers/account.controller';
// eslint-disable-next-line import/first
import { phoneVariants } from '../utils/phone';

const get = (axios as unknown as { get: jest.Mock }).get;
const res = () => {
  const r: any = { statusCode: 200, body: null };
  r.status = jest.fn((c: number) => { r.statusCode = c; return r; });
  r.json = jest.fn((b: unknown) => { r.body = b; return r; });
  return r;
};
const auth = fs.readFileSync(path.join(__dirname, '..', 'controllers', 'auth.controller.ts'), 'utf8');
const body = (name: string) => {
  const s = auth.indexOf(`export async function ${name}(`);
  const e = auth.indexOf('\nexport ', s + 10);
  return auth.slice(s, e === -1 ? undefined : e);
};
const ENV = { ...process.env };
beforeEach(() => {
  mockCtr.clear();
  deletedRows = [];
  get.mockClear();
  (setOtp as jest.Mock).mockClear();
  process.env = { ...ENV, TWOFACTOR_API_KEY: 'k-test' };
  delete process.env.OTP_TEST_NUMBERS;
  delete process.env.OTP_TEST_CODE;
});
afterAll(() => { process.env = ENV; });

describe('holdUntil', () => {
  const now = Date.parse('2026-09-28T12:00:00Z');
  test('30 days from deletion, then null', () => {
    expect(NUMBER_HOLD_MS).toBe(30 * DAY);
    expect(holdUntil('2026-09-20T10:00:00Z', now)).toBe('2026-10-20T10:00:00.000Z');
    expect(holdUntil('2026-08-29T11:59:59Z', now)).toBeNull(); // 30 days + 1s ago
    expect(holdUntil(null, now)).toBeNull();
  });
  test('the local-check override never applies in production', () => {
    expect(numberHoldMs({ DELETED_NUMBER_HOLD_SECONDS: '20', NODE_ENV: 'development' } as any)).toBe(20000);
    expect(numberHoldMs({ DELETED_NUMBER_HOLD_SECONDS: '20', NODE_ENV: 'production' } as any)).toBe(30 * DAY);
    expect(numberHoldMs({ NODE_ENV: 'development' } as any)).toBe(30 * DAY);
    expect(fs.readFileSync(path.join(__dirname, '..', 'controllers', 'account.controller.ts'), 'utf8')).toContain('const PURGE_AFTER_MS = NUMBER_HOLD_MS;');
  });
  test('the refusal carries the date when there is one', () => {
    expect(deletedResponse('2026-10-20T10:00:00.000Z')).toEqual({ error: 'This account has been deleted.', code: 'ACCOUNT_DELETED', available_from: '2026-10-20T10:00:00.000Z' });
    expect(deletedResponse(null)).toEqual({ error: 'This account has been deleted.', code: 'ACCOUNT_DELETED' });
  });
});

describe('within 30 days: refused, no SMS, and it says when', () => {
  test.each(['login', 'register', 'change_phone', 'reset'])('purpose %s', async (purpose) => {
    const deletedAt = new Date(Date.now() - 5 * DAY).toISOString();
    deletedRows = [{ id: 'u1', deleted_at: deletedAt }];
    const r = res();
    await sendOtp({ body: { phone: '9876543210', purpose } } as any, r);
    expect(r.statusCode).toBe(403);
    expect(r.body.code).toBe('ACCOUNT_DELETED');
    expect(r.body.available_from).toBe(new Date(Date.parse(deletedAt) + 30 * DAY).toISOString());
    expect(get).not.toHaveBeenCalled();
    expect(setOtp).not.toHaveBeenCalled();
  });
});

describe('after 30 days: the number is free', () => {
  test('a number whose deleted account is 31 days old gets a code like any other', async () => {
    deletedRows = [{ id: 'u1', deleted_at: new Date(Date.now() - 31 * DAY).toISOString() }];
    const r = res();
    await sendOtp({ body: { phone: '9876543210', purpose: 'register' } } as any, r);
    expect(r.statusCode).toBe(200);
    expect(get).toHaveBeenCalledTimes(1); // mocked provider — the normal path
  });
  test('control: a live number still gets a code', async () => {
    const r = res();
    await sendOtp({ body: { phone: '9876543210', purpose: 'login' } } as any, r);
    expect(r.statusCode).toBe(200);
  });
  test('the 30-day purge erases the number: its sentinel matches no form of it', () => {
    const t = tombstoneFields('abcd1234-0000-0000-0000-000000000000', '2026-09-28T00:00:00Z');
    expect(t.phone).toBe('deleted:abcd1234-0000-0000-0000-000000000000');
    expect(phoneVariants('+919876543210')).not.toContain(t.phone);
    expect(t.purged_at).toBe('2026-09-28T00:00:00Z');
  });
  test('sign-in treats an expired deleted account as no account (→ sign-up)', () => {
    const b = body('otpLogin');
    expect(b).toMatch(/if \(!user \|\| \(deletedAt && !holdUntil\(deletedAt\)\)\) \{\s*return res\.status\(404\)\.json\(\{ error: 'Phone not registered', needsRegistration: true \}\);/);
    expect(b).toMatch(/return res\.status\(403\)\.json\(deletedResponse\(holdUntil\(deletedAt\)\)\);/);
  });
  test('sign-up refuses while held and releases the number after', () => {
    const b = body('register');
    expect(b).toMatch(/const held = holdUntil\(/);
    expect(b).toMatch(/if \(held\) return res\.status\(403\)\.json\(deletedResponse\(held\)\);/);
    expect(b).toMatch(/await releaseNumber\(/);
  });
  test('Change phone: held → refused with the date; expired → released, then checked for a live owner', () => {
    const b = body('changePhone');
    expect(b).toMatch(/if \(del\.heldUntil\) return res\.status\(403\)\.json\(deletedResponse\(del\.heldUntil\)\);/);
    expect(b.indexOf('releaseNumber(del.expiredIds)')).toBeLessThan(b.indexOf("status(409)"));
  });
});

describe('WhatsApp OTP is gone', () => {
  test('an old build asking for whatsapp gets a plain SMS', async () => {
    const r = res();
    await sendOtp({ body: { phone: '9876543210', purpose: 'login', channel: 'whatsapp' } } as any, r);
    expect(r.body).toEqual({ success: true, message: 'OTP sent', channel: 'sms' });
    expect(String(get.mock.calls[0][0])).toMatch(/\/SMS\//);
  });
  test('no WhatsApp send path anywhere in the backend', () => {
    const hits: string[] = [];
    (function walk(d: string) {
      for (const f of fs.readdirSync(d)) {
        const p = path.join(d, f);
        if (fs.statSync(p).isDirectory()) { if (f !== '__tests__') walk(p); }
        else if (/\.ts$/.test(f) && /WAPI|ADDON_SERVICES\/SEND|TWOFACTOR_WHATSAPP/.test(fs.readFileSync(p, 'utf8'))) hits.push(p);
      }
    })(path.join(__dirname, '..'));
    expect(hits).toEqual([]);
  });
});
