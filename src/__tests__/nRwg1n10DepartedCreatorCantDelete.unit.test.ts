/**
 * N-RWG1-10 (launch test plan) · a creator who had left the group (or was removed)
 * could still DELETE it for everyone — deleteGroup checked only chats.created_by.
 * Now only a current member who created it may.
 */
import { fakeDb } from './helpers/fakeSupabase';

const mockDb = { client: null as any };
jest.mock('../utils/supabase', () => ({ get supabase() { return mockDb.client; } }));
// eslint-disable-next-line import/first
import { deleteGroup } from '../controllers/messages.controller';

const G = '00000000-0000-4000-8000-0000000000a1';
const member = (user_id: string, left_at: string | null = null) => ({ id: `p-${user_id}`, chat_id: G, user_id, left_at, chat: { deleted_at: null } });
const res = () => {
  const r: any = { statusCode: 200, body: undefined };
  r.status = (c: number) => { r.statusCode = c; return r; };
  r.json = (b: unknown) => { r.body = b; return r; };
  return r;
};
const seed = (creatorLeft: boolean) => {
  const db = fakeDb({
    chats: [{ id: G, is_group: true, created_by: 'a', deleted_at: null }],
    chat_participants: [member('a', creatorLeft ? '2026-10-14T00:00:00Z' : null), member('b'), member('c')],
  });
  mockDb.client = db.client;
  return db;
};

it('a creator who left gets 403 and the group stays', async () => {
  const db = seed(true);
  const r = res();
  await deleteGroup({ userId: 'a', params: { id: G } } as any, r);
  expect(r.statusCode).toBe(403);
  expect(r.body).toEqual({ error: 'You’re no longer in this group, so you can’t delete it.', code: 'NOT_A_MEMBER' });
  const { data } = await db.client.from('chats').select('*').eq('id', G).single();
  expect(data.deleted_at).toBeNull();
});

it('control: a creator still in the group deletes it (soft)', async () => {
  const db = seed(false);
  const r = res();
  await deleteGroup({ userId: 'a', params: { id: G } } as any, r);
  expect(r.statusCode).toBe(200);
  const { data } = await db.client.from('chats').select('*').eq('id', G).single();
  expect(data.deleted_at).not.toBeNull();
});

it('control: a member who is not the creator still cannot', async () => {
  seed(false);
  const r = res();
  await deleteGroup({ userId: 'b', params: { id: G } } as any, r);
  expect(r.statusCode).toBe(403);
  expect(r.body.error).toBe('Only the creator can delete the group');
});
