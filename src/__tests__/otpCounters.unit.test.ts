/**
 * 28 Sep: the wrong-guess count and the per-number send limits live in the
 * OTP store (Redis on Render), not in server memory — they survive a restart
 * and hold across instances. And send-otp has a per-number limit: 5 an hour,
 * 10 a day, allowlisted numbers included.
 */
const redis = new Map<string, number>();
const expires: Record<string, number> = {};
jest.mock('@upstash/redis', () => ({
  Redis: jest.fn().mockImplementation(() => ({
    set: jest.fn(async () => 'OK'),
    get: jest.fn(async (k: string) => (redis.has(k) ? String(redis.get(k)) : null)),
    del: jest.fn(async (k: string) => { redis.delete(k); return 1; }),
    incr: jest.fn(async (k: string) => { const n = (redis.get(k) ?? 0) + 1; redis.set(k, n); return n; }),
    expire: jest.fn(async (k: string, ttl: number) => { expires[k] = ttl; return 1; }),
  })),
}));
jest.mock('../utils/supabase', () => {
  // otp_codes missing → the store falls through to memory
  const missing = { data: null, error: { code: '42P01' } };
  const chain: any = {};
  for (const m of ['from', 'select', 'eq', 'delete']) chain[m] = jest.fn(() => chain);
  chain.maybeSingle = jest.fn(async () => missing);
  chain.upsert = jest.fn(async () => missing);
  chain.then = (ok: (v: unknown) => unknown) => ok(missing);
  return { supabase: chain };
});

// eslint-disable-next-line import/first
import { bumpCounter, readCounter, clearCounter, __resetOtpStoreForTests } from '../utils/otpStore';

const ENV = { ...process.env };
afterAll(() => { process.env = ENV; });

describe('counters live in Redis when Upstash is configured', () => {
  beforeEach(() => {
    process.env.UPSTASH_REDIS_REST_URL = 'https://example.upstash.io';
    process.env.UPSTASH_REDIS_REST_TOKEN = 't';
    __resetOtpStoreForTests();
    redis.clear();
  });
  test('INCR, with the window set on the first hit only', async () => {
    expect(await bumpCounter('wrong:+919000000001', 900)).toBe(1);
    expect(await bumpCounter('wrong:+919000000001', 900)).toBe(2);
    expect(redis.get('ctr:wrong:+919000000001')).toBe(2);
    expect(expires['ctr:wrong:+919000000001']).toBe(900);
    expect(await readCounter('wrong:+919000000001')).toBe(2);
    await clearCounter('wrong:+919000000001');
    expect(await readCounter('wrong:+919000000001')).toBe(0);
  });
});

describe('without Upstash or Postgres, memory still counts (and expires)', () => {
  beforeEach(() => {
    delete process.env.UPSTASH_REDIS_REST_URL;
    delete process.env.UPSTASH_REDIS_REST_TOKEN;
    __resetOtpStoreForTests();
  });
  test('counts up within the window, then starts again', async () => {
    const now = jest.spyOn(Date, 'now').mockReturnValue(1_000_000);
    expect(await bumpCounter('sendh:+919000000002', 3600)).toBe(1);
    expect(await bumpCounter('sendh:+919000000002', 3600)).toBe(2);
    expect(await readCounter('sendh:+919000000002')).toBe(2);
    now.mockReturnValue(1_000_000 + 3601 * 1000);
    expect(await readCounter('sendh:+919000000002')).toBe(0);
    expect(await bumpCounter('sendh:+919000000002', 3600)).toBe(1);
    now.mockRestore();
  });
});
