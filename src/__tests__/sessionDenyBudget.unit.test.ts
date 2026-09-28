/**
 * The deny check sits in front of every authenticated request (29 Sep 2026).
 * Live, a failing Upstash held each request ~4.3 s: the SDK's default retries
 * (Math.exp(n) * 50 ms) ran to the end before the check failed open. Now: no
 * SDK retries, a REDIS_TIMEOUT_MS budget, and after a failure Redis is skipped
 * for REDIS_COOLDOWN_MS.
 */
const mockRedis = {
  mode: 'ok' as 'ok' | 'hang' | 'fail',
  get: jest.fn(async (_k: string) => {
    if (mockRedis.mode === 'fail') throw new Error('redis down');
    if (mockRedis.mode === 'hang') return new Promise(() => {});
    return null;
  }),
  set: jest.fn(async () => {
    if (mockRedis.mode === 'fail') throw new Error('redis down');
    if (mockRedis.mode === 'hang') return new Promise(() => {});
    return 'OK';
  }),
};
const mockCtor = jest.fn((_opts: unknown) => mockRedis);
jest.mock('@upstash/redis', () => ({ Redis: mockCtor }));

// eslint-disable-next-line import/first
import { isSessionDenied, denySessions, __resetSessionDeny, REDIS_TIMEOUT_MS, REDIS_COOLDOWN_MS } from '../utils/sessionDeny';

const ENV = { ...process.env };
beforeEach(() => {
  process.env = { ...ENV, UPSTASH_REDIS_REST_URL: 'https://redis.test', UPSTASH_REDIS_REST_TOKEN: 't' };
  mockRedis.mode = 'ok';
  mockRedis.get.mockClear();
  mockRedis.set.mockClear();
  mockCtor.mockClear();
  __resetSessionDeny();
  jest.spyOn(console, 'warn').mockImplementation(() => {});
});
afterEach(() => jest.restoreAllMocks());
afterAll(() => { process.env = ENV; });

test('the client is built with SDK retries off', async () => {
  await isSessionDenied('sid-1');
  expect(mockCtor).toHaveBeenCalledWith(expect.objectContaining({ retry: false }));
});

test('a hanging Redis costs at most the budget, and the check fails open', async () => {
  mockRedis.mode = 'hang';
  const t0 = Date.now();
  expect(await isSessionDenied('sid-1')).toBe(false);
  const took = Date.now() - t0;
  expect(took).toBeGreaterThanOrEqual(REDIS_TIMEOUT_MS - 20);
  expect(took).toBeLessThan(REDIS_TIMEOUT_MS + 500);
});

test('after a failure Redis is skipped for the cooldown, then tried again', async () => {
  mockRedis.mode = 'fail';
  expect(await isSessionDenied('sid-1')).toBe(false);
  expect(await isSessionDenied('sid-2')).toBe(false);
  expect(await isSessionDenied('sid-3')).toBe(false);
  expect(mockRedis.get).toHaveBeenCalledTimes(1); // one failed call, then none

  mockRedis.mode = 'ok';
  const now = Date.now();
  jest.spyOn(Date, 'now').mockReturnValue(now + REDIS_COOLDOWN_MS + 1);
  expect(await isSessionDenied('sid-4')).toBe(false);
  expect(mockRedis.get).toHaveBeenCalledTimes(2);
});

test('a deny write that fails still signs the session out on this instance', async () => {
  mockRedis.mode = 'fail';
  await denySessions(['sid-9']);
  expect(await isSessionDenied('sid-9')).toBe(true);
});

test('a hanging deny write returns within the budget', async () => {
  mockRedis.mode = 'hang';
  const t0 = Date.now();
  await denySessions(['sid-8']);
  expect(Date.now() - t0).toBeLessThan(REDIS_TIMEOUT_MS + 500);
  expect(await isSessionDenied('sid-8')).toBe(true);
});
