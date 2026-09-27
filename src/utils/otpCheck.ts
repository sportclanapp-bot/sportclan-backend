/**
 * One code check for every endpoint that accepts an OTP (28 Sep 2026).
 *
 * Before this, each endpoint compared the stored code itself, a code could be
 * guessed for its whole 5 minutes with no limit, and the `VERIFIED` marker that
 * /auth/verify-otp leaves behind was accepted by /auth/reset-password WITHOUT
 * the code — for 5 minutes after the owner verified, anyone could set the
 * password with any code. Now:
 *
 *  - 5 wrong codes for a number and its code is gone: a new one must be sent
 *    (the send-otp limits then apply). A 6-digit code with 5 guesses is a
 *    1-in-200,000 chance, per code sent.
 *  - the verified marker carries a hash of the code it was earned with, so it
 *    only stands in for THAT code;
 *  - a caller can require the code's purpose (reset-password requires 'reset').
 *
 * The wrong-guess count lives in the same store as the codes (Redis on
 * Render, else otp_codes, else memory — see otpStore counters), so it survives
 * a restart and holds across instances.
 */
import crypto from 'crypto';
import { getOtp, deleteOtp, bumpCounter, readCounter, clearCounter } from './otpStore';

export const MAX_WRONG_CODES = 5;
const COUNTER_TTL_SECONDS = 15 * 60;
const wrongKey = (phone: string) => `wrong:${phone}`;

export async function wrongCount(phone: string): Promise<number> {
  return readCounter(wrongKey(phone));
}

/** The value verify-otp stores once a code is proven — bound to that code. */
export function verifiedMarker(code: string): string {
  return `VERIFIED:${crypto.createHash('sha256').update(String(code)).digest('hex').slice(0, 32)}`;
}

export type OtpCheck = 'ok' | 'wrong' | 'expired' | 'locked' | 'wrong_purpose';

/**
 * Check `code` for `phone`. On 'wrong' the counter goes up; the 5th wrong code
 * deletes the stored code and answers 'locked'. On 'ok' the counter clears.
 */
export async function checkOtpCode(
  phone: string,
  code: string,
  opts: { purpose?: string } = {},
): Promise<OtpCheck> {
  if ((await wrongCount(phone)) >= MAX_WRONG_CODES) return 'locked';
  const entry = await getOtp(phone);
  if (!entry) return 'expired';
  const matches = String(entry.code) === String(code) || entry.code === verifiedMarker(code);
  if (!matches) {
    const n = await bumpCounter(wrongKey(phone), COUNTER_TTL_SECONDS);
    if (n >= MAX_WRONG_CODES) {
      await deleteOtp(phone);
      return 'locked';
    }
    return 'wrong';
  }
  if (opts.purpose && entry.purpose !== opts.purpose) return 'wrong_purpose';
  await clearCounter(wrongKey(phone));
  return 'ok';
}

/** The answer each result gets, the same everywhere. */
export function otpCheckError(result: Exclude<OtpCheck, 'ok'>): { status: number; body: { error: string; code: string } } {
  switch (result) {
    case 'locked':
      return { status: 429, body: { error: 'Too many wrong codes. Request a new code and try again.', code: 'OTP_LOCKED' } };
    case 'expired':
      return { status: 400, body: { error: 'No OTP requested or OTP expired', code: 'OTP_EXPIRED' } };
    case 'wrong_purpose':
      return { status: 400, body: { error: 'That code was sent for something else. Request a new code for this.', code: 'OTP_WRONG_PURPOSE' } };
    default:
      return { status: 400, body: { error: 'That code isn\u2019t right. Check the 6 digits and try again.', code: 'OTP_WRONG' } };
  }
}

/**
 * A fresh code starts a fresh count — "5 wrong and that code is gone, send a
 * new one" — without it a locked number stayed locked for 15 minutes even with
 * a new code. Guessing stays bounded by the per-number limit on the checking
 * endpoints (10 an hour) and the send limits.
 */
export async function clearWrongCodes(phone: string): Promise<void> {
  await clearCounter(wrongKey(phone));
}
