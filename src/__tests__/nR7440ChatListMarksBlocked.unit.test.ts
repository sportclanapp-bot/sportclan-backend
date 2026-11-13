/** N-R7-440 (SIDE-C11-2): the chat list marks a DM peer who is blocked either way, so New group never suggests them. */
import { fakeDb } from './helpers/fakeSupabase';

const mockDb = { client: null as any };
jest.mock('../utils/supabase', () => ({ get supabase() { return mockDb.client; } }));
// eslint-disable-next-line import/first
import { listChats } from '../controllers/messages.controller';

const ME = 'me';
const res = () => {
  const r: any = { statusCode: 200, body: undefined };
  r.status = (c: number) => { r.statusCode = c; return r; };
  r.json = (b: unknown) => { r.body = b; return r; };
  return r;
};

it('a peer who blocked me, or whom I blocked, is marked blocked; others are not', async () => {
  const chats = ['c1', 'c2', 'c3'].map((id, i) => ({ id, is_group: false, deleted_at: null, created_at: `2026-11-1${i}T00:00:00Z`, last_message_at: null }));
  const peers: Record<string, string> = { c1: 'blocksMe', c2: 'iBlocked', c3: 'friend' };
  mockDb.client = fakeDb({
    chats,
    chat_participants: chats.flatMap((c) => [
      { id: `${c.id}a`, chat_id: c.id, user_id: ME, left_at: null },
      { id: `${c.id}b`, chat_id: c.id, user_id: peers[c.id], left_at: null },
    ]),
    messages: [],
    user_blocks: [{ blocker_id: 'blocksMe', blocked_id: ME }, { blocker_id: ME, blocked_id: 'iBlocked' }],
  }).client;
  const r = res();
  await listChats({ userId: ME, query: { limit: '50' } } as any, r);
  const flag = (id: string) => r.body.chats.flatMap((c: any) => c.participants).find((p: any) => p.user_id === id)?.blocked === true;
  expect(r.body.chats).toHaveLength(3);
  expect(flag('blocksMe')).toBe(true);
  expect(flag('iBlocked')).toBe(true);
  expect(flag('friend')).toBe(false);
  expect(flag(ME)).toBe(false);
});
