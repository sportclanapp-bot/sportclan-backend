/**
 * E-079 (Round 6): a tournament made of events has ONE chat, its own (the parent's). But every
 * trigger synced the chat of the id it was given, so approving or withdrawing in an EVENT looked for
 * the event's chat (none) and the tournament's chat never changed; opening the chat from an event's
 * page made a second chat for the event.
 */
import { mock, res } from './r6Mock';
jest.mock('../utils/supabase', () => require('./r6Mock').supabaseStandIn());
jest.mock('../utils/chatMembership', () => ({ joinChat: jest.fn(async () => undefined), leaveChat: jest.fn(async () => undefined) }));
// eslint-disable-next-line import/first
import { syncTournamentChatMembers, syncTournamentChatsForTeam } from '../utils/tournamentChat';
// eslint-disable-next-line import/first
import { getTournamentChat } from '../controllers/tournaments.controller';
// eslint-disable-next-line import/first
import { joinChat, leaveChat } from '../utils/chatMembership';

const ROOT = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const EVENT = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
const CHAT = 'cccccccc-cccc-4ccc-8ccc-cccccccccccc';
const ORG = 'dddddddd-dddd-4ddd-8ddd-dddddddddddd';
const P1 = 'eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee';
const WITHDRAWN = 'ffffffff-ffff-4fff-8fff-ffffffffffff';
const TEAM = '12121212-1212-4121-8121-121212121212';

beforeEach(() => {
  mock.log = [];
  (joinChat as jest.Mock).mockClear(); (leaveChat as jest.Mock).mockClear();
  mock.next = (q) => {
    const has = (x: string) => q.some((c) => c.includes(x));
    if (q[0] === 'from:tournaments') {
      if (q.some((c) => c.startsWith('insert') || c.startsWith('update'))) return { data: { id: 'new' } };
      if (has('"parent_id",')) return { data: [{ id: EVENT }] }; // the events of ROOT
      if (has('id, sport_metadata')) return { data: [{ id: ROOT, sport_metadata: { _chat_id: CHAT } }, { id: EVENT, sport_metadata: {} }] };
      if (has('id, parent_id, is_parent')) return { data: has(EVENT) ? { id: EVENT, parent_id: ROOT, is_parent: false } : { id: ROOT, parent_id: null, is_parent: true } };
      if (has('"sport_metadata"')) return { data: { sport_metadata: has(ROOT) ? { _chat_id: CHAT } : {} } };
      if (has('id, name, sport_metadata, created_by')) return { data: has(ROOT) ? { id: ROOT, name: 'Open', sport_metadata: { _chat_id: CHAT }, created_by: ORG } : { id: EVENT, name: 'Open · MD', sport_metadata: {}, created_by: ORG } };
      if (has('"parent_id"')) return { data: { parent_id: has(EVENT) ? ROOT : null } };
      return { data: { created_by: ORG } };
    }
    if (q[0] === 'from:tournament_organisers') return { data: [] };
    if (q[0] === 'from:tournament_entries') return { data: has('"tournament_id",') && has('eq:["team_id"') ? [{ tournament_id: EVENT }] : [{ team_id: TEAM }] };
    if (q[0] === 'from:team_members') return { data: [{ user_id: P1 }] };
    if (q[0] === 'from:chat_participants') return { data: [{ user_id: ORG, role: 'admin' }, { user_id: WITHDRAWN, role: 'member' }] };
    if (q[0] === 'from:chats') return { data: { id: CHAT } };
    return { data: null };
  };
});

test('an approval or withdrawal in an event syncs the tournament’s chat', async () => {
  await syncTournamentChatMembers(EVENT);
  expect(joinChat).toHaveBeenCalledWith(CHAT, [{ user_id: P1, role: 'member' }]);
  expect(leaveChat).toHaveBeenCalledWith(CHAT, [WITHDRAWN]);
});
test('a roster change of a team entered in an event syncs the tournament’s chat', async () => {
  await syncTournamentChatsForTeam(TEAM);
  expect(joinChat).toHaveBeenCalledWith(CHAT, [{ user_id: P1, role: 'member' }]);
});
test('opening the chat from an event’s page opens the tournament’s chat, and makes no second one', async () => {
  const r = res();
  await getTournamentChat({ userId: P1, params: { id: EVENT }, query: {}, body: {} } as any, r);
  expect(r.statusCode).toBe(200);
  expect(r.body.chat_id).toBe(CHAT);
  expect(mock.log.some((q) => q[0] === 'from:chats' && q.some((c) => c.startsWith('insert')))).toBe(false);
});
