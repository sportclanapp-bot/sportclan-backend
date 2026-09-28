/**
 * Active sessions keeps a phone's app version current (found in the 2.6.0
 * device pass, 29 Sep 2026): a refresh updates the session's version and OS
 * from the headers it brings; one without headers leaves them alone.
 */
const mockUpdates: Array<Record<string, unknown>> = [];
jest.mock('../utils/supabase', () => {
  const chain: any = {};
  for (const m of ['from', 'select', 'eq', 'is', 'in', 'not']) chain[m] = jest.fn(() => chain);
  chain.maybeSingle = jest.fn(async () => ({ data: { id: 'row-1', revoked: false }, error: null }));
  chain.update = jest.fn((v: Record<string, unknown>) => { mockUpdates.push(v); return chain; });
  chain.then = (ok: (v: unknown) => unknown) => ok({ data: null, error: null });
  return { supabase: chain };
});
jest.mock('../utils/jwt', () => ({
  ...jest.requireActual('../utils/jwt'),
  verifyRefreshToken: jest.fn(() => ({ userId: 'u1' })),
  generateAccessToken: jest.fn(() => 'access'),
}));

// eslint-disable-next-line import/first
import { refresh } from '../controllers/auth.controller';
// eslint-disable-next-line import/first
import { refreshedDeviceFields } from '../utils/sessionDevice';

const res = () => {
  const r: any = { statusCode: 200, body: null };
  r.status = jest.fn((c: number) => { r.statusCode = c; return r; });
  r.json = jest.fn((b: unknown) => { r.body = b; return r; });
  return r;
};

beforeEach(() => { mockUpdates.length = 0; });

test('only the device fields actually sent', () => {
  expect(refreshedDeviceFields({ headers: { 'x-app-version': '2.6.0 (8)', 'x-device-os': 'Android 14' } } as never))
    .toEqual({ app_version: '2.6.0 (8)', device_os: 'Android 14' });
  expect(refreshedDeviceFields({ headers: {} } as never)).toEqual({});
});

test('a refresh from an updated app stores its new version', async () => {
  const r = res();
  await refresh({ body: { refreshToken: 'rt' }, headers: { 'x-app-version': '2.6.0 (8)', 'x-device-os': 'Android 14', 'x-device-name': 'Google Pixel 7' } } as never, r);
  await new Promise((s) => setImmediate(s));
  expect(r.body).toEqual({ accessToken: 'access' });
  expect(mockUpdates).toHaveLength(1);
  expect(mockUpdates[0]).toMatchObject({ app_version: '2.6.0 (8)', device_os: 'Android 14', device_name: 'Google Pixel 7' });
  expect(mockUpdates[0].last_used_at).toEqual(expect.any(String));
});

test('a refresh without headers only marks last used', async () => {
  const r = res();
  await refresh({ body: { refreshToken: 'rt' }, headers: {} } as never, r);
  await new Promise((s) => setImmediate(s));
  expect(mockUpdates).toHaveLength(1);
  expect(Object.keys(mockUpdates[0])).toEqual(['last_used_at']);
});
