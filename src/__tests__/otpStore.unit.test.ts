/**
 * SC-398 · OTP storage must never be the reason login fails.
 *
 * The regression being locked down: with Upstash unconfigured, the old
 * redis.ts `client()` threw, `sendOtp` had no try/catch, and every phone-OTP
 * login returned 500. These tests run with NO Upstash env and NO `otp_codes`
 * table — the exact production condition that broke it — and assert that a code
 * can still be stored, read back, and deleted.
 */

// Supabase is stubbed to behave like a database WITHOUT the otp_codes table
// (migration 084 not yet applied), which is the deploy-order case: the code
// ships before the migration and must degrade to memory rather than throw.
const missingTable = { code: '42P01', message: 'relation "otp_codes" does not exist' };

let tableExists = false;
const pgRows = new Map<string, { code: string; purpose: string; expires_at: string }>();

jest.mock('../utils/supabase', () => ({
  supabase: {
    from: () => ({
      upsert: async (row: any) => {
        if (!tableExists) return { error: missingTable };
        pgRows.set(row.phone, row);
        return { error: null };
      },
      select: () => ({
        eq: (_c: string, phone: string) => ({
          maybeSingle: async () => {
            if (!tableExists) return { data: null, error: missingTable };
            return { data: pgRows.get(phone) ?? null, error: null };
          },
        }),
      }),
      delete: () => ({
        eq: async (_c: string, phone: string) => {
          if (!tableExists) return { error: missingTable };
          pgRows.delete(phone);
          return { error: null };
        },
      }),
    }),
  },
}));

import { setOtp, getOtp, deleteOtp, __resetOtpStoreForTests } from '../utils/otpStore';

const PHONE = '+919100386501';

beforeEach(() => {
  delete process.env.UPSTASH_REDIS_REST_URL;
  delete process.env.UPSTASH_REDIS_REST_TOKEN;
  tableExists = false;
  pgRows.clear();
  __resetOtpStoreForTests();
});

describe('otpStore · no Redis, no otp_codes table (the production break)', () => {
  it('stores without throwing — this is the exact call that used to 500', async () => {
    await expect(setOtp(PHONE, '123456', 'login', 300)).resolves.toBe('memory');
  });

  it('reads the code back, so verify-otp can actually succeed', async () => {
    await setOtp(PHONE, '123456', 'login', 300);
    expect(await getOtp(PHONE)).toEqual({ code: '123456', purpose: 'login' });
  });

  it('deletes without throwing', async () => {
    await setOtp(PHONE, '123456', 'login', 300);
    await deleteOtp(PHONE);
    expect(await getOtp(PHONE)).toBeNull();
  });

  it('returns null for a number that was never issued a code', async () => {
    expect(await getOtp('+919999999999')).toBeNull();
  });

  it('expires a code rather than letting a stale one verify forever', async () => {
    await setOtp(PHONE, '123456', 'login', -1); // already expired
    expect(await getOtp(PHONE)).toBeNull();
  });

  it('a re-request replaces the old code instead of leaving two live', async () => {
    await setOtp(PHONE, '111111', 'login', 300);
    await setOtp(PHONE, '222222', 'login', 300);
    expect(await getOtp(PHONE)).toEqual({ code: '222222', purpose: 'login' });
  });
});

describe('otpStore · once migration 084 has run', () => {
  beforeEach(() => {
    tableExists = true;
    __resetOtpStoreForTests();
  });

  it('prefers Postgres over memory, so a second instance can verify the code', async () => {
    await expect(setOtp(PHONE, '123456', 'login', 300)).resolves.toBe('postgres');
    expect(pgRows.has(PHONE)).toBe(true);
  });

  it('round-trips through Postgres', async () => {
    await setOtp(PHONE, '654321', 'reset', 300);
    expect(await getOtp(PHONE)).toEqual({ code: '654321', purpose: 'reset' });
  });

  it('honours expiry on read even if the sweep has not run', async () => {
    tableExists = true;
    pgRows.set(PHONE, {
      code: '123456',
      purpose: 'login',
      expires_at: new Date(Date.now() - 1000).toISOString(),
    });
    expect(await getOtp(PHONE)).toBeNull();
  });

  it('purpose survives the round trip (reset codes must not log you in)', async () => {
    await setOtp(PHONE, '123456', 'reset', 300);
    expect((await getOtp(PHONE))?.purpose).toBe('reset');
  });
});
