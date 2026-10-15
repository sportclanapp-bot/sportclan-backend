/**
 * N-RWG1-4 (launch test plan): "Show date of birth" did nothing you could see.
 * The profile now shows the date when it's on (the app); the server shares a
 * date of birth only when the person switched it on — not when the setting is
 * missing.
 */
import { fakeDb } from './helpers/fakeSupabase';

let db = fakeDb();
jest.mock('../utils/supabase', () => ({ get supabase() { return db.client; } }));
// eslint-disable-next-line import/first
import { getUserById } from '../controllers/users.controller';

const A = '11111111-1111-4111-8111-111111111111';
const V = '22222222-2222-4222-8222-222222222222';
const view = async (showDob: boolean | null) => {
  db = fakeDb({ users: [{ id: A, name: 'QA Device A', dob: '1995-01-01', show_dob: showDob, deleted_at: null }] });
  const r: any = { statusCode: 200 };
  r.status = jest.fn((c: number) => { r.statusCode = c; return r; });
  r.json = jest.fn((b: unknown) => { r.body = b; return r; });
  await getUserById({ userId: V, params: { id: A }, query: {} } as any, r);
  return r.body.user ?? r.body;
};

test('on: the date is shared (for the profile to show)', async () => {
  expect((await view(true)).dob).toBe('1995-01-01');
});
test('off: hidden', async () => {
  expect((await view(false)).dob).toBeNull();
});
test('never set (null): hidden too — only "on" shares it', async () => {
  expect((await view(null)).dob).toBeNull();
});
