/**
 * The OTP store's Redis gets a tight budget (29 Sep 2026). Live, a failing
 * Upstash with the SDK's default retries cost ~4.3 s per call: send-otp took
 * ~19 s and verify-otp ~15 s. Now: no SDK retries, REDIS_TIMEOUT_MS per call,
 * and after a failure Redis is skipped for REDIS_COOLDOWN_MS so Postgres
 * answers straight away. The codes and counters still work throughout.
 */
const pgRows = new Map<string, { code: string; purpose: string; expires_at: string }>();
jest.mock('../utils/supabase', () => ({
  supabase: {
    from: () => ({
      upsert: async (row: any) => { pgRows.set(row.phone, row); return { error: null }; },
      select: () => ({
        eq: (_c: string, phone: string) => ({
          maybeSingle: async () => ({ data: pgRows.get(phone) ?? null, error: null }),
        }),
      }),
      delete: () => ({ eq: async (_c: string, phone: string) => { pgRows.delete(phone); return { error: null }; } }),
    }),
  },
}));

const mockState = { mode: 'ok' as 'ok' | 'hang' | 'fail', kv: new Map<string, string>(), calls: 0 };
function mockRun<T>(v: () => T): Promise<T> {
  mockState.calls += 1;
  if (mockState.mode === 'fail') return Promise.reject(new Error('redis down'));
  if (mockState.mode === 'hang') return new Promise<T>(() => {});
  return Promise.resolve(v());
}
const mockRedis = {
  set: jest.fn((k: string, v: string) => mockRun(() => { mockState.kv.set(k, v); return 'OK'; })),
  get: jest.fn((k: string) => mockRun(() => mockState.kv.get(k) ?? null)),
  del: jest.fn((k: string) => mockRun(() => { mockState.kv.delete(k); return 1; })),
  incr: jest.fn((k: string) => mockRun(() => { const n = Number(mockState.kv.get(k) ?? 0) + 1; mockState.kv.set(k, String(n)); return n; })),
  expire: jest.fn((_k: string) => mockRun(() => 1)),
};
const mockCtor = jest.fn((_opts: unknown) => mockRedis);
jest.mock('@upstash/redis', () => ({ Redis: mockCtor }));

// eslint-disable-next-line import/first
import {
  setOtp, getOtp, bumpCounter, readCounter,
  __resetOtpStoreForTests, REDIS_TIMEOUT_MS, REDIS_COOLDOWN_MS,
} from '../utils/otpStore';

const P = '+919000000001';
const ENV = { ...process.env };
beforeEach(() => {
  process.env = { ...ENV, UPSTASH_REDIS_REST_URL: 'https://redis.test', UPSTASH_REDIS_REST_TOKEN: 't' };
  mockState.mode = 'ok';
  mockState.kv.clear();
  mockState.calls = 0;
  mockCtor.mockClear();
  pgRows.clear();
  __resetOtpStoreForTests();
});
afterEach(() => jest.restoreAllMocks());
afterAll(() => { process.env = ENV; });

test('the client is built with SDK retries off, and a healthy Redis is still used', async () => {
  await expect(setOtp(P, '482913', 'login')).resolves.toBe('redis');
  expect(mockCtor).toHaveBeenCalledWith(expect.objectContaining({ retry: false }));
  await expect(getOtp(P)).resolves.toEqual({ code: '482913', purpose: 'login' });
});

test('a hanging Redis costs one budget, then Postgres keeps the code', async () => {
  mockState.mode = 'hang';
  const t0 = Date.now();
  await expect(setOtp(P, '482913', 'login')).resolves.toBe('postgres');
  expect(Date.now() - t0).toBeLessThan(REDIS_TIMEOUT_MS + 500);
  const t1 = Date.now();
  await expect(getOtp(P)).resolves.toEqual({ code: '482913', purpose: 'login' });
  expect(Date.now() - t1).toBeLessThan(100); // cooldown: Redis isn't asked again
});

test('after a failure Redis is skipped for the cooldown, then tried again', async () => {
  mockState.mode = 'fail';
  await setOtp(P, '482913', 'login');
  await getOtp(P);
  expect(await bumpCounter('wrong:' + P, 900)).toBe(1);
  expect(await bumpCounter('wrong:' + P, 900)).toBe(2);
  expect(await readCounter('wrong:' + P)).toBe(2); // counted in Postgres, read back from Postgres
  expect(mockState.calls).toBe(1); // only the first call reached Redis

  mockState.mode = 'ok';
  const now = Date.now();
  jest.spyOn(Date, 'now').mockReturnValue(now + REDIS_COOLDOWN_MS + 1);
  await expect(setOtp(P, '111222', 'login')).resolves.toBe('redis');
  expect(mockState.calls).toBe(2);
});
