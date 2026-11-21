/**
 * Q13 (Dipak, 21 Nov 2026) · a daily ceiling on every SMS the server pays for.
 *
 * Sign-in codes per connection went up from 5 to 50 an hour (clubs share one
 * Wi-Fi), so a total for the whole server caps the bill if something goes wrong.
 * Counted per IST day in the OTP counter store (Redis → Postgres → memory, so it
 * survives restarts and is shared between instances). Test-number codes send no
 * SMS and are not counted.
 *
 *   SMS_DAILY_CAP  whole number; default 2000. 0 or unset-and-malformed → default.
 *
 * Alerts (a console.error line Render keeps, and a Sentry event when Sentry is on)
 * fire once when 80% of the day's cap is used and once when the cap is reached.
 */
import { bumpCounter, readCounter } from './otpStore';
import { istDay } from './appTime';
import { captureError } from './sentry';

export const SMS_DAILY_CAP_DEFAULT = 2000;

export function smsDailyCap(env: NodeJS.ProcessEnv = process.env): number {
  const n = Number((env.SMS_DAILY_CAP ?? '').trim());
  return Number.isInteger(n) && n > 0 ? n : SMS_DAILY_CAP_DEFAULT;
}

const key = (d: Date) => `smsday:${istDay(d)}`;

function alert(level: 'warn' | 'cap', used: number, cap: number): void {
  const msg = level === 'cap'
    ? `[sms-cap] daily SMS cap reached (${used}/${cap}); sign-in codes are refused until midnight IST`
    : `[sms-cap] ${used} of ${cap} daily SMS used (80%)`;
  // eslint-disable-next-line no-console
  console.error(msg);
  captureError(new Error(msg), { kind: 'sms_daily_cap', used, cap });
}

/** True when today's cap is already used up (checked before a send). */
export async function smsCapReached(now: Date = new Date()): Promise<boolean> {
  const cap = smsDailyCap();
  const used = await readCounter(key(now)).catch(() => 0);
  return used >= cap;
}

/** Count one SMS that went out, and alert at 80% and at the cap. Returns today's total. */
export async function countSmsSent(now: Date = new Date()): Promise<number> {
  const cap = smsDailyCap();
  const n = await bumpCounter(key(now), 36 * 3600).catch(() => 0);
  if (n === Math.ceil(cap * 0.8) && n < cap) alert('warn', n, cap);
  if (n === cap) alert('cap', n, cap);
  return n;
}
