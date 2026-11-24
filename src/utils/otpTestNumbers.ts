/**
 * OTP test-number allowlist (decided 28 Sep 2026).
 *
 * Device checks and live API checks used to send REAL SMS (2Factor.in) to
 * whatever number was typed — a placeholder +91 99999 99999 got two. For the
 * numbers listed in OTP_TEST_NUMBERS, /auth/send-otp stores OTP_TEST_CODE as the
 * code and sends nothing; every verify path (sign-in, sign-up, Change phone,
 * reset password) already compares against the stored code, so the fixed code
 * is accepted there and nowhere else. Every other number behaves exactly as
 * before. Rate limits are middleware in front of /auth and are unaffected.
 *
 *   OTP_TEST_NUMBERS  comma-separated Indian mobiles, any common form — spaces
 *                     inside a number are fine ("9876500001, +91 98765 00002")
 *   OTP_TEST_CODE     exactly 6 digits
 *
 * Either unset, empty or malformed → the feature is off. Read on every call, so
 * a change on Render takes effect on the next deploy/restart and tests can flip it.
 */
import { canonicalisePhone } from './phone';

export interface OtpTestConfig {
  numbers: Set<string>;
  code: string;
}

/**
 * Q8 + Q45 (Dipak, 21 Nov 2026): no fixed-code way into the live app. In production every test
 * number is off, the store reviewers' number included (reviewers and QA sign in with email +
 * password). Exceptions: a production-mode server whose database is on this machine
 * (localhost / 127.0.0.1: the local test stack, which live can never be), and the tester-period
 * switch below (OTP_TEST_NUMBERS_TESTER_PERIOD=true, off by default).
 */
export function testNumbersAllowed(env: NodeJS.ProcessEnv = process.env): boolean {
  if ((env.NODE_ENV ?? '').trim() !== 'production') return true;
  if (testerPeriodOn(env)) return true;
  const db = (env.SUPABASE_URL ?? '').trim();
  try {
    const h = new URL(db).hostname;
    return h === 'localhost' || h === '127.0.0.1' || h === '::1' || h === '[::1]';
  } catch {
    return false;
  }
}

/**
 * Tester period (Dipak, 24 Nov 2026): human testers use the live app before launch, and real SMS
 * can't go out yet (DLT registration needs the company). While Render has
 * OTP_TEST_NUMBERS_TESTER_PERIOD=true (exactly), a production server still accepts the listed
 * OTP_TEST_NUMBERS with OTP_TEST_CODE, and nothing else changes (the any-number '123456' bypass
 * stays dead in production). Unset / anything else = the launch behaviour above (Q8 + Q45: off).
 * REMOVE THIS VAR ON RENDER AT LAUNCH. A warning is logged once while it is on in production.
 */
let testerWarned = false;
export function testerPeriodOn(env: NodeJS.ProcessEnv = process.env): boolean {
  const on = (env.OTP_TEST_NUMBERS_TESTER_PERIOD ?? '').trim() === 'true';
  if (on && !testerWarned && (env.NODE_ENV ?? '').trim() === 'production') {
    testerWarned = true;
    console.warn('[otp-test-numbers] OTP_TEST_NUMBERS_TESTER_PERIOD=true: listed test numbers sign in with the fixed code on this production server. Remove it at launch.');
  }
  return on;
}

/** The allowlist, or null when the feature is off. */
export function otpTestConfig(env: NodeJS.ProcessEnv = process.env): OtpTestConfig | null {
  if (!testNumbersAllowed(env)) return null;
  const code = (env.OTP_TEST_CODE ?? '').trim();
  const raw = (env.OTP_TEST_NUMBERS ?? '').trim();
  if (!raw || !/^\d{6}$/.test(code)) return null;
  const numbers = new Set(
    raw.split(/[,;\n]+/).map((n) => canonicalisePhone(n.trim())).filter((n): n is string => !!n),
  );
  return numbers.size > 0 ? { numbers, code } : null;
}

/** The fixed code for this (already canonical) phone, or null if it isn't listed. */
export function testCodeFor(canonicalPhone: string, env: NodeJS.ProcessEnv = process.env): string | null {
  const cfg = otpTestConfig(env);
  return cfg && cfg.numbers.has(canonicalPhone) ? cfg.code : null;
}

/** "+91 •••••• 0001" — enough to tell test numbers apart in a log, no more. */
export function maskPhone(canonicalPhone: string): string {
  return `${canonicalPhone.slice(0, 3)} •••••• ${canonicalPhone.slice(-4)}`;
}
