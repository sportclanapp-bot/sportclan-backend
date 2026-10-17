/**
 * Round 6 · E-133: sending into a DM whose owner set "Who can message you" to No one (or Followers,
 * when you don't follow them) is refused — but forwarding a message into the same DM went through,
 * because forward checked blocks only.
 */
import { mock, res } from './r6Mock';
jest.mock('../utils/supabase', () => require('./r6Mock').supabaseStandIn());
jest.mock('../utils/chatMembership', () => ({ isActiveMember: jest.fn(async () => true), leaveChat: jest.fn(), joinChat: jest.fn(), softDeleteChat: jest.fn() }));
jest.mock('../utils/chatPush', () => ({ pushChatMessage: jest.fn() }));
// eslint-disable-next-line import/first
import { forwardMessage } from '../controllers/messages.controller';

const ME = '11111111-1111-4111-8111-111111111111';
const THEM = '22222222-2222-4222-8222-222222222222';
const SRC = '55555555-5555-4555-8555-555555555555';
const DM = '66666666-6666-4666-8666-666666666666';
const MSG = '77777777-7777-4777-8777-777777777777';
let privacy = 'everyone';
let follows = false;
const inserted = () => mock.log.filter((q) => q[0] === 'from:messages' && q.some((c) => c.startsWith('insert')));
beforeEach(() => {
  mock.log = [];
  mock.next = (q) => {
    if (q[0] === 'from:messages') return { data: { content: 'hi', image_url: null, chat_id: SRC, is_deleted: false, is_system: false } };
    if (q[0] === 'from:chats') return { data: { is_group: false } };
    if (q[0] === 'from:chat_participants') return { data: [{ user_id: THEM }] };
    if (q[0] === 'from:user_blocks') return { data: null };
    if (q[0] === 'from:users') return { data: { message_privacy: privacy } };
    if (q[0] === 'from:follow_relationships') return { data: follows ? { id: 'f' } : null };
    return { data: [] };
  };
});
const forward = async () => { const r = res(); await forwardMessage({ userId: ME, body: { message_id: MSG, chat_ids: [DM] } } as any, r); return r; };

test('into a DM set to "No one": refused, nothing sent', async () => {
  privacy = 'nobody'; follows = false;
  const r = await forward();
  expect(r.statusCode).toBe(403);
  expect(inserted()).toHaveLength(0);
});
test('into a followers-only DM you don’t follow: refused, nothing sent', async () => {
  privacy = 'followers'; follows = false;
  const r = await forward();
  expect(r.statusCode).toBe(403);
  expect(inserted()).toHaveLength(0);
});
test('into a followers-only DM you follow: sent', async () => {
  privacy = 'followers'; follows = true;
  const r = await forward();
  expect(r.statusCode).toBe(200);
  expect(inserted()).toHaveLength(1);
});
test('into an open DM: sent', async () => {
  privacy = 'everyone'; follows = false;
  expect((await forward()).statusCode).toBe(200);
});
