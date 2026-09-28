/**
 * Phase 4 · K1 (backend fix commits) — register rejects a malformed phone
 * (SC-72), and two temporary diagnostics stay removed: the captaincy-path
 * fields on the delete-account response and the /debug/tz endpoint.
 * Supabase, the OTP store and the SMS provider are mocked (no network, no SMS).
 */
import fs from 'fs';
import path from 'path';

const mockCalls: string[] = [];
let mockRpcError: unknown = null;
jest.mock('../utils/supabase', () => {
  const chain: any = {};
  for (const m of ['from', 'select', 'in', 'not', 'eq', 'neq', 'is', 'ilike', 'limit', 'maybeSingle', 'single', 'update', 'delete', 'order', 'insert']) {
    chain[m] = jest.fn((...a: unknown[]) => { mockCalls.push(`${m}:${JSON.stringify(a)}`); return chain; });
  }
  chain.rpc = jest.fn(async () => ({ data: null, error: mockRpcError }));
  chain.then = (ok: (v: unknown) => unknown) => ok({ data: null, error: null });
  return { supabase: chain };
});
jest.mock('../utils/otpStore', () => ({
  setOtp: jest.fn(async () => undefined),
  getOtp: jest.fn(async () => null),
  deleteOtp: jest.fn(async () => undefined),
  bumpCounter: jest.fn(async () => 1),
  readCounter: jest.fn(async () => 0),
  clearCounter: jest.fn(async () => undefined),
}));
jest.mock('axios', () => ({ __esModule: true, default: { get: jest.fn(async () => ({ data: { Status: 'Success' } })) } }));
jest.mock('../utils/sessionRevocation', () => ({ revokeSessionsNow: jest.fn(async () => Date.now()) }));

// eslint-disable-next-line import/first
import { register } from '../controllers/auth.controller';
// eslint-disable-next-line import/first
import { deleteAccount } from '../controllers/account.controller';
// eslint-disable-next-line import/first
import { getOtp } from '../utils/otpStore';

const res = () => {
  const r: any = { statusCode: 200, body: null };
  r.status = jest.fn((c: number) => { r.statusCode = c; return r; });
  r.json = jest.fn((b: unknown) => { r.body = b; return r; });
  return r;
};
const code = (rel: string) => fs.readFileSync(path.join(__dirname, '..', rel), 'utf8')
  .replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');

beforeEach(() => { mockCalls.length = 0; mockRpcError = null; (getOtp as jest.Mock).mockClear(); });

describe('SC-72 · register refuses a phone that is not a mobile number', () => {
  test.each(['12', 'abcdefghij', '98765', '98765432101234', '1234567890'])('K1-64 (74c0210): "%s" → 400 INVALID_PHONE, no account created', async (phone) => {
    const r = res();
    await register({ body: { phone, code: '482913', name: 'Arjun', username: 'arjun_19' } } as any, r);
    expect(r.statusCode).toBe(400);
    expect(r.body).toEqual({ error: 'Enter a valid 10-digit Indian mobile number.', code: 'INVALID_PHONE' });
    expect(mockCalls.some((c) => c.startsWith('insert:'))).toBe(false);
  });
});

describe('temporary diagnostics stay removed', () => {
  test.each([[null], [{ message: 'function finalize_captaincy_on_delete does not exist' }]])(
    'K1-65 (9321fed): the delete-account response carries no captaincy-path debug fields (rpc error %j)',
    async (err) => {
      mockRpcError = err;
      const r = res();
      await deleteAccount({ userId: '11111111-1111-4111-8111-111111111111', body: { confirmation: 'DELETE' } } as any, r);
      expect(r.statusCode).toBe(200);
      expect(Object.keys(r.body).sort()).toEqual(['message', 'success']);
      expect(JSON.stringify(r.body)).not.toMatch(/captaincy|rpcErr|does not exist/i);
    },
  );
  test('K1-73 (794d637): no /debug/tz (or any /debug) route is mounted', () => {
    expect(code('index.ts')).not.toMatch(/app\.(get|use)\(\s*['"`]\/debug/);
    expect(code('index.ts')).not.toContain('resolvedTimeZone');
  });
});
