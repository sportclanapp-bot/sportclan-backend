/**
 * Q16 (Dipak, 21 Nov 2026): Edit profile needs at least one sport, the same
 * rule as sign-up. The server refuses an empty sports list on both routes
 * (PATCH /users/me and the older PATCH /users/me/sports) and writes nothing.
 */
import { fakeDb } from './helpers/fakeSupabase';

let db = fakeDb();
jest.mock('../utils/supabase', () => ({ get supabase() { return db.client; } }));
jest.mock('../utils/otpStore', () => ({ bumpCounter: jest.fn(async () => 1) }));
// eslint-disable-next-line import/first
import { updateMe, updateMySports } from '../controllers/users.controller';

const ME = '11111111-1111-4111-8111-111111111111';
const call = async (fn: any, body: object) => {
  const r: any = { statusCode: 200, body: null };
  r.status = jest.fn((c: number) => { r.statusCode = c; return r; });
  r.json = jest.fn((b: unknown) => { r.body = b; return r; });
  await fn({ userId: ME, params: {}, query: {}, body } as any, r);
  return r;
};
beforeEach(() => {
  db = fakeDb({
    users: [{ id: ME, name: 'Old name', username: 'olduser', account_type: 'player' }],
    user_account_types: [{ user_id: ME, account_type: 'player' }],
    user_sports: [{ user_id: ME, sport_id: 'cricket-id' }],
    sports: [{ id: 'cricket-id', display_order: 1, is_active: true }],
  });
});
const writes = () => db.log.filter((l) => l.op !== 'select');

test('PATCH /users/me with no sports is refused and nothing is saved', async () => {
  const r = await call(updateMe, { name: 'New name', sport_ids: [] });
  expect([r.statusCode, r.body.code]).toEqual([400, 'SPORT_REQUIRED']);
  expect(r.body.error).toBe('Pick at least one sport you play.');
  expect(writes()).toEqual([]);
  expect(db.tables.user_sports.map((t: any) => t.sport_id)).toEqual(['cricket-id']);
});

test('PATCH /users/me/sports with no sports is refused too', async () => {
  const r = await call(updateMySports, { sport_ids: [] });
  expect([r.statusCode, r.body.code]).toEqual([400, 'SPORT_REQUIRED']);
  expect(writes()).toEqual([]);
});

test('one sport is fine', async () => {
  const r = await call(updateMe, { sport_ids: ['cricket-id'] });
  expect(r.statusCode).toBe(200);
});
