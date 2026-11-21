/**
 * Q18 (Dipak, 21 Nov 2026, chose B) · a phone number claims invite coins once, ever — even after
 * the account is deleted and the number is freed 30 days later for a brand-new account. Before:
 * the new account on the same number used a friend's code again (20 more coins each).
 */
import crypto from 'crypto';

type Q = string[];
const mockClaims = new Set<string>();
let mockMissingTable = false;
const mockUsers: Record<string, any> = {};
jest.mock('../utils/supabase', () => {
  const start = (t: string) => {
    const q: Q = [t];
    const chain: any = {};
    for (const m of ['select', 'eq', 'is', 'limit', 'maybeSingle', 'update']) chain[m] = jest.fn((...a: unknown[]) => { q.push(`${m}:${JSON.stringify(a)}`); return chain; });
    chain.insert = jest.fn((row: any) => { q.push('insert'); (chain as any).row = row; return chain; });
    chain.then = (ok: (v: unknown) => unknown) => {
      if (t === 'referral_phone_claims') {
        if (mockMissingTable) return Promise.resolve(ok({ data: null, error: { code: 'PGRST205', message: 'no table' } }));
        const h = (chain as any).row.phone_hash;
        if (mockClaims.has(h)) return Promise.resolve(ok({ data: null, error: { code: '23505', message: 'duplicate' } }));
        mockClaims.add(h); return Promise.resolve(ok({ data: null, error: null }));
      }
      if (t === 'users') {
        const eq = q.filter((x) => x.startsWith('eq:')).map((x) => JSON.parse(x.slice(3)));
        const code = eq.find((e) => e[0] === 'referral_code');
        if (code) return Promise.resolve(ok({ data: Object.values(mockUsers).find((u) => u.referral_code === code[1]) ?? null, error: null }));
        const id = eq.find((e) => e[0] === 'id')![1];
        if (q.some((x) => x.startsWith('update:'))) {
          const u = mockUsers[id];
          if (u.referred_by) return Promise.resolve(ok({ data: [], error: null }));
          u.referred_by = JSON.parse(q.find((x) => x.startsWith('update:'))!.slice(7))[0].referred_by;
          return Promise.resolve(ok({ data: [{ id }], error: null }));
        }
        return Promise.resolve(ok({ data: mockUsers[id] ?? null, error: null }));
      }
      return Promise.resolve(ok({ data: null, error: null }));
    };
    return chain;
  };
  return { supabase: { from: jest.fn((t: string) => start(t)) } };
});
const mockAwards: string[] = [];
jest.mock('../utils/coins', () => ({ awardCoins: jest.fn(async (u: string, k: string) => { mockAwards.push(`${u}:${k}`); return { newBalance: 20 }; }) }));

// eslint-disable-next-line import/first
import { applyReferral, referralPhoneHash } from '../controllers/referrals.controller';

const now = new Date().toISOString();
const apply = async (userId: string, code: string) => {
  const r: any = { statusCode: 200, body: null };
  r.status = jest.fn((c: number) => { r.statusCode = c; return r; });
  r.json = jest.fn((b: unknown) => { r.body = b; return r; });
  await applyReferral({ userId, body: { code } } as any, r);
  return r;
};
beforeEach(() => {
  mockClaims.clear(); mockAwards.length = 0; mockMissingTable = false;
  for (const k of Object.keys(mockUsers)) delete mockUsers[k];
  Object.assign(mockUsers, {
    friend: { id: 'friend', name: 'Friend', referral_code: 'SCFRND01', referred_by: null, created_at: now, phone: '+919000000101' },
    friend2: { id: 'friend2', name: 'Friend 2', referral_code: 'SCFRND02', referred_by: null, created_at: now, phone: '+919000000102' },
    old: { id: 'old', referred_by: null, created_at: now, phone: '+919000000200' },
  });
});

it('the hash is the migration’s: sha256 of sportclan-referral:+91…, hex', () => {
  expect(referralPhoneHash('+919000000200')).toBe(crypto.createHash('sha256').update('sportclan-referral:+919000000200').digest('hex'));
  expect(referralPhoneHash('+919000000200')).not.toContain('9000000200');
});

it('a number used once; deleted; a brand-new account on the same number is refused, no coins', async () => {
  expect((await apply('old', 'SCFRND01')).statusCode).toBe(200);
  expect(mockAwards).toEqual(['old:referral_applied_friend', 'friend:referral_reward_old']);
  // the old account is deleted (its referred_by is scrubbed); 30 days on the number signs up again
  mockUsers.old.referred_by = null; mockUsers.old.phone = 'deleted:old';
  mockUsers.fresh = { id: 'fresh', referred_by: null, created_at: now, phone: '+919000000200' };
  const r = await apply('fresh', 'SCFRND02');
  expect([r.statusCode, r.body]).toEqual([403, {
    error: 'This phone number has already used an invite code, so it can’t get the invite coins again.',
    code: 'REFERRAL_PHONE_USED',
  }]);
  expect(mockAwards).toHaveLength(2);
  expect(mockUsers.fresh.referred_by).toBeNull();
});

it('another number is unaffected', async () => {
  mockClaims.add(referralPhoneHash('+919000000200'));
  mockUsers.other = { id: 'other', referred_by: null, created_at: now, phone: '+919000000300' };
  expect((await apply('other', 'SCFRND01')).statusCode).toBe(200);
});

it('an email sign-up’s placeholder number is not tracked (the once-per-account rule still holds)', async () => {
  mockUsers.mail = { id: 'mail', referred_by: null, created_at: now, phone: '+0mail-123' };
  expect((await apply('mail', 'SCFRND01')).statusCode).toBe(200);
  expect(mockClaims.size).toBe(0);
  expect((await apply('mail', 'SCFRND02')).body.error).toBe('Referral already applied');
});

it('before migration 165 runs (no table) the code still works as before', async () => {
  mockMissingTable = true;
  const err = jest.spyOn(console, 'error').mockImplementation(() => undefined);
  expect((await apply('old', 'SCFRND01')).statusCode).toBe(200);
  err.mockRestore();
});
