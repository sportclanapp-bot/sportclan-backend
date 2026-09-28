/**
 * Rate limits count in Upstash Redis (29 Sep 2026), so a limit holds across
 * instances. 'blocking' limiters (auth-sensitive) are exact; 'async' limiters
 * (every request) decide locally and fold in Redis's shared total, so they
 * never wait on Redis. Redis down or hanging → the instance's own count, with
 * the same budget and cooldown as otpStore / sessionDeny.
 */
import fs from 'fs';
import path from 'path';
import http from 'http';

const mockState = {
  mode: 'ok' as 'ok' | 'hang' | 'fail',
  kv: new Map<string, { n: number; expiresAt: number }>(),
  calls: 0,
};
function mockRun<T>(v: () => T): Promise<T> {
  mockState.calls += 1;
  if (mockState.mode === 'fail') return Promise.reject(new Error('redis down'));
  if (mockState.mode === 'hang') return new Promise<T>(() => {});
  return Promise.resolve(v());
}
const mockRedis = {
  // Mirrors INCR_SCRIPT: INCR, window on the first hit, return [count, ms left].
  eval: jest.fn((_s: string, keys: string[], args: string[]) => mockRun(() => {
    const now = Date.now();
    const k = keys[0];
    let e = mockState.kv.get(k);
    if (!e || e.expiresAt <= now) { e = { n: 0, expiresAt: now + Number(args[0]) }; mockState.kv.set(k, e); }
    e.n += 1;
    return [e.n, e.expiresAt - now];
  })),
  decr: jest.fn((k: string) => mockRun(() => { const e = mockState.kv.get(k); if (e) e.n -= 1; return e?.n ?? 0; })),
  del: jest.fn((k: string) => mockRun(() => { mockState.kv.delete(k); return 1; })),
};
const mockCtor = jest.fn((_opts: unknown) => mockRedis);
jest.mock('@upstash/redis', () => ({ Redis: mockCtor }));

// eslint-disable-next-line import/first
import rateLimit from 'express-rate-limit';
// eslint-disable-next-line import/first
import express from 'express';
// eslint-disable-next-line import/first
import { RedisRateLimitStore, __resetRateLimitRedis, REDIS_TIMEOUT_MS, REDIS_COOLDOWN_MS } from '../utils/rateLimitStore';

const WINDOW = 15 * 60 * 1000;
const store = (name: string, mode: 'blocking' | 'async') => {
  const s = new RedisRateLimitStore(name, mode);
  s.init({ windowMs: WINDOW } as never);
  return s;
};
const flush = () => new Promise((r) => setImmediate(r));

const ENV = { ...process.env };
beforeEach(() => {
  process.env = { ...ENV, UPSTASH_REDIS_REST_URL: 'https://redis.test', UPSTASH_REDIS_REST_TOKEN: 't' };
  mockState.mode = 'ok';
  mockState.kv.clear();
  mockState.calls = 0;
  mockCtor.mockClear();
  __resetRateLimitRedis();
});
afterEach(() => jest.restoreAllMocks());
afterAll(() => { process.env = ENV; });

describe('blocking mode (auth-sensitive limiters): exact across instances', () => {
  test('two instances share one count', async () => {
    const a = store('rip', 'blocking');
    const b = store('rip', 'blocking'); // another server instance
    expect((await a.increment('rip:1.2.3.4')).totalHits).toBe(1);
    expect((await b.increment('rip:1.2.3.4')).totalHits).toBe(2);
    expect((await a.increment('rip:1.2.3.4')).totalHits).toBe(3);
    expect(mockCtor).toHaveBeenCalledWith(expect.objectContaining({ retry: false }));
    expect([...mockState.kv.keys()]).toEqual(['rl:rip:rip:1.2.3.4']);
  });
  test('the window expires with the Redis key', async () => {
    const a = store('auth', 'blocking');
    await a.increment('k'); await a.increment('k');
    const now = Date.now();
    jest.spyOn(Date, 'now').mockReturnValue(now + WINDOW + 1);
    const r = await a.increment('k');
    expect(r.totalHits).toBe(1);
    expect(r.resetTime!.getTime()).toBe(now + WINDOW + 1 + WINDOW);
  });
  test('Redis down → this instance keeps counting; Redis is skipped for the cooldown, then tried again', async () => {
    const a = store('sendotp', 'blocking');
    await a.increment('ip'); // counted in Redis and locally
    mockState.mode = 'fail';
    expect((await a.increment('ip')).totalHits).toBe(2); // the local count carries on
    expect((await a.increment('ip')).totalHits).toBe(3);
    expect(mockState.calls).toBe(2); // one failed call, then none during the cooldown
    mockState.mode = 'ok';
    const now = Date.now();
    jest.spyOn(Date, 'now').mockReturnValue(now + REDIS_COOLDOWN_MS + 1);
    await a.increment('ip');
    expect(mockState.calls).toBe(3);
  });
  test('a hanging Redis costs one budget, and the local count answers', async () => {
    mockState.mode = 'hang';
    const a = store('rnum', 'blocking');
    const t0 = Date.now();
    expect((await a.increment('rnum:+919000000002')).totalHits).toBe(1);
    const took = Date.now() - t0;
    expect(took).toBeGreaterThanOrEqual(REDIS_TIMEOUT_MS - 20);
    expect(took).toBeLessThan(REDIS_TIMEOUT_MS + 500);
    const t1 = Date.now();
    expect((await a.increment('rnum:+919000000002')).totalHits).toBe(2);
    expect(Date.now() - t1).toBeLessThan(100); // cooldown: not asked again
  }, 10_000);
  test('resetKey clears both counts', async () => {
    const a = store('export', 'blocking');
    await a.increment('u1'); await a.increment('u1');
    await a.resetKey('u1');
    expect((await a.increment('u1')).totalHits).toBe(1);
  });
});

describe('async mode (limiters on every request): never waits on Redis', () => {
  test('answers at once even when Redis hangs', async () => {
    mockState.mode = 'hang';
    const a = store('global', 'async');
    const t0 = Date.now();
    expect((await a.increment('u:ravi')).totalHits).toBe(1);
    expect((await a.increment('u:ravi')).totalHits).toBe(2);
    expect(Date.now() - t0).toBeLessThan(100);
  });
  test('folds in hits from another instance once Redis has answered', async () => {
    const a = store('global', 'async');
    const b = store('global', 'async');
    for (let i = 0; i < 5; i++) await b.increment('u:ravi'); // 5 hits on instance B
    await flush();
    await a.increment('u:ravi'); // A: local 1; its background INCR returns the shared 6
    await flush();
    expect((await a.increment('u:ravi')).totalHits).toBe(7); // shared 6 + 1 local since
    await flush();
    expect(mockState.kv.get('rl:global:u:ravi')!.n).toBe(7);
  });
  test('Redis down → the local count still limits', async () => {
    mockState.mode = 'fail';
    const a = store('ipc', 'async');
    for (let i = 1; i <= 4; i++) expect((await a.increment('ipc:1.2.3.4')).totalHits).toBe(i);
  });
});

describe('through express-rate-limit', () => {
  test('two app instances sharing Redis enforce ONE limit', async () => {
    const mk = () => {
      const app = express();
      app.use(rateLimit({ windowMs: WINDOW, max: 3, keyGenerator: () => 'same', store: store('rip', 'blocking') }));
      app.get('/', (_q, r) => { r.json({ ok: true }); });
      return app;
    };
    const servers = [mk().listen(0), mk().listen(0)];
    const port = (s: http.Server) => (s.address() as { port: number }).port;
    const hit = (s: http.Server) => fetch(`http://127.0.0.1:${port(s)}/`).then((r) => r.status);
    try {
      const statuses = [await hit(servers[0]), await hit(servers[1]), await hit(servers[0]), await hit(servers[1])];
      expect(statuses).toEqual([200, 200, 200, 429]);
    } finally {
      servers.forEach((s) => s.close());
    }
  });
});

describe('every limiter uses the Redis store', () => {
  const idx = fs.readFileSync(path.join(__dirname, '..', 'index.ts'), 'utf8');
  const acct = fs.readFileSync(path.join(__dirname, '..', 'routes', 'account.routes.ts'), 'utf8');
  test.each([
    ['globalLimiter', 'global', 'async'],
    ['ipCeilingLimiter', 'ipc', 'async'],
    ['authLimiter', 'auth', 'blocking'],
    ['resetCheckIpLimiter', 'rip', 'blocking'],
    ['resetCheckNumberLimiter', 'rnum', 'blocking'],
    ['sendOtpLimiter', 'sendotp', 'blocking'],
  ])('%s → %s (%s)', (limiter, name, mode) => {
    expect(idx).toMatch(new RegExp(`const ${limiter} = rateLimit\\(\\{[\\s\\S]*?store: new RedisRateLimitStore\\('${name}', '${mode}'\\),\\n\\}\\);`));
  });
  test('exportLimiter → export (blocking)', () => {
    expect(acct).toMatch(/const exportLimiter = rateLimit\(\{[\s\S]*?store: new RedisRateLimitStore\('export', 'blocking'\),\n\}\);/);
  });
  test('no limiter is left on the default in-memory store', () => {
    const n = (s: string) => (s.match(/= rateLimit\(\{/g) ?? []).length;
    const m = (s: string) => (s.match(/store: new RedisRateLimitStore\(/g) ?? []).length;
    expect(m(idx)).toBe(n(idx));
    expect(m(acct)).toBe(n(acct));
  });
});
