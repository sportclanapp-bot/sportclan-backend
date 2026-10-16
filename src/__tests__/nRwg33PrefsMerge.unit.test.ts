/**
 * N-RWG3-3 (launch test plan): a notification switch flipped on one phone undid a
 * team or chat mute made on another — each save sent the phone's whole (old)
 * copy of the settings and the server stored it as the new whole. The server
 * now merges: only the keys sent change, and a mute list changes by item
 * (`{ add, remove }`). A whole list, as 2.17.0 sends, still replaces that list.
 */
import { fakeDb } from './helpers/fakeSupabase';

const mockDb = { client: null as any };
jest.mock('../utils/supabase', () => ({ get supabase() { return mockDb.client; } }));
// eslint-disable-next-line import/first
import { updateMe, mergeNotificationPrefs, MUTED_MAX } from '../controllers/users.controller';

const id = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
const T1 = id(1); const T2 = id(2); const C1 = id(11); const C2 = id(12);
const res = () => {
  const r: any = { statusCode: 200, body: null };
  r.status = (c: number) => { r.statusCode = c; return r; };
  r.json = (b: unknown) => { r.body = b; return r; };
  return r;
};
let db: ReturnType<typeof fakeDb>;
const stored = () => db.t('users')[0]!.notification_preferences;
const save = async (prefs: unknown) => {
  const r = res();
  await updateMe({ userId: 'me', body: { notification_preferences: prefs } } as any, r);
  return r;
};
beforeEach(() => {
  db = fakeDb({ users: [{ id: 'me', name: 'Me', notification_preferences: { match: true, chat: true, muted_teams: [T1], muted_chats: [C1] } }] });
  mockDb.client = db.client;
});

test('phone B mutes a team; phone A then flips a switch from its old copy — the mute stays', async () => {
  expect((await save({ muted_teams: { add: [T2] } })).statusCode).toBe(200); // phone B
  expect((await save({ chat: false })).statusCode).toBe(200); // phone A, only what changed
  expect(stored()).toEqual({ match: true, chat: false, muted_teams: [T1, T2], muted_chats: [C1] });
});

test('a mute list changes by item: add, remove, both; adding twice keeps one', async () => {
  await save({ muted_chats: { add: [C2] } });
  await save({ muted_chats: { add: [C2] } });
  expect(stored().muted_chats).toEqual([C1, C2]);
  await save({ muted_chats: { remove: [C1] }, muted_teams: { remove: [T1], add: [T2] } });
  expect(stored()).toMatchObject({ muted_chats: [C2], muted_teams: [T2], match: true, chat: true });
});

test('2.17.0 sends the whole object: it is stored as sent (the old behaviour)', async () => {
  const r = await save({ match: false, chat: true, muted_teams: [T2], muted_chats: [] });
  expect(r.statusCode).toBe(200);
  expect(stored()).toEqual({ match: false, chat: true, muted_teams: [T2], muted_chats: [] });
  expect(r.body.user.notification_preferences).toEqual(stored());
});

test('refusals: a bad change, and a list that would pass the limit', async () => {
  expect((await save({ muted_teams: { add: ['x'] } })).body.code).toBe('INVALID_NOTIFICATION_PREFS');
  expect((await save({ muted_teams: { put: [T2] } })).body.code).toBe('INVALID_NOTIFICATION_PREFS');
  expect((await save({ chat: 'off' })).body.code).toBe('INVALID_NOTIFICATION_PREFS');
  db.t('users')[0]!.notification_preferences.muted_teams = Array.from({ length: MUTED_MAX }, (_, i) => id(100 + i));
  const full = await save({ muted_teams: { add: [T2] } });
  expect([full.statusCode, full.body.code]).toEqual([400, 'MUTE_LIMIT']);
  expect(stored().muted_teams).toHaveLength(MUTED_MAX); // nothing written
  expect((await save({ match: false })).statusCode).toBe(200); // a switch still saves beside a full list
});

test('the merge on its own: nothing stored yet', () => {
  expect(mergeNotificationPrefs(null, { chat: false, muted_teams: { add: [T1] } })).toEqual({ chat: false, muted_teams: [T1] });
});
