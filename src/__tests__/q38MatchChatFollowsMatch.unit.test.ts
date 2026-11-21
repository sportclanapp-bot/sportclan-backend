/**
 * Q38 (Dipak, 21 Nov 2026: A) · N-R6-E131: a match's chat holds exactly the people in the match —
 * its creator (admin), umpire and scorer, and its line-up — like a tournament's chat. Nobody adds,
 * removes, promotes, leaves or deletes it by hand (409 MATCH_CHAT); a player taken off the match
 * leaves its chat; two players who blocked each other both stay in.
 */
import { fakeDb } from './helpers/fakeSupabase';

let db = fakeDb();
jest.mock('../utils/supabase', () => ({ get supabase() { return db.client; } }));
jest.mock('../utils/notify', () => ({ notifyUser: jest.fn(), notifyUsers: jest.fn(), matchAudienceIds: jest.fn(async () => []), matchFollowerIds: jest.fn(async () => []) }));
jest.mock('../utils/chatPush', () => ({ pushChatMessage: jest.fn() }));

// eslint-disable-next-line import/first
import { getMatchChat } from '../controllers/matches.controller';
// eslint-disable-next-line import/first
import { addMember, removeMember, leaveGroup, deleteGroup, promoteMember } from '../controllers/messages.controller';
// eslint-disable-next-line import/first
import { syncMatchChatMembers } from '../utils/matchChat';

const M = 'mmmmmmmm-mmmm-4mmm-8mmm-000000000038'; const C = 'cccccccc-cccc-4ccc-8ccc-000000000038';
const res = () => { const r: any = { statusCode: 200, body: null }; r.status = jest.fn((c: number) => { r.statusCode = c; return r; }); r.json = jest.fn((b: unknown) => { r.body = b; return r; }); return r; };
const live = () => db.t('chat_participants').filter((x: any) => x.chat_id === C && !x.left_at).map((x: any) => `${x.user_id}:${x.role}`).sort();

beforeEach(() => {
  db = fakeDb({
    matches: [{ id: M, chat_id: C, team_a_name: 'A', team_b_name: 'B', created_by: 'org', umpire_id: 'ump', scorer_id: null }],
    chats: [{ id: C, deleted_at: null, is_group: true, name: 'A vs B Chat', created_by: 'org' }],
    tournaments: [],
    users: [{ id: 'org', deleted_at: null }, { id: 'ump', deleted_at: null }, { id: 'p1', deleted_at: null }, { id: 'p2', deleted_at: null }, { id: 'outsider', deleted_at: null }, { id: 'dropped', deleted_at: null }],
    match_participants: [{ id: 'mp1', match_id: M, user_id: 'p1' }, { id: 'mp2', match_id: M, user_id: 'p2' }],
    user_blocks: [{ blocker_id: 'p1', blocked_id: 'p2' }],
    chat_participants: [
      { id: 'c0', chat_id: C, user_id: 'org', role: 'admin', left_at: null, removed_by: null },
      { id: 'c1', chat_id: C, user_id: 'outsider', role: 'admin', left_at: null, removed_by: null },
      { id: 'c2', chat_id: C, user_id: 'dropped', role: 'member', left_at: null, removed_by: null },
    ],
  });
});

test('opening it makes the chat exactly the match: creator admin, umpire and both players (blocked or not); others out', async () => {
  const r = res();
  await getMatchChat({ userId: 'p1', params: { id: M } } as any, r);
  expect(r.statusCode).toBe(200);
  expect(live()).toEqual(['org:admin', 'p1:member', 'p2:member', 'ump:member']);
});
test('a player taken off the match leaves the chat on the next sync; nothing is deleted', async () => {
  await syncMatchChatMembers(M);
  db.t('match_participants').splice(1, 1); // p2 off the line-up
  await syncMatchChatMembers(M);
  expect(live()).not.toContain('p2:member');
  expect(db.t('chat_participants').some((x: any) => x.user_id === 'p2')).toBe(true); // a soft leave
});
test('nobody adds, removes, promotes, leaves or deletes it by hand', async () => {
  await syncMatchChatMembers(M);
  const calls: Array<[any, any]> = [
    [addMember, { userId: 'org', params: { id: C }, body: { user_id: 'outsider' } }],
    [removeMember, { userId: 'org', params: { id: C, memberId: 'p1' } }],
    [promoteMember, { userId: 'org', params: { id: C, memberId: 'p1' } }],
    [leaveGroup, { userId: 'p1', params: { id: C } }],
    [deleteGroup, { userId: 'org', params: { id: C } }],
  ];
  for (const [fn, req] of calls) {
    const r = res();
    await fn({ body: {}, headers: {}, ...req }, r);
    expect([r.statusCode, r.body.code]).toEqual([409, 'MATCH_CHAT']);
  }
});
