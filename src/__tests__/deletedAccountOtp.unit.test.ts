/**
 * Decided 22 Sep 2026: WhatsApp OTP is gone, and a deleted account's number
 * never triggers an SMS. Behavioural for sendOtp (SMS provider, OTP store and
 * Supabase mocked); every deleted-account refusal carries ACCOUNT_DELETED so the
 * app can show one clear notice instead of Resend / Verify.
 */
import fs from 'fs';
import path from 'path';

let deletedRows: Array<{ deleted_at: string }> = [];
jest.mock('../utils/otpStore', () => ({
  setOtp: jest.fn(async () => undefined),
  getOtp: jest.fn(async () => null),
  deleteOtp: jest.fn(async () => undefined),
}));
jest.mock('axios', () => ({ __esModule: true, default: { get: jest.fn(async () => ({ data: { Status: 'Success' } })) } }));
jest.mock('../utils/supabase', () => {
  const chain: any = {};
  for (const m of ['from', 'select', 'in', 'not', 'eq', 'is', 'maybeSingle', 'update', 'insert']) chain[m] = jest.fn(() => chain);
  chain.limit = jest.fn(async () => ({ data: deletedRows, error: null }));
  return { supabase: chain };
});

// eslint-disable-next-line import/first
import axios from 'axios';
// eslint-disable-next-line import/first
import { sendOtp } from '../controllers/auth.controller';
// eslint-disable-next-line import/first
import { setOtp } from '../utils/otpStore';

const get = (axios as unknown as { get: jest.Mock }).get;
const res = () => {
  const r: any = { statusCode: 200, body: null };
  r.status = jest.fn((c: number) => { r.statusCode = c; return r; });
  r.json = jest.fn((b: unknown) => { r.body = b; return r; });
  return r;
};
const ENV = { ...process.env };
beforeEach(() => {
  deletedRows = [];
  get.mockClear();
  (setOtp as jest.Mock).mockClear();
  process.env = { ...ENV, TWOFACTOR_API_KEY: 'k-test' };
  delete process.env.OTP_TEST_NUMBERS;
  delete process.env.OTP_TEST_CODE;
});
afterAll(() => { process.env = ENV; });

describe('a deleted account\'s number never triggers an SMS', () => {
  test.each(['login', 'register', 'change_phone', 'reset'])('purpose %s → 403 ACCOUNT_DELETED, nothing sent or stored', async (purpose) => {
    deletedRows = [{ deleted_at: '2026-09-01T00:00:00Z' }];
    const r = res();
    await sendOtp({ body: { phone: '9876543210', purpose } } as any, r);
    expect(r.statusCode).toBe(403);
    expect(r.body).toEqual({ error: 'This account has been deleted.', code: 'ACCOUNT_DELETED' });
    expect(get).not.toHaveBeenCalled();
    expect(setOtp).not.toHaveBeenCalled();
  });
  test('control: a live number is still sent a code', async () => {
    const r = res();
    await sendOtp({ body: { phone: '9876543210', purpose: 'login' } } as any, r);
    expect(r.statusCode).toBe(200);
    expect(get).toHaveBeenCalledTimes(1);
  });
  test('every deleted-account refusal carries the code the app keys on', () => {
    const src = fs.readFileSync(path.join(__dirname, '..', 'controllers', 'auth.controller.ts'), 'utf8');
    expect(src).not.toMatch(/status\(403\)\.json\(\{ error: 'This account has been deleted\.' \}\)/);
    expect((src.match(/error: 'This account has been deleted\.', code: 'ACCOUNT_DELETED'/g) ?? []).length).toBe(4);
  });
});

describe('WhatsApp OTP is gone', () => {
  test('an old build asking for whatsapp gets a plain SMS', async () => {
    const r = res();
    await sendOtp({ body: { phone: '9876543210', purpose: 'login', channel: 'whatsapp' } } as any, r);
    expect(r.body).toEqual({ success: true, message: 'OTP sent', channel: 'sms' });
    expect(String(get.mock.calls[0][0])).toMatch(/\/SMS\//);
    expect(String(get.mock.calls[0][0])).not.toMatch(/WAPI|ADDON_SERVICES\/SEND/);
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
