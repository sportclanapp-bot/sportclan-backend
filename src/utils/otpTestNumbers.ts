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

/** The allowlist, or null when the feature is off. */
export function otpTestConfig(env: NodeJS.ProcessEnv = process.env): OtpTestConfig | null {
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
