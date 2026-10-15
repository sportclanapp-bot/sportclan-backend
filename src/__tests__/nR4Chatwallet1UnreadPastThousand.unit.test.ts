/**
 * N-R4-chatwallet-1 (found while fixing N-RWG4-1) · the unread badge read a person's
 * chats in one request, which PostgREST stops at 1000 rows — unread messages in the
 * chats past it were never counted. The chats are read 1000 at a time now.
 */
import { fakeDb } from './helpers/fakeSupabase';

const mockDb = { client: null as any };
jest.mock('../utils/supabase', () => ({ get supabase() { return mockDb.client; } }));
// eslint-disable-next-line import/first
import { getUnreadCount } from '../controllers/messages.controller';

const ME = '00000000-0000-4000-8000-00000000cccc';
const OTHER = '00000000-0000-4000-8000-00000000dddd';
const chatId = (i: number) => `00000000-0000-4000-8000-${String(i).padStart(12, '0')}`;

it('an unread message in the 1,050th chat is counted', async () => {
  const N = 1100;
  const chat_participants = Array.from({ length: N }, (_, i) => ({
    id: `p${String(i).padStart(5, '0')}`, chat_id: chatId(i), user_id: ME, left_at: null, chat: { deleted_at: null },
  }));
  const messages = [{ id: 'm1', chat_id: chatId(1050), sender_id: OTHER, is_deleted: false, is_system: false, read_by: [], created_at: '2026-10-14T00:00:00Z' }];
  mockDb.client = fakeDb({ chat_participants, messages, users: [{ id: OTHER, deleted_at: null }], user_blocks: [] }, { maxRows: 1000 }).client;
  const r: any = { statusCode: 200 };
  r.status = (c: number) => { r.statusCode = c; return r; };
  r.json = (b: unknown) => { r.body = b; return r; };
  await getUnreadCount({ userId: ME } as any, r);
  expect(r.statusCode).toBe(200);
  expect(r.body).toMatchObject({ unread: 1, chats: 1 });
});
