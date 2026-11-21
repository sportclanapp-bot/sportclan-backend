/**
 * Q36 (Dipak, 21 Nov 2026: A) · N-R6-4: an admin the creator promoted could remove the creator;
 * the creator couldn't get back in and nobody could delete the group. Now nobody can remove the
 * group's creator (403 CREATOR_NOT_REMOVABLE); the creator can only leave. Others are removed as before.
 */
import { mock, res } from './r6Mock';
jest.mock('../utils/supabase', () => require('./r6Mock').supabaseStandIn());
const leaveChat = jest.fn();
jest.mock('../utils/chatMembership', () => ({ isActiveMember: jest.fn(async () => true), leaveChat: (...a: unknown[]) => leaveChat(...a), joinChat: jest.fn(), softDeleteChat: jest.fn() }));
jest.mock('../utils/chatPush', () => ({ pushChatMessage: jest.fn() }));
// eslint-disable-next-line import/first
import { removeMember } from '../controllers/messages.controller';

const ADMIN = '11111111-1111-4111-8111-111111111111';
const CREATOR = '22222222-2222-4222-8222-222222222222';
const OTHER = '33333333-3333-4333-8333-333333333333';
const CHAT = '77777777-7777-4777-8777-777777777777';
beforeEach(() => {
  leaveChat.mockClear();
  mock.next = (q) => {
    if (q[0] === 'from:chats') return { data: { id: CHAT, is_group: true, created_by: CREATOR } };
    if (q[0] === 'from:tournaments') return { data: [] };
    if (q[0] === 'from:chat_participants') return { data: { role: 'admin' } };
    return { data: [] };
  };
});
const remove = async (memberId: string) => { const r = res(); await removeMember({ userId: ADMIN, params: { id: CHAT, memberId } } as any, r); return r; };

test('a promoted admin cannot remove the creator; nobody leaves', async () => {
  const r = await remove(CREATOR);
  expect(r.statusCode).toBe(403);
  expect(r.body.code).toBe('CREATOR_NOT_REMOVABLE');
  expect(r.body.error).toMatch(/creator can’t be removed/);
  expect(leaveChat).not.toHaveBeenCalled();
});
test('removing another member still works', async () => {
  const r = await remove(OTHER);
  expect(r.statusCode).toBe(200);
  expect(leaveChat).toHaveBeenCalledWith(CHAT, [OTHER], { removedBy: ADMIN });
});
