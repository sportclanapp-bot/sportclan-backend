/**
 * Rate-limit counts in Upstash Redis, so a limit holds across instances
 * (29 Sep 2026 · launch gate "move the limits into Redis before running more
 * than one Render instance"). One store per limiter, keyed `rl:<name>:<key>`.
 *
 * Two modes, because Redis costs ~235 ms a call from Render:
 *
 *  - 'blocking' — for the auth-sensitive limiters (send-otp, reset / verify
 *    checks, /auth, data export). Each hit does one Redis round trip (INCR, and
 *    PEXPIRE on the window's first hit, in one script) and the answer is the
 *    shared count. Exact across instances.
 *
 *  - 'async' — for the limiters on EVERY request (the global per-user / per-IP
 *    budget and the authenticated per-IP ceiling). The local count decides at
 *    once and never waits on Redis; the INCR is sent in the background and the
 *    shared total it returns is remembered, so the next decision for that key
 *    uses max(local count, last shared total + local hits since). Approximate
 *    across instances: another instance's hits are seen one request late.
 *
 * Every hit is also counted locally, so when Redis is unreachable the limit
 * falls back to this instance's own count — a Redis outage never blocks anyone
 * and never lifts a limit entirely. Same budget as utils/otpStore and
 * utils/sessionDeny: no SDK retries, REDIS_TIMEOUT_MS per call, and after a
 * failure Redis is skipped for REDIS_COOLDOWN_MS.
 */
import type { Options, Store, IncrementResponse } from 'express-rate-limit';

export const REDIS_TIMEOUT_MS = 1500;
export const REDIS_COOLDOWN_MS = 60_000;

type RedisLike = { eval: Function; decr: Function; del: Function };

let _redis: RedisLike | null = null;
let _redisChecked = false;
let _redisDownUntil = 0;

function redisClient(): RedisLike | null {
  if (Date.now() < _redisDownUntil) return null;
  if (_redisChecked) return _redis;
  _redisChecked = true;
  const url = process.env.UPSTASH_REDIS_REST_URL;
  const token = process.env.UPSTASH_REDIS_REST_TOKEN;
  if (!url || !token) return (_redis = null);
  try {
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const { Redis } = require('@upstash/redis');
    _redis = new Redis({ url, token, retry: false });
  } catch {
    _redis = null;
  }
  return _redis;
}

/** One Redis call within the budget; a failure starts the cooldown and rethrows. */
async function redisCall<T>(op: () => Promise<T>): Promise<T> {
  try {
    return await new Promise<T>((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error(`timed out after ${REDIS_TIMEOUT_MS} ms`)), REDIS_TIMEOUT_MS);
      op().then((v) => { clearTimeout(timer); resolve(v); }, (e) => { clearTimeout(timer); reject(e); });
    });
  } catch (err) {
    _redisDownUntil = Date.now() + REDIS_COOLDOWN_MS;
    throw err;
  }
}

/** INCR, set the window on the first hit (or if the key somehow has none), and return [count, ms left]. */
const INCR_SCRIPT = `
local n = redis.call('INCR', KEYS[1])
local ttl = redis.call('PTTL', KEYS[1])
if n == 1 or ttl < 0 then
  redis.call('PEXPIRE', KEYS[1], ARGV[1])
  ttl = tonumber(ARGV[1])
end
return {n, ttl}`;

type Local = { hits: number; resetAt: number };
type Shared = { total: number; localAtThatPoint: number; resetAt: number };

export class RedisRateLimitStore implements Store {
  /** Keys are shared through Redis, not local to this process. */
  localKeys = false;
  prefix: string;
  private windowMs = 60_000;
  private local = new Map<string, Local>();
  private shared = new Map<string, Shared>();

  constructor(private readonly name: string, private readonly mode: 'blocking' | 'async') {
    this.prefix = `rl:${name}:`;
  }

  init(options: Options): void {
    this.windowMs = options.windowMs;
  }

  private sweep(now: number): void {
    if (this.local.size < 10_000) return;
    for (const [k, v] of this.local) if (v.resetAt <= now) this.local.delete(k);
    for (const [k, v] of this.shared) if (v.resetAt <= now) this.shared.delete(k);
  }

  /** Count the hit locally; returns the local entry (window starts on its first hit). */
  private bumpLocal(key: string, now: number): Local {
    let e = this.local.get(key);
    if (!e || e.resetAt <= now) {
      e = { hits: 0, resetAt: now + this.windowMs };
      this.local.set(key, e);
      this.shared.delete(key);
    }
    e.hits += 1;
    return e;
  }

  private async redisIncrement(key: string): Promise<{ total: number; msLeft: number } | null> {
    const r = redisClient();
    if (!r) return null;
    try {
      const res = await redisCall(() => r.eval(INCR_SCRIPT, [this.prefix + key], [String(this.windowMs)]));
      const [n, ttl] = (res as [number | string, number | string]).map(Number);
      if (!Number.isFinite(n)) return null;
      return { total: n, msLeft: Number.isFinite(ttl) && ttl > 0 ? ttl : this.windowMs };
    } catch {
      return null;
    }
  }

  async increment(key: string): Promise<IncrementResponse> {
    const now = Date.now();
    this.sweep(now);
    const loc = this.bumpLocal(key, now);

    if (this.mode === 'blocking') {
      const got = await this.redisIncrement(key);
      if (got) return { totalHits: Math.max(got.total, loc.hits), resetTime: new Date(now + got.msLeft) };
      return { totalHits: loc.hits, resetTime: new Date(loc.resetAt) };
    }

    // async: decide now from what's known, then learn the shared total in the background.
    const s = this.shared.get(key);
    const estimate = s && s.resetAt > now ? s.total + (loc.hits - s.localAtThatPoint) : 0;
    const localAtSend = loc.hits;
    void this.redisIncrement(key).then((got) => {
      if (!got) return;
      const cur = this.local.get(key);
      if (!cur) return;
      const prev = this.shared.get(key);
      // Keep the freshest answer (responses can come back out of order).
      if (!prev || localAtSend >= prev.localAtThatPoint) {
        this.shared.set(key, { total: got.total, localAtThatPoint: localAtSend, resetAt: Date.now() + got.msLeft });
      }
    });
    return { totalHits: Math.max(loc.hits, estimate), resetTime: new Date(loc.resetAt) };
  }

  async decrement(key: string): Promise<void> {
    const e = this.local.get(key);
    if (e && e.hits > 0) e.hits -= 1;
    const r = redisClient();
    if (!r) return;
    try { await redisCall(() => r.decr(this.prefix + key)); } catch { /* local count stands */ }
  }

  async resetKey(key: string): Promise<void> {
    this.local.delete(key);
    this.shared.delete(key);
    const r = redisClient();
    if (!r) return;
    try { await redisCall(() => r.del(this.prefix + key)); } catch { /* local reset stands */ }
  }

  /** Tests only. */
  __name(): string { return this.name; }
}

/** Tests only: forget the client, the cooldown and the config. */
export function __resetRateLimitRedis(): void {
  _redis = null;
  _redisChecked = false;
  _redisDownUntil = 0;
}
