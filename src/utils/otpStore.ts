/**
 * SC-398 · OTP storage that cannot take down login.
 *
 * The bug this exists to fix: OTP codes lived only in Upstash Redis, and the
 * Redis client THREW from `client()` when `UPSTASH_REDIS_REST_URL` /
 * `UPSTASH_REDIS_REST_TOKEN` were unset. `sendOtp` had no try/catch, so that
 * throw reached the global error handler and every phone-OTP login returned
 * `500 {"error":"Internal server error"}`. Phone OTP is the app's PRIMARY login
 * path — the first button on the first screen — so an unset env var silently
 * bricked the front door while email login kept working and masked it.
 *
 * The lesson is not "set the env var". It is that a single optional dependency
 * should not be the only thing standing between a user and their account. So
 * storage is now a chain, tried in order, each falling through on failure:
 *
 *   1. Upstash Redis  — when configured and reachable (fast, shared, TTL native)
 *   2. Postgres       — `otp_codes` table (durable, correct across instances)
 *   3. In-memory Map  — last resort, single instance, TTL swept
 *
 * Order matters. Postgres sits above memory because Render can run more than
 * one instance: a code issued by instance A must be verifiable by instance B.
 * Memory is only correct for a single instance, which is why it is last and not
 * first — but it is present so the app works on a box with NOTHING configured,
 * including a fresh clone and CI.
 *
 * DEPLOY ORDER: this file must work BEFORE migration 084 creates `otp_codes`.
 * A missing table is a normal fall-through to memory (42P01 / PGRST205), not an
 * error, so the code can ship ahead of the migration exactly like every other
 * change in this codebase.
 */
import { supabase } from './supabase';

export interface OtpData {
  code: string;
  purpose: string;
}

/** Which backend actually served the last write — surfaced for diagnostics. */
export type OtpBackend = 'redis' | 'postgres' | 'memory';

function otpKey(phone: string): string {
  return `otp:${phone}`;
}

/* ------------------------------------------------------------------ *
 * 1 · Upstash Redis (optional)
 * ------------------------------------------------------------------ */

let _redis: unknown | null = null;
let _redisChecked = false;

function redisClient(): { set: Function; get: Function; del: Function } | null {
  if (_redisChecked) return _redis as never;
  _redisChecked = true;
  const url = process.env.UPSTASH_REDIS_REST_URL;
  const token = process.env.UPSTASH_REDIS_REST_TOKEN;
  if (!url || !token) {
    _redis = null;
    return null;
  }
  try {
    // Required lazily so an unconfigured deploy never even loads the SDK.
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const { Redis } = require('@upstash/redis');
    _redis = new Redis({ url, token });
  } catch {
    _redis = null;
  }
  return _redis as never;
}

/* ------------------------------------------------------------------ *
 * 2 · Postgres (`otp_codes`, migration 084)
 * ------------------------------------------------------------------ */

/**
 * Set once we learn the table isn't there, so a pre-migration deploy doesn't
 * pay a failed round-trip on every single OTP.
 */
let _pgMissing = false;

function isMissingTable(err: { code?: string } | null): boolean {
  return err?.code === '42P01' || err?.code === 'PGRST205';
}

/* ------------------------------------------------------------------ *
 * 3 · Memory (last resort)
 * ------------------------------------------------------------------ */

const _mem = new Map<string, { data: OtpData; expiresAt: number }>();

function memSweep(): void {
  const now = Date.now();
  for (const [k, v] of _mem) if (v.expiresAt <= now) _mem.delete(k);
}

/* ------------------------------------------------------------------ *
 * Public API — same three functions the old redis.ts exported.
 * ------------------------------------------------------------------ */

export async function setOtp(
  phone: string,
  code: string,
  purpose: string,
  ttlSeconds = 300,
): Promise<OtpBackend> {
  const payload: OtpData = { code, purpose };

  const r = redisClient();
  if (r) {
    try {
      await r.set(otpKey(phone), JSON.stringify(payload), { ex: ttlSeconds });
      return 'redis';
    } catch {
      /* fall through — a Redis outage must not block login */
    }
  }

  if (!_pgMissing) {
    const expiresAt = new Date(Date.now() + ttlSeconds * 1000).toISOString();
    // Upsert on phone: a re-request replaces the previous code rather than
    // leaving two live codes for one number.
    const { error } = await supabase
      .from('otp_codes')
      .upsert({ phone, code, purpose, expires_at: expiresAt }, { onConflict: 'phone' });
    if (!error) return 'postgres';
    if (isMissingTable(error)) _pgMissing = true;
  }

  memSweep();
  _mem.set(otpKey(phone), { data: payload, expiresAt: Date.now() + ttlSeconds * 1000 });
  return 'memory';
}

export async function getOtp(phone: string): Promise<OtpData | null> {
  const r = redisClient();
  if (r) {
    try {
      const raw = await r.get(otpKey(phone));
      if (raw) {
        const parsed = typeof raw === 'string' ? JSON.parse(raw) : raw;
        return parsed as OtpData;
      }
    } catch {
      /* fall through */
    }
  }

  if (!_pgMissing) {
    const { data, error } = await supabase
      .from('otp_codes')
      .select('code, purpose, expires_at')
      .eq('phone', phone)
      .maybeSingle();
    if (error) {
      if (isMissingTable(error)) _pgMissing = true;
    } else if (data) {
      // Expiry is enforced on read as well as by the sweep job, so a stale row
      // can never verify even if the sweep hasn't run.
      if (new Date((data as { expires_at: string }).expires_at).getTime() > Date.now()) {
        const d = data as { code: string; purpose: string };
        return { code: d.code, purpose: d.purpose };
      }
      return null;
    }
  }

  memSweep();
  const hit = _mem.get(otpKey(phone));
  return hit && hit.expiresAt > Date.now() ? hit.data : null;
}

export async function deleteOtp(phone: string): Promise<void> {
  const r = redisClient();
  if (r) {
    try {
      await r.del(otpKey(phone));
    } catch {
      /* fall through — still clear the other backends */
    }
  }
  if (!_pgMissing) {
    const { error } = await supabase.from('otp_codes').delete().eq('phone', phone);
    if (error && isMissingTable(error)) _pgMissing = true;
  }
  _mem.delete(otpKey(phone));
}

/** Test seam — resets the memoised backend probes between cases. */
export function __resetOtpStoreForTests(): void {
  _redis = null;
  _redisChecked = false;
  _pgMissing = false;
  _mem.clear();
}
