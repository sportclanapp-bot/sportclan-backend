/**
 * F040 (launch test plan): Edit profile's Save sent three requests — the
 * profile, then the account types, then the sports — so when the second or third
 * was refused, the first was already saved. PATCH /users/me now takes all three
 * (account_types and sport_ids optional) and checks everything before it writes
 * anything. The separate endpoints stay for older apps.
 */
import { fakeDb } from './helpers/fakeSupabase';

let db = fakeDb();
jest.mock('../utils/supabase', () => ({ get supabase() { return db.client; } }));
jest.mock('../utils/otpStore', () => ({ bumpCounter: jest.fn(async () => 1) }));
// eslint-disable-next-line import/first
import { updateMe, updateMySports, updateAccountTypes } from '../controllers/users.controller';

const ME = '11111111-1111-4111-8111-111111111111';
const call = async (fn: any, body: object) => {
  const r: any = { statusCode: 200, body: null };
  r.status = jest.fn((c: number) => { r.statusCode = c; return r; });
  r.json = jest.fn((b: unknown) => { r.body = b; return r; });
  await fn({ userId: ME, params: {}, query: {}, body } as any, r);
  return r;
};
const seed = () => fakeDb({
  users: [{ id: ME, name: 'Old name', username: 'olduser', account_type: 'player' }],
  user_account_types: [{ user_id: ME, account_type: 'player' }],
  user_sports: [{ user_id: ME, sport_id: 'cricket-id' }],
  sports: [{ id: 'cricket-id', display_order: 1, is_active: true }, { id: 'chess-id', display_order: 7, is_active: true }],
});
const writes = () => db.log.filter((l) => l.op !== 'select');

beforeEach(() => { db = seed(); });

test('one request saves the name, account types and sports together', async () => {
  const r = await call(updateMe, { name: 'New name', account_types: ['umpire', 'player'], sport_ids: ['chess-id', 'cricket-id'] });
  expect(r.statusCode).toBe(200);
  expect(db.tables.users[0]).toMatchObject({ name: 'New name', account_type: 'player' });
  expect(db.tables.user_account_types.map((t: any) => t.account_type)).toEqual(['player', 'umpire']);
  expect(db.tables.user_sports.map((t: any) => t.sport_id).sort()).toEqual(['chess-id', 'cricket-id']);
  expect(r.body.sport_ids).toEqual(['cricket-id', 'chess-id']); // display order
  expect(r.body.account_types).toEqual(['player', 'umpire']);
});

test('a bad sport refuses the whole save — the new name is not kept', async () => {
  const r = await call(updateMe, { name: 'New name', account_types: ['umpire'], sport_ids: ['kabaddi'] });
  expect(r.statusCode).toBe(400);
  expect(r.body.code).toBe('INVALID_SPORT');
  expect(writes()).toEqual([]);
  expect(db.tables.users[0].name).toBe('Old name');
});

test('a bad account type refuses the whole save', async () => {
  const r = await call(updateMe, { name: 'New name', account_types: ['wizard'], sport_ids: ['chess-id'] });
  expect(r.statusCode).toBe(400);
  expect(writes()).toEqual([]);
});

test('a refused profile field (a long name) leaves the sports and types alone', async () => {
  const r = await call(updateMe, { name: 'x'.repeat(61), account_types: ['umpire'], sport_ids: ['chess-id'] });
  expect(r.statusCode).toBe(400);
  expect(writes()).toEqual([]);
  expect(db.tables.user_sports.map((t: any) => t.sport_id)).toEqual(['cricket-id']);
});

test('sports alone is a save (no "No updatable fields")', async () => {
  const r = await call(updateMe, { sport_ids: ['chess-id'] });
  expect(r.statusCode).toBe(200);
  expect(db.tables.user_sports.map((t: any) => t.sport_id)).toEqual(['chess-id']);
});

test('older apps: the separate endpoints still work as before', async () => {
  const s = await call(updateMySports, { sport_ids: ['chess-id'] });
  expect(s.body).toEqual({ sport_ids: ['chess-id'] });
  const bad = await call(updateMySports, { sport_ids: ['kabaddi'] });
  expect([bad.statusCode, bad.body.code]).toEqual([400, 'INVALID_SPORT']);
  const t = await call(updateAccountTypes, { account_types: ['coach', 'player'] });
  expect(t.body.user.account_types).toEqual(['player', 'coach']);
  expect((await call(updateAccountTypes, { account_types: [] })).statusCode).toBe(400);
  expect((await call(updateMe, {})).statusCode).toBe(400);
});
