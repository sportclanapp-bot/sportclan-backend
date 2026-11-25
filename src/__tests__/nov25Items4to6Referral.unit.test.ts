/**
 * Fix list 25 Nov 2026, items 4–6 · GET /referrals/stats:
 *  4 a failed read of the person's own row is an error (the app's Retry), not an empty code;
 *  5 a friend whose account was purged (referred_by cleared) still counts, with no details of theirs;
 *  6 "Coins earned" includes the coins for using a friend's code.
 */
import { fakeDb } from './helpers/fakeSupabase';

let db = fakeDb();
let mockFail: ((table: string, n: number) => boolean) | null = null;
let mockReads: Record<string, number> = {};
jest.mock('../utils/supabase', () => ({
  get supabase() {
    return { ...db.client, from: (t: string) => {
      mockReads[t] = (mockReads[t] ?? 0) + 1;
      if (mockFail?.(t, mockReads[t])) {
        const c: any = new Proxy({}, { get: (_o, k) => (k === 'then' ? (ok: (v: unknown) => unknown) => Promise.resolve(ok({ data: null, count: null, error: { message: 'down' } })) : () => c) });
        return c;
      }
      return db.client.from(t);
    } };
  },
}));
// eslint-disable-next-line import/first
import { getStats } from '../controllers/referrals.controller';
// eslint-disable-next-line import/first
import { tombstoneFields } from '../controllers/account.controller';

const ME = 'me-1';
const stats = async (userId: string | null = ME) => {
  const r: any = { statusCode: 200, body: null };
  r.status = (c: number) => { r.statusCode = c; return r; };
  r.json = (b: unknown) => { r.body = b; return r; };
  await getStats({ userId, headers: {}, query: {} } as any, r);
  return r;
};
const ev = (user_id: string, event_type: string, coins = 20) => ({ user_id, event_type, coins });
beforeEach(() => {
  mockFail = null; mockReads = {};
  db = fakeDb({
    users: [
      { id: ME, referral_code: 'SCME', referred_by: 'f0', created_at: '2026-11-01T00:00:00Z' },
      { id: 'f1', referred_by: ME, name: 'Friend One' },
      { id: 'f2', referred_by: ME, name: 'Friend Two' },
      { id: 'x', referred_by: 'other' },
    ],
    coin_events: [
      ev(ME, 'referral_reward_f1'), ev(ME, 'referral_reward_f2'), ev(ME, 'referral_applied_f0'),
      ev(ME, 'daily_checkin_2026-11-02', 5), ev(ME, 'referralXrewardXf9', 99), ev('other', 'referral_reward_x'),
    ],
  });
});

describe('item 4 · failures are failures', () => {
  it.each([['my own row', (t: string, n: number) => t === 'users' && n === 1], ['the friends', (t: string, n: number) => t === 'users' && n === 2],
    ['the rewards', (t: string, n: number) => t === 'coin_events' && n === 1], ['the used-a-code coins', (t: string, n: number) => t === 'coin_events' && n === 2]])('%s unreadable → 500', async (_w, f) => {
    mockFail = f;
    const r = await stats();
    expect(r.statusCode).toBe(500);
    expect(r.body).toEqual({ error: 'Could not load referral stats' });
  });
  it('no such user → 404, signed out → 401', async () => {
    expect((await stats('nobody')).statusCode).toBe(404);
    expect((await stats(null)).statusCode).toBe(401);
  });
});

describe('item 5 · a deleted friend still counts', () => {
  it('after the 30-day purge clears referred_by: same count, same coins, nothing of theirs in the reply', async () => {
    const before = (await stats()).body;
    expect(before.referralCount).toBe(2);
    Object.assign(db.t('users').find((u) => u.id === 'f1')!, tombstoneFields('f1', '2026-11-25T00:00:00Z'));
    expect(db.t('users').find((u) => u.id === 'f1')!.referred_by).toBeNull(); // the real purge
    const after = (await stats()).body;
    expect(after).toEqual(before);
    expect(Object.keys(after).sort()).toEqual(['alreadyApplied', 'applyUntil', 'referralCode', 'referralCount', 'totalCoinsEarned']);
    expect(JSON.stringify(after)).not.toMatch(/f1|Friend|Deleted/);
  });
  it('a friend with a link but no reward event (a lost award) still counts; nobody counts twice', async () => {
    db.t('users').push({ id: 'f3', referred_by: ME });
    expect((await stats()).body.referralCount).toBe(3);
  });
  it('nobody referred: 0', async () => {
    db = fakeDb({ users: [{ id: ME, referral_code: 'SCME', referred_by: null, created_at: null }], coin_events: [] });
    expect((await stats()).body).toEqual({ referralCode: 'SCME', referralCount: 0, totalCoinsEarned: 0, alreadyApplied: false, applyUntil: null });
  });
});

it('item 6 · coins: every friend reward plus the coins for using a code; nothing else', async () => {
  expect((await stats()).body.totalCoinsEarned).toBe(60); // 2 friends + my own 20; not the check-in, not a look-alike key
});

it('pages past 1000 rows', async () => {
  db = fakeDb({
    users: [{ id: ME, referral_code: 'SCME', referred_by: null, created_at: '2026-11-01T00:00:00Z' }],
    coin_events: Array.from({ length: 1503 }, (_, i) => ev(ME, `referral_reward_f${String(i).padStart(5, '0')}`)),
  }, { maxRows: 1000 });
  expect((await stats()).body).toMatchObject({ referralCount: 1503, totalCoinsEarned: 1503 * 20 });
});
