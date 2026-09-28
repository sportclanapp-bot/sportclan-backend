/**
 * Decision 15 (Dipak, 29 Sep 2026 · B11-F14) · signing out ONE device stops it
 * at once, not up to 15 minutes later.
 *
 * Signing a device out deletes (or revokes) its refresh_tokens row, so it can't
 * renew — but the access token already in its hands stayed valid for the rest
 * of its 15 minutes. "Sign out all" and a password reset already close that
 * gap for the whole account (SC-384, sessionRevocation: a per-user cutoff).
 * This is the per-device half: every access token now carries `sid`, the id of
 * the refresh_tokens row it was minted from, and signing that row out puts the
 * sid on a deny list for one access-token lifetime.
 *
 * Where the list lives, in order:
 *   1. Upstash Redis — the same instance the OTP store uses
 *      (UPSTASH_REDIS_REST_URL / UPSTASH_REDIS_REST_TOKEN). Shared by every
 *      server instance; entries expire on their own.
 *   2. This process — always written too, so the instance that did the
 *      signing out refuses the token at once even if Redis is down, and the
 *      local check server (no Redis) works.
 *
 * The check FAILS OPEN: if Redis can't be reached, the token is allowed (and
 * it's logged, at most once a minute). An outage must not sign everyone out;
 * the refresh token is gone either way, so the device still can't renew.
 *
 * Cost: one Redis GET per request, at most once per sid per CHECK_TTL_MS — a
 * "not signed out" answer is remembered for that long, like SC-384's cache.
 * So another instance may take up to that long to notice; this one is instant.
 */
import { ACCESS_TOKEN_TTL_SECONDS } from './jwt';

type RedisLike = { set: Function; get: Function };

let _redis: RedisLike | null = null;
let _redisChecked = false;

function redis(): RedisLike | null {
  if (_redisChecked) return _redis;
  _redisChecked = true;
  const url = process.env.UPSTASH_REDIS_REST_URL;
  const token = process.env.UPSTASH_REDIS_REST_TOKEN;
  if (!url || !token) return (_redis = null);
  try {
    // Lazily, like otpStore: an unconfigured deploy never loads the SDK.
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const { Redis } = require('@upstash/redis');
    // No SDK retries: its default backoff (Math.exp(n) * 50 ms, 5 tries) held
    // every authenticated request ~4.3 s whenever Redis failed (live, 29 Sep).
    _redis = new Redis({ url, token, retry: false });
  } catch {
    _redis = null;
  }
  return _redis;
}

/**
 * The deny check sits in front of every authenticated request, so Redis gets a
 * tight budget: one attempt, REDIS_TIMEOUT_MS (1.5 s: a call to our Upstash region takes ~235 ms warm and more on a cold connection, so 300 ms kept tripping the cooldown on live), and after any failure Redis is
 * skipped for REDIS_COOLDOWN_MS (the check fails open meanwhile, as below).
 */
export const REDIS_TIMEOUT_MS = 1500;
export const REDIS_COOLDOWN_MS = 60_000;
let redisDownUntil = 0;

function withTimeout<T>(p: Promise<T>): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(`timed out after ${REDIS_TIMEOUT_MS} ms`)), REDIS_TIMEOUT_MS);
    p.then((v) => { clearTimeout(timer); resolve(v); }, (e) => { clearTimeout(timer); reject(e); });
  });
}

/** Kept a minute past the token's life, so clock skew can't reopen it. */
const DENY_SECONDS = ACCESS_TOKEN_TTL_SECONDS + 60;
/** How long a "not signed out" answer from Redis is reused for a sid. */
export const CHECK_TTL_MS = 10_000;

const key = (sid: string) => `sdeny:${sid}`;
const denied = new Map<string, number>(); // sid → expires at (ms)
const cleared = new Map<string, number>(); // sid → "not denied" checked at (ms)

let lastWarnAt = 0;
function warn(what: string, err: unknown): void {
  if (Date.now() - lastWarnAt < 60_000) return;
  lastWarnAt = Date.now();
  // eslint-disable-next-line no-console
  console.warn(`[sessionDeny] ${what} failed; allowing (fail open):`, (err as Error)?.message ?? err);
}

function sweep(now: number): void {
  if (denied.size > 5000) for (const [s, exp] of denied) if (exp <= now) denied.delete(s);
  if (cleared.size > 5000) for (const [s, at] of cleared) if (now - at > CHECK_TTL_MS) cleared.delete(s);
}

/** Sign these sessions out now: their access tokens are refused from the next request. */
export async function denySessions(sids: Array<string | null | undefined>): Promise<void> {
  const ids = Array.from(new Set(sids.filter((s): s is string => typeof s === 'string' && !!s)));
  if (ids.length === 0) return;
  const now = Date.now();
  sweep(now);
  for (const sid of ids) {
    denied.set(sid, now + DENY_SECONDS * 1000);
    cleared.delete(sid);
  }
  const r = redis();
  if (!r || now < redisDownUntil) return;
  try {
    await withTimeout(Promise.all(ids.map((sid) => r.set(key(sid), '1', { ex: DENY_SECONDS }))));
  } catch (err) {
    redisDownUntil = Date.now() + REDIS_COOLDOWN_MS;
    warn('deny write', err);
  }
}

/** Has this session been signed out? One Redis GET at most per sid per CHECK_TTL_MS. */
export async function isSessionDenied(sid: string | null | undefined): Promise<boolean> {
  if (!sid) return false;
  const now = Date.now();
  const exp = denied.get(sid);
  if (exp !== undefined) {
    if (exp > now) return true;
    denied.delete(sid);
  }
  const r = redis();
  if (!r || now < redisDownUntil) return false;
  const at = cleared.get(sid);
  if (at !== undefined && now - at < CHECK_TTL_MS) return false;
  try {
    const v = await withTimeout(r.get(key(sid)));
    if (v != null) {
      denied.set(sid, now + DENY_SECONDS * 1000);
      return true;
    }
    cleared.set(sid, now);
    sweep(now);
    return false;
  } catch (err) {
    redisDownUntil = Date.now() + REDIS_COOLDOWN_MS;
    warn('deny check', err);
    return false;
  }
}

/** Tests only: forget everything, and re-read the Redis config. */
export function __resetSessionDeny(): void {
  denied.clear();
  cleared.clear();
  _redis = null;
  _redisChecked = false;
  lastWarnAt = 0;
  redisDownUntil = 0;
}
