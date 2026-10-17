/**
 * Round 6 · E-016: A joins with B's code (both get the reward), then B uses A's code — both were
 * paid again. A friend who joined with your code can't be your referrer too.
 */
import { mock, res } from './r6Mock';
jest.mock('../utils/supabase', () => require('./r6Mock').supabaseStandIn());
const awardCoins = jest.fn(async () => ({ newBalance: 40 }));
jest.mock('../utils/coins', () => ({ awardCoins: (...a: unknown[]) => (awardCoins as any)(...a) }));
// eslint-disable-next-line import/first
import { applyReferral } from '../controllers/referrals.controller';

const A = '11111111-1111-4111-8111-111111111111';
const B = '22222222-2222-4222-8222-222222222222';
let referrerReferredBy: string | null = null;
beforeEach(() => {
  awardCoins.mockClear();
  mock.next = (q) => {
    if (q[0] === 'from:users' && q.some((c) => c.startsWith('update'))) return { data: [{ id: B }] };
    if (q[0] === 'from:users' && q.some((c) => c.includes('referral_code'))) return { data: { id: A, name: 'A', referred_by: referrerReferredBy } };
    if (q[0] === 'from:users') return { data: { id: B, referred_by: null, created_at: new Date().toISOString() } };
    return { data: [] };
  };
});
const apply = async () => { const r = res(); await applyReferral({ userId: B, body: { code: 'SCAAAA11' } } as any, r); return r; };

test('B can’t use A’s code when A joined with B’s code; no coins move', async () => {
  referrerReferredBy = B;
  const r = await apply();
  expect(r.statusCode).toBe(400);
  expect(r.body.code).toBe('REFERRAL_CIRCULAR');
  expect(awardCoins).not.toHaveBeenCalled();
});
test('a friend who joined with someone else’s code can still refer B', async () => {
  referrerReferredBy = '33333333-3333-4333-8333-333333333333';
  const r = await apply();
  expect(r.statusCode).toBe(200);
  expect(awardCoins).toHaveBeenCalledTimes(2);
});
