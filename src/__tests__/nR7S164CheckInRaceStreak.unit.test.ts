/**
 * N-R7-S164 (SCR-B-085, Step 2 B15): the same account checks in on two phones at
 * once. The request that lost the award read the user row before the winner wrote
 * today's streak, so it answered 'Already checked in today (3-day streak)' while
 * the winner said 4. The loser now answers the streak the winner is writing.
 */
let mockRow: { checkin_streak: number; last_checkin_date: string | null } = { checkin_streak: 3, last_checkin_date: null };
const mockUpdates: unknown[] = [];
let mockAwarded = false;
jest.mock('../utils/supabase', () => {
  const chain: any = {};
  for (const m of ['select', 'eq']) chain[m] = jest.fn(() => chain);
  chain.maybeSingle = jest.fn(async () => ({ data: { ...mockRow }, error: null }));
  chain.update = jest.fn((row: unknown) => { mockUpdates.push(row); return chain; });
  chain.then = (ok: (v: unknown) => unknown) => Promise.resolve(ok({ data: null, error: null }));
  return { supabase: { from: jest.fn(() => chain), rpc: jest.fn() } };
});
jest.mock('../utils/coins', () => ({ awardCoins: jest.fn(async () => ({ awarded: mockAwarded, newBalance: 97 })) }));

// eslint-disable-next-line import/first
import { checkIn } from '../controllers/users.controller';
// eslint-disable-next-line import/first
import { istDay } from '../utils/appTime';

function call() {
  const out: { body?: any; code?: number } = {};
  const res: any = { status: (c: number) => { out.code = c; return res; }, json: (b: unknown) => { out.body = b; return res; } };
  return checkIn({ userId: 'u1' } as any, res).then(() => out);
}
const yesterday = () => istDay(new Date(Date.now() - 86400000));

beforeEach(() => { mockUpdates.length = 0; });

test('the losing request of a same-moment pair answers the new streak (4), not the old row (3)', async () => {
  mockAwarded = false;
  mockRow = { checkin_streak: 3, last_checkin_date: yesterday() }; // the winner hasn't written yet
  const out = await call();
  expect(out.body).toMatchObject({ awarded: false, already_checked_in_today: true, checkin_streak: 4 });
  expect(mockUpdates).toHaveLength(0); // the loser writes nothing
});

test('a lost race after a missed day answers 1', async () => {
  mockAwarded = false;
  mockRow = { checkin_streak: 3, last_checkin_date: '2020-01-01' };
  expect((await call()).body.checkin_streak).toBe(1);
});

test('a plain second check-in later the same day reads the stored streak', async () => {
  mockAwarded = false;
  mockRow = { checkin_streak: 4, last_checkin_date: istDay() };
  expect((await call()).body.checkin_streak).toBe(4);
});

test('the winner still writes yesterday + 1', async () => {
  mockAwarded = true;
  mockRow = { checkin_streak: 3, last_checkin_date: yesterday() };
  const out = await call();
  expect(out.body).toMatchObject({ awarded: true, checkin_streak: 4 });
  expect(mockUpdates).toEqual([{ checkin_streak: 4, last_checkin_date: istDay() }]);
});
