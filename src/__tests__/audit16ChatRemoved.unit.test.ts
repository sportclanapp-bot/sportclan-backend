/**
 * Audit #16 (11 Oct 2026): a match participant removed from the match chat by
 * its admin was put straight back the next time they opened the match chat.
 */
import { fakeDb } from './helpers/fakeSupabase';
import { leaveChat, joinChat, wasRemovedFromChat } from '../utils/chatMembership';

let db = fakeDb();
jest.mock('../utils/supabase', () => ({ get supabase() { return db.client; } }));
jest.mock('../utils/notify', () => ({ notifyUser: jest.fn(), notifyUsers: jest.fn(), matchAudienceIds: jest.fn(async () => []), matchFollowerIds: jest.fn(async () => []) }));

// eslint-disable-next-line import/first
import { getMatchChat } from '../controllers/matches.controller';

const M = 'mmmmmmmm-mmmm-4mmm-8mmm-000000000016'; const C = 'cccccccc-cccc-4ccc-8ccc-000000000016';
const call = async (userId: string) => {
  const r: any = { statusCode: 200, body: null };
  r.status = jest.fn((c: number) => { r.statusCode = c; return r; });
  r.json = jest.fn((b: unknown) => { r.body = b; return r; });
  await getMatchChat({ userId, params: { id: M } } as any, r);
  return r;
};

describe('audit #16: a removal from the match chat sticks', () => {
  beforeEach(() => {
    db = fakeDb({
      matches: [{ id: M, chat_id: C, team_a_name: 'A', team_b_name: 'B', created_by: 'admin', umpire_id: null }],
      chats: [{ id: C, deleted_at: null, is_group: true, name: 'A vs B Chat' }],
      match_participants: [{ id: 'p1', match_id: M, user_id: 'kicked' }, { id: 'p2', match_id: M, user_id: 'leaver' }],
      chat_participants: [
        { id: 'c0', chat_id: C, user_id: 'admin', role: 'admin', left_at: null, removed_by: null },
        { id: 'c1', chat_id: C, user_id: 'kicked', role: 'member', left_at: null, removed_by: null },
        { id: 'c2', chat_id: C, user_id: 'leaver', role: 'member', left_at: null, removed_by: null },
      ],
    });
  });
  it('removed by the admin → opening the match chat is refused, still out', async () => {
    await leaveChat(C, ['kicked'], { removedBy: 'admin' });
    const r = await call('kicked');
    expect(r.statusCode).toBe(403);
    expect(r.body.code).toBe('REMOVED_FROM_CHAT');
    expect(await wasRemovedFromChat(C, 'kicked')).toBe(true);
  });
  it('someone who left on their own can come back', async () => {
    await leaveChat(C, ['leaver']);
    const r = await call('leaver');
    expect(r.statusCode).toBe(200);
    expect(db.t('chat_participants').find((x) => x.user_id === 'leaver')!.left_at).toBeNull();
  });
  it('an automatic join skips a removed member; an admin adding them back works', async () => {
    await leaveChat(C, ['kicked'], { removedBy: 'admin' });
    await joinChat(C, [{ user_id: 'kicked', role: 'member' }]);
    expect(db.t('chat_participants').find((x) => x.user_id === 'kicked')!.left_at).not.toBeNull();
    await joinChat(C, [{ user_id: 'kicked', role: 'member' }], { byAdmin: true });
    const row = db.t('chat_participants').find((x) => x.user_id === 'kicked')!;
    expect(row.left_at).toBeNull();
    expect(row.removed_by).toBeNull();
  });
});
