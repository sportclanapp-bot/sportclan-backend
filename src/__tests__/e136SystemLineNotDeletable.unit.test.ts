/**
 * Round 6 · E-136: a system line ('Group "X" created', 'Y was added') is stored with the admin who
 * caused it as its sender, so that admin could blank it for everyone with "Delete". It is the
 * group's record; the sender's own messages are still theirs to delete.
 */
import { mock, res } from './r6Mock';
jest.mock('../utils/supabase', () => require('./r6Mock').supabaseStandIn());
jest.mock('../utils/chatMembership', () => ({ isActiveMember: jest.fn(async () => true), leaveChat: jest.fn(), joinChat: jest.fn(), softDeleteChat: jest.fn() }));
jest.mock('../utils/chatPush', () => ({ pushChatMessage: jest.fn() }));
// eslint-disable-next-line import/first
import { deleteMessage } from '../controllers/messages.controller';

const ME = '11111111-1111-4111-8111-111111111111';
const MSG = '77777777-7777-4777-8777-777777777777';
let system = false;
const writes = () => mock.log.filter((q) => q[0] === 'from:messages' && q.some((c) => c.startsWith('update')));
beforeEach(() => {
  mock.log = [];
  mock.next = (q) => {
    if (q[0] === 'from:messages' && q.some((c) => c.startsWith('update'))) return { data: [{ id: MSG }] };
    if (q[0] === 'from:messages') return { data: { sender_id: ME, created_at: '2026-10-01T00:00:00Z', is_system: system } };
    return { data: [] };
  };
});
const del = async () => { const r = res(); await deleteMessage({ userId: ME, params: { messageId: MSG }, body: {}, query: {} } as any, r); return r; };

test('a system line can’t be deleted, even by the admin it names as sender', async () => {
  system = true;
  const r = await del();
  expect(r.statusCode).toBe(403);
  expect(r.body.code).toBe('SYSTEM_MESSAGE');
  expect(writes()).toHaveLength(0);
});
test('the sender’s own message is still deleted', async () => {
  system = false;
  const r = await del();
  expect(r.statusCode).toBe(200);
  expect(writes()).toHaveLength(1);
});
