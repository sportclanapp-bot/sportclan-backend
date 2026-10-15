/**
 * N-RWG4-2 (launch test plan) · chats with no message yet came in any order (the only
 * sort key, last_message_at, is empty for all of them), so the time column jumped
 * about (6d above 1d). Chats are ordered by last activity — the newest message, else
 * when the chat started — newest first, ties by id.
 */
import { fakeDb } from './helpers/fakeSupabase';

const mockDb = { client: null as any };
jest.mock('../utils/supabase', () => ({ get supabase() { return mockDb.client; } }));
// eslint-disable-next-line import/first
import { listChats } from '../controllers/messages.controller';

const ME = '00000000-0000-4000-8000-00000000bbbb';
const id = (i: number) => `00000000-0000-4000-8000-${String(i).padStart(12, '0')}`;
const ago = (d: number) => new Date(Date.UTC(2026, 9, 14) - d * 86_400_000).toISOString();
const res = () => {
  const r: any = { statusCode: 200, body: undefined };
  r.status = (c: number) => { r.statusCode = c; return r; };
  r.json = (b: unknown) => { r.body = b; return r; };
  return r;
};

it('the shown time (message, else start) never goes up down the list', async () => {
  // Ages from the bug report: 2.8d, 6.6d, 4.4d, 2.5d, … — and two chats with messages.
  const ages = [2.8, 6.6, 4.4, 2.5, 4.8, 4.8, 4.4, 2.9, 2.5, 4.8, 4.7, 4.0, 4.4];
  const chats = [
    ...ages.map((a, i) => ({ id: id(i), is_group: true, deleted_at: null, created_at: ago(a), last_message_at: null })),
    { id: id(50), is_group: false, deleted_at: null, created_at: ago(30), last_message_at: ago(0.1) },
    { id: id(51), is_group: false, deleted_at: null, created_at: ago(30), last_message_at: ago(3.5) },
  ];
  mockDb.client = fakeDb({
    chats,
    chat_participants: chats.map((c, i) => ({ id: `p${i}`, chat_id: c.id, user_id: ME, left_at: null })),
    messages: [], user_blocks: [],
  }).client;
  const r = res();
  await listChats({ userId: ME, query: { limit: '50' } } as any, r);
  const shown = r.body.chats.map((c: { last_message_at: string | null; created_at: string }) => Date.parse(c.last_message_at ?? c.created_at));
  for (let i = 1; i < shown.length; i++) expect(shown[i]).toBeLessThanOrEqual(shown[i - 1]);
  expect(r.body.chats[0].id).toBe(id(50));
  expect(r.body.chats).toHaveLength(15);
});

it('equal times keep one order (by id)', async () => {
  const chats = [3, 1, 2].map((i) => ({ id: id(i), is_group: true, deleted_at: null, created_at: ago(1), last_message_at: null }));
  mockDb.client = fakeDb({
    chats,
    chat_participants: chats.map((c, i) => ({ id: `p${i}`, chat_id: c.id, user_id: ME, left_at: null })),
    messages: [], user_blocks: [],
  }).client;
  const r = res();
  await listChats({ userId: ME, query: {} } as any, r);
  expect(r.body.chats.map((c: { id: string }) => c.id)).toEqual([id(1), id(2), id(3)]);
});
