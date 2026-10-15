/**
 * N-RWG1-5 (launch test plan) · when someone sets "Who can message you" to Followers,
 * a stranger was told "Only people they follow can message this user" — the reverse of
 * the rule the server applies (the people who follow them may write).
 */
import fs from 'fs';
import path from 'path';
import { fakeDb } from './helpers/fakeSupabase';

const mockDb = { client: null as any };
jest.mock('../utils/supabase', () => ({ get supabase() { return mockDb.client; } }));
// eslint-disable-next-line import/first
import { getOrCreateDM } from '../controllers/messages.controller';

const ME = '00000000-0000-4000-8000-0000000000b1';
const PRIYA = '00000000-0000-4000-8000-0000000000b2';
const WORDS = 'Only people who follow this user can message them.';
const res = () => {
  const r: any = { statusCode: 200, body: undefined };
  r.status = (c: number) => { r.statusCode = c; return r; };
  r.json = (b: unknown) => { r.body = b; return r; };
  return r;
};
const seed = (follows: Array<{ follower_id: string; following_id: string }>) => {
  mockDb.client = fakeDb({
    users: [{ id: ME, deleted_at: null, message_privacy: 'everyone' }, { id: PRIYA, deleted_at: null, message_privacy: 'followers' }],
    follow_relationships: follows,
    chat_participants: [], chats: [], user_blocks: [],
  }).client;
};

it('a stranger is told the real rule', async () => {
  seed([]);
  const r = res();
  await getOrCreateDM({ userId: ME, body: { user_id: PRIYA } } as any, r);
  expect(r.statusCode).toBe(403);
  expect(r.body.error).toBe(WORDS);
});

it('Priya following me does not let me write (it is about who follows her)', async () => {
  seed([{ follower_id: PRIYA, following_id: ME }]);
  const r = res();
  await getOrCreateDM({ userId: ME, body: { user_id: PRIYA } } as any, r);
  expect(r.statusCode).toBe(403);
  expect(r.body.error).toBe(WORDS);
});

it('control: a follower of hers may start the chat', async () => {
  seed([{ follower_id: ME, following_id: PRIYA }]);
  const r = res();
  await getOrCreateDM({ userId: ME, body: { user_id: PRIYA } } as any, r);
  expect(r.statusCode).not.toBe(403);
});

it('the reversed words are gone from the send gate too', () => {
  const src = fs.readFileSync(path.join(__dirname, '..', 'controllers/messages.controller.ts'), 'utf8');
  expect(src).not.toMatch(/Only people they follow can message/);
});
