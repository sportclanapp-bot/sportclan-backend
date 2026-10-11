/**
 * Audit #22 (11 Oct 2026): OTP sign-in and sign-up checked a code without its
 * purpose, so a code sent to reset a password or change a phone also signed in.
 */
import fs from 'fs';
import path from 'path';

const store = new Map<string, { code: string; purpose: string }>();
jest.mock('../utils/otpStore', () => ({
  setOtp: jest.fn(), getOtp: jest.fn(async (p: string) => store.get(p) ?? null), deleteOtp: jest.fn(),
  bumpCounter: jest.fn(async () => 1), readCounter: jest.fn(async () => 0), clearCounter: jest.fn(),
}));
// eslint-disable-next-line import/first
import { checkOtpCode } from '../utils/otpCheck';
// eslint-disable-next-line import/first
import { SIGN_IN_PURPOSES } from '../controllers/auth.controller';

const P = '+919000000043';
describe('audit #22: a code only does what it was sent for', () => {
  it('a reset or change-phone code cannot sign in', async () => {
    for (const purpose of ['reset', 'change_phone']) {
      store.set(P, { code: '111222', purpose });
      expect(await checkOtpCode(P, '111222', { purpose: SIGN_IN_PURPOSES })).toBe('wrong_purpose');
    }
    store.set(P, { code: '111222', purpose: 'login' });
    expect(await checkOtpCode(P, '111222', { purpose: SIGN_IN_PURPOSES })).toBe('ok');
  });
  it('OTP sign-in and sign-up both ask for a sign-in code', () => {
    const s = fs.readFileSync(path.join(__dirname, '..', 'controllers', 'auth.controller.ts'), 'utf8');
    for (const fn of ['export async function otpLogin(', 'export async function register(']) {
      const body = s.slice(s.indexOf(fn), s.indexOf('\nexport ', s.indexOf(fn) + 10));
      expect(body).toMatch(/checkOtpCode\(p, code, \{ requester: clientIpKey\(req\), purpose: SIGN_IN_PURPOSES \}\)/);
    }
  });
});
