/**
 * Round 6 · E-124: an admin could "remove" themselves through DELETE /groups/:id/members/<own id>.
 * That skipped Leave group's hand-over (SC-301) and empty-group delete, so a sole admin left a group
 * nobody could manage. Leaving goes through Leave group; removing someone else is unchanged.
 */
import { mock, res } from './r6Mock';
jest.mock('../utils/supabase', () => require('./r6Mock').supabaseStandIn());
const leaveChat = jest.fn();
jest.mock('../utils/chatMembership', () => ({ isActiveMember: jest.fn(async () => true), leaveChat: (...a: unknown[]) => leaveChat(...a), joinChat: jest.fn(), softDeleteChat: jest.fn() }));
jest.mock('../utils/chatPush', () => ({ pushChatMessage: jest.fn() }));
// eslint-disable-next-line import/first
import { removeMember } from '../controllers/messages.controller';

const ME = '11111111-1111-4111-8111-111111111111';
const OTHER = '22222222-2222-4222-8222-222222222222';
const CHAT = '77777777-7777-4777-8777-777777777777';
beforeEach(() => {
  leaveChat.mockClear();
  mock.next = (q) => {
    if (q[0] === 'from:chats') return { data: { id: CHAT, is_group: true } };
    if (q[0] === 'from:tournaments') return { data: [] };
    if (q[0] === 'from:chat_participants') return { data: { role: 'admin' } };
    return { data: [] };
  };
});
const remove = async (memberId: string) => { const r = res(); await removeMember({ userId: ME, params: { id: CHAT, memberId } } as any, r); return r; };

test('an admin removing themselves is refused and nobody leaves', async () => {
  const r = await remove(ME);
  expect(r.statusCode).toBe(400);
  expect(r.body.code).toBe('USE_LEAVE_GROUP');
  expect(leaveChat).not.toHaveBeenCalled();
});
test('an admin removing someone else still works', async () => {
  const r = await remove(OTHER);
  expect(r.statusCode).toBe(200);
  expect(leaveChat).toHaveBeenCalledWith(CHAT, [OTHER], { removedBy: ME });
});
