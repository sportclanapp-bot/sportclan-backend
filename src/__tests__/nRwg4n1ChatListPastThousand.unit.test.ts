/**
 * N-RWG4-1 (launch test plan) · someone in more than 1,000 chats never saw the rest:
 * the list read the person's chats in one request, and PostgREST answers at most 1000
 * rows — QA Device A's one chat with a message was on no page. The chats are read
 * 1000 at a time, ordered by last activity, and paged by offset or by a cursor.
 */
import { fakeDb } from './helpers/fakeSupabase';

const mockDb = { client: null as any };
jest.mock('../utils/supabase', () => ({ get supabase() { return mockDb.client; } }));
// eslint-disable-next-line import/first
import { listChats } from '../controllers/messages.controller';

const ME = '00000000-0000-4000-8000-00000000aaaa';
const N = 1100;
const chatId = (i: number) => `00000000-0000-4000-8000-${String(i).padStart(12, '0')}`;
const day = (d: number) => new Date(Date.UTC(2026, 9, 1 + d)).toISOString();
const res = () => {
  const r: any = { statusCode: 200, body: undefined };
  r.status = (c: number) => { r.statusCode = c; return r; };
  r.json = (b: unknown) => { r.body = b; return r; };
  return r;
};
const MESSAGED = chatId(1050); // past the first 1000 participation rows

beforeAll(() => {
  const chats = Array.from({ length: N }, (_, i) => ({
    id: chatId(i), is_group: true, name: `c${i}`, deleted_at: null,
    created_at: day(i % 10), last_message_at: chatId(i) === MESSAGED ? day(12) : null,
  }));
  const chat_participants = chats.map((c, i) => ({ id: `p${String(i).padStart(5, '0')}`, chat_id: c.id, user_id: ME, left_at: null, role: 'member' }));
  mockDb.client = fakeDb({ chats, chat_participants, messages: [], user_blocks: [] }, { maxRows: 1000 }).client;
});

const list = async (query: Record<string, string>) => {
  const r = res();
  await listChats({ userId: ME, query } as any, r);
  expect(r.statusCode).toBe(200);
  return r.body;
};

it('counts every chat, and the newest activity comes first — even past the 1000th', async () => {
  const b = await list({ limit: '50', offset: '0' });
  expect(b.total).toBe(N);
  expect(b.has_more).toBe(true);
  expect(b.chats[0].id).toBe(MESSAGED);
});

it('load more by cursor reaches every chat, each once', async () => {
  const seen: string[] = [];
  let before: string | undefined;
  for (let guard = 0; guard < 20; guard++) {
    const b = await list({ limit: '100', ...(before ? { before } : {}) });
    seen.push(...b.chats.map((c: { id: string }) => c.id));
    if (!b.has_more) { expect(b.next_cursor).toBeNull(); break; }
    before = b.next_cursor;
  }
  expect(seen).toHaveLength(N);
  expect(new Set(seen).size).toBe(N);
});

it('the offset pages (the 2.17 app) reach every chat too', async () => {
  const seen = new Set<string>();
  for (let off = 0; off < N; off += 100) {
    const b = await list({ limit: '100', offset: String(off) });
    b.chats.forEach((c: { id: string }) => seen.add(c.id));
  }
  expect(seen.size).toBe(N);
});

it('a bad cursor is a 400', async () => {
  const r = res();
  await listChats({ userId: ME, query: { before: 'nope' } } as any, r);
  expect(r.statusCode).toBe(400);
  expect(r.body.code).toBe('INVALID_CURSOR');
});
