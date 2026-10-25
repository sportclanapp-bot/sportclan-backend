/**
 * N-R7-S42 (Step 2 Batch 14, SCR-B-S08 / RW-G4-185) · a deleted account's referral code is not a
 * code any more: applying it answers 404 'Invalid referral code' and no coins move. Before: the
 * lookup ignored deleted_at, so a new user and the deleted account were each paid 20 coins.
 */
import { mock, res } from './r6Mock';
jest.mock('../utils/supabase', () => require('./r6Mock').supabaseStandIn());
const awardCoins = jest.fn(async () => ({ newBalance: 80 }));
jest.mock('../utils/coins', () => ({ awardCoins: (...a: unknown[]) => (awardCoins as any)(...a) }));
// eslint-disable-next-line import/first
import { applyReferral } from '../controllers/referrals.controller';

const DEAD = '11111111-1111-4111-8111-111111111111';
const NEW = '22222222-2222-4222-8222-222222222222';
let lookups: string[][] = [];
beforeEach(() => {
  awardCoins.mockClear(); lookups = [];
  mock.next = (q) => {
    if (q[0] === 'from:users' && q.some((c) => c.startsWith('update'))) return { data: [{ id: NEW }] };
    if (q[0] === 'from:users' && q.some((c) => c.includes('referral_code'))) {
      lookups.push(q);
      // the referrer row exists but is deleted: a query that asks for live accounts finds nothing
      return q.some((c) => c.includes('deleted_at')) ? { data: null } : { data: { id: DEAD, name: 'Deleted User', referred_by: null } };
    }
    if (q[0] === 'from:users') return { data: { id: NEW, referred_by: null, created_at: new Date().toISOString() } };
    return { data: [] };
  };
});

test('a deleted account’s code: 404 Invalid referral code, no coins', async () => {
  const r = res(); await applyReferral({ userId: NEW, body: { code: 'scdead11' } } as any, r);
  expect(r.statusCode).toBe(404);
  expect(r.body).toEqual({ error: 'Invalid referral code' });
  expect(awardCoins).not.toHaveBeenCalled();
});
