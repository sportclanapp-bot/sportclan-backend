/**
 * E-127 (Round 6): Leave group in a tournament's chat answered success, and the next sync (any
 * entry or roster change) put the leaver straight back, since D7 says the chat holds exactly the
 * tournament's people. Leaving never stuck; it is refused now (mute still works).
 */
import { mock, res } from './r6Mock';
jest.mock('../utils/supabase', () => require('./r6Mock').supabaseStandIn());
jest.mock('../utils/chatMembership', () => ({ isActiveMember: jest.fn(async () => true), leaveChat: jest.fn(), joinChat: jest.fn(), softDeleteChat: jest.fn() }));
jest.mock('../utils/chatPush', () => ({ pushChatMessage: jest.fn() }));
// eslint-disable-next-line import/first
import { leaveGroup } from '../controllers/messages.controller';
// eslint-disable-next-line import/first
import { leaveChat } from '../utils/chatMembership';
const ME = '11111111-1111-4111-8111-111111111111'; const CHAT = '77777777-7777-4777-8777-777777777777';
let isTournamentChat = true;
beforeEach(() => {
  mock.log = []; (leaveChat as jest.Mock).mockClear();
  mock.next = (q) => {
    if (q[0] === 'from:chats') return { data: { id: CHAT, is_group: true, created_by: ME, deleted_at: null } };
    if (q[0] === 'from:tournaments') return { data: isTournamentChat ? [{ id: 't1' }] : [] };
    if (q[0] === 'from:chat_participants') return { data: q.some((c) => c.startsWith('maybeSingle')) ? { role: 'member' } : [], count: 3 };
    return { data: [] };
  };
});
const req = () => ({ userId: ME, params: { id: CHAT }, body: {}, query: {} }) as any;

test('leaving a tournament’s chat is refused (409 TOURNAMENT_CHAT), says to mute instead, and changes nothing', async () => {
  const r = res(); await leaveGroup(req(), r);
  expect(r.statusCode).toBe(409);
  expect(r.body.code).toBe('TOURNAMENT_CHAT');
  expect(r.body.error).toMatch(/Mute it instead/);
  expect(leaveChat).not.toHaveBeenCalled();
  expect(mock.log.filter((q) => q.some((c) => /^(insert|update|upsert|delete):/.test(c)))).toHaveLength(0);
});
test('an ordinary group can still be left', async () => {
  isTournamentChat = false;
  const r = res(); await leaveGroup(req(), r);
  expect(r.statusCode).toBe(200);
  expect(leaveChat).toHaveBeenCalledWith(CHAT, [ME]);
  isTournamentChat = true;
});
