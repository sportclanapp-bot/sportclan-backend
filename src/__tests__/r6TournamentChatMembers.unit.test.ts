/** Round 6 · N-R6-2 (D7): an organiser (admin of the tournament's chat) could add an outsider through the group routes. */
import { mock, res } from './r6Mock';
jest.mock('../utils/supabase', () => require('./r6Mock').supabaseStandIn());
jest.mock('../utils/chatMembership', () => ({ isActiveMember: jest.fn(async () => true), leaveChat: jest.fn(), joinChat: jest.fn(), softDeleteChat: jest.fn() }));
jest.mock('../utils/chatPush', () => ({ pushChatMessage: jest.fn() }));
// eslint-disable-next-line import/first
import { addMember, removeMember, promoteMember, deleteGroup, getChat } from '../controllers/messages.controller';
const ME = '11111111-1111-4111-8111-111111111111'; const CHAT = '77777777-7777-4777-8777-777777777777'; const OUT = '88888888-8888-4888-8888-888888888888';
let isTournamentChat = true;
beforeEach(() => {
  mock.log = [];
  mock.next = (q) => {
    if (q[0] === 'from:chats') return { data: { id: CHAT, is_group: true, created_by: ME, deleted_at: null } };
    if (q[0] === 'from:tournaments') return { data: isTournamentChat ? [{ id: 't1' }] : [] };
    if (q[0] === 'from:chat_participants') return { data: q.some((c) => c.startsWith('single')) ? { role: 'admin' } : [{ user_id: ME, role: 'admin' }] };
    if (q[0] === 'from:users') return { data: [{ id: OUT }] };
    return { data: [] };
  };
});
const req = (extra: object) => ({ userId: ME, params: { id: CHAT, memberId: OUT }, body: { user_id: OUT }, query: {}, ...extra }) as any;

test.each([['add', addMember], ['remove', removeMember], ['promote', promoteMember], ['delete', deleteGroup]] as const)(
  '%s on a tournament chat is refused (409 TOURNAMENT_CHAT) and writes nothing', async (_n, fn) => {
    const r = res(); await (fn as any)(req({}), r);
    expect(r.statusCode).toBe(409);
    expect(r.body.code).toBe('TOURNAMENT_CHAT');
    expect(mock.log.filter((q) => q.some((c) => /^(insert|update|upsert|delete):/.test(c)))).toHaveLength(0);
  });
test('an ordinary group is unaffected', async () => {
  isTournamentChat = false;
  const r = res(); await addMember(req({}), r);
  expect(r.body?.code).not.toBe('TOURNAMENT_CHAT');
  isTournamentChat = true;
});
test('the chat says which tournament it belongs to, so the app can hide the member controls', async () => {
  const r = res(); await getChat(req({}), r);
  expect(r.body.chat.tournament_id).toBe('t1');
});
