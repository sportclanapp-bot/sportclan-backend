/** N-RWG5-6 (launch test plan): the username cooldown named the next allowed day as a UTC date ("2026-11-02") — a day early in India, and not the app's date style. */
import { fakeDb } from './helpers/fakeSupabase';

let db = fakeDb();
jest.mock('../utils/supabase', () => ({ get supabase() { return db.client; } }));
jest.mock('../utils/otpStore', () => ({ bumpCounter: jest.fn(async () => 1) }));
// eslint-disable-next-line import/first
import { updateMe } from '../controllers/users.controller';

const ME = '11111111-1111-4111-8111-111111111111';

test('a change at 01:00 IST on 4 Oct: next on 3 Nov 2026 (India time, D MMM YYYY)', async () => {
  jest.useFakeTimers().setSystemTime(new Date('2026-10-16T06:00:00Z'));
  // 4 Oct 2026 01:00 IST = 3 Oct 19:30 UTC; +30 days = 3 Nov 01:00 IST (2 Nov in UTC).
  db = fakeDb({ users: [{ id: ME, username: 'olduser', last_username_changed_at: '2026-10-03T19:30:00Z' }] });
  const r: any = { statusCode: 200 };
  r.status = jest.fn((c: number) => { r.statusCode = c; return r; });
  r.json = jest.fn((b: unknown) => { r.body = b; return r; });
  await updateMe({ userId: ME, body: { username: 'newname' } } as any, r);
  jest.useRealTimers();
  expect(r.statusCode).toBe(400);
  expect(r.body.error).toBe('Username can only be changed once every 30 days. Next change available: 3 Nov 2026');
  expect(r.body.error).not.toMatch(/2026-11-02/);
});
