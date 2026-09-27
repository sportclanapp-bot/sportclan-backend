/**
 * Phase 3 · B09 Chat & notifications (28 Sep 2026) — the backend fixes. See the
 * app repo's phase3/B09.md for each finding. Supabase is mocked: every `from()`
 * starts its own query, and each resolves to `mockNext(q)`, where `q` lists
 * that query's builder calls. `mockLog` keeps every query in order.
 */
type Q = string[];
let mockLog: Q[] = [];
let mockNext: (q: Q) => { data?: unknown; error?: unknown; count?: number } = () => ({ data: null, error: null });
jest.mock('../utils/supabase', () => {
  const start = (t: string) => {
    const q: string[] = [`from:${t}`];
    mockLog.push(q);
    const chain: any = {};
    for (const m of ['select', 'in', 'not', 'eq', 'neq', 'is', 'limit', 'maybeSingle', 'single', 'update', 'delete', 'order', 'or', 'range', 'gt', 'lt', 'upsert']) {
      chain[m] = jest.fn((...a: unknown[]) => { q.push(`${m}:${JSON.stringify(a)}`); return chain; });
    }
    chain.insert = jest.fn((row: unknown) => { q.push(`insert:${JSON.stringify(row)}`); return chain; });
    chain.then = (ok: (v: unknown) => unknown, bad?: (e: unknown) => unknown) => {
      try { return Promise.resolve(ok({ data: null, error: null, ...mockNext(q) })); } catch (e) { return bad ? bad(e) : Promise.reject(e); }
    };
    return chain;
  };
  return { supabase: { from: jest.fn(start) } };
});
let mockMembers = new Set<string>(); // `${chatId}:${userId}` who are current members
jest.mock('../utils/chatMembership', () => ({
  isActiveMember: jest.fn(async (c: string, u: string) => mockMembers.has(`${c}:${u}`)),
  activeMembership: jest.fn(async () => null),
  joinChat: jest.fn(async (c: string, ms: Array<{ user_id: string }>) => { for (const m of ms) mockMembers.add(`${c}:${m.user_id}`); }),
  leaveChat: jest.fn(async () => undefined),
  softDeleteChat: jest.fn(async () => undefined),
}));
let mockBlocked = new Set<string>();
jest.mock('../utils/blocks', () => ({
  ...jest.requireActual('../utils/blocks'),
  blockedUserIds: jest.fn(async () => mockBlocked),
  isBlockedBetween: jest.fn(async () => false),
}));
let mockDead = new Set<string>();
jest.mock('../utils/activeUser', () => ({ deletedIdSet: jest.fn(async (ids: string[]) => new Set(ids.filter((i) => mockDead.has(i)))) }));
jest.mock('../utils/chatPush', () => ({ ...jest.requireActual('../utils/chatPush'), pushChatMessage: jest.fn() }));
jest.mock('../utils/tagPrivacy', () => ({ taggableBy: jest.fn(async () => []) }));
jest.mock('../utils/notify', () => ({
  allowedRecipients: jest.fn(async (ids: string[]) => ids),
  sendPushToUsers: jest.fn(async () => undefined),
  notifyUser: jest.fn(),
}));
jest.mock('../utils/testContent', () => ({ testUserIdSet: jest.fn(async () => new Set()) }));
jest.mock('../utils/sessionRevocation', () => ({ revokeSessionsNow: jest.fn(async () => Date.now()) }));
jest.mock('../utils/jwt', () => ({ ...jest.requireActual('../utils/jwt'), generateAccessTokenAt: jest.fn(() => 'fresh-access') }));

// eslint-disable-next-line import/first
import * as msgs from '../controllers/messages.controller';
// eslint-disable-next-line import/first
import { savePushToken } from '../controllers/notifications.controller';
// eslint-disable-next-line import/first
import { logout } from '../controllers/auth.controller';
// eslint-disable-next-line import/first
import { revokeAllSessions } from '../controllers/account.controller';
// eslint-disable-next-line import/first
import { sendPushToUsers } from '../utils/notify';
// eslint-disable-next-line import/first
import { softDeleteChat } from '../utils/chatMembership';

const ME = '11111111-1111-4111-8111-111111111111';
const C = '22222222-2222-4222-8222-222222222222';
const D = '33333333-3333-4333-8333-333333333333';
const CHAT = '44444444-4444-4444-8444-444444444444';
const MSG = '55555555-5555-4555-8555-555555555555';
const res = () => {
  const r: any = { statusCode: 200, body: null };
  r.status = jest.fn((c: number) => { r.statusCode = c; return r; });
  r.json = jest.fn((b: unknown) => { r.body = b; return r; });
  return r;
};
const call = async (fn: any, req: object) => { const r = res(); await fn({ userId: ME, params: {}, query: {}, body: {}, headers: {}, ...req }, r); return r; };
const writes = () => mockLog.filter((q) => q.some((c) => /^(insert|update|upsert|delete):/.test(c)));
const has = (q: Q, s: string) => q.some((c) => c.includes(s));
/** A DM (is_group false) or a group, as the chats lookup answers it. */
const chatIs = (isGroup: boolean) => (q: Q) => (q[0] === 'from:chats' && has(q, 'is_group') ? { data: { is_group: isGroup } } : { data: null });

beforeEach(() => {
  mockLog = [];
  mockNext = () => ({ data: null, error: null });
  mockMembers = new Set();
  mockBlocked = new Set();
  mockDead = new Set();
  jest.clearAllMocks();
});

describe('F1 · chat pushes are sent (chats has is_group, not type)', () => {
  const { pushChatMessage } = jest.requireActual('../utils/chatPush');
  beforeEach(() => {
    mockNext = (q) => {
      if (q[0] === 'from:chats') {
        // PostgREST refuses a column that doesn't exist — as `type` did.
        return has(q, 'select:["type') ? { data: null, error: { message: 'column chats.type does not exist' } } : { data: { is_group: false, name: null, deleted_at: null } };
      }
      if (q[0] === 'from:chat_participants') return { data: [{ user_id: ME }, { user_id: C }] };
      return { data: null };
    };
  });
  test('a DM pushes to the other person, titled with the sender', async () => {
    await pushChatMessage(CHAT, ME, 'Asha', 'see you at 6');
    expect(sendPushToUsers).toHaveBeenCalledWith([expect.objectContaining({ userId: C, title: 'Asha', body: 'see you at 6' })]);
  });
  test('a group titles it with the group name', async () => {
    const base = mockNext;
    mockNext = (q) => (q[0] === 'from:chats' ? { data: { is_group: true, name: 'Sunday XI', deleted_at: null } } : base(q));
    await pushChatMessage('66666666-6666-4666-8666-666666666666', ME, 'Asha', 'nets at 7');
    expect(sendPushToUsers).toHaveBeenCalledWith([expect.objectContaining({ title: 'Sunday XI', body: 'Asha: nets at 7' })]);
  });
});

describe('F2 · push tokens follow the account signed in on the phone', () => {
  test('saving a token takes it off any other account first', async () => {
    await call(savePushToken, { body: { token: 'ExponentPushToken[x]', platform: 'android' } });
    const del = mockLog.find((q) => q[0] === 'from:push_tokens' && has(q, 'delete:'))!;
    expect(del.join()).toContain('eq:["token","ExponentPushToken[x]"]');
    expect(del.join()).toContain(`neq:["user_id","${ME}"]`);
    expect(mockLog.indexOf(del)).toBeLessThan(mockLog.findIndex((q) => has(q, 'upsert:')));
  });
  test('a non-string token → 400', async () => {
    expect((await call(savePushToken, { body: { token: { a: 1 }, platform: 'android' } })).statusCode).toBe(400);
  });
  test('sign-out with the push token deletes it', async () => {
    await call(logout, { body: { refreshToken: 'rt', pushToken: 'ExponentPushToken[x]' } });
    expect(mockLog.find((q) => q[0] === 'from:push_tokens')!.join()).toContain('delete:[]');
  });
  test('sign-out without one touches no push token (older build)', async () => {
    await call(logout, { body: { refreshToken: 'rt' } });
    expect(mockLog.some((q) => q[0] === 'from:push_tokens')).toBe(false);
  });
  test('"sign out all other devices" deletes every token but this phone\'s', async () => {
    await call(revokeAllSessions, { headers: { 'x-refresh-token': 'rt', 'x-push-token': 'mine' } });
    const del = mockLog.find((q) => q[0] === 'from:push_tokens')!.join();
    expect(del).toContain(`eq:["user_id","${ME}"]`);
    expect(del).toContain('neq:["token","mine"]');
  });
  test('…and none when the phone doesn\'t say which is its own', async () => {
    await call(revokeAllSessions, { headers: { 'x-refresh-token': 'rt' } });
    expect(mockLog.some((q) => q[0] === 'from:push_tokens')).toBe(false);
  });
});

describe('F3 · the group endpoints refuse a one-to-one chat', () => {
  const cases: Array<[string, any, object]> = [
    ['rename', msgs.updateGroup, { params: { id: CHAT }, body: { name: 'x' } }],
    ['add', msgs.addMember, { params: { id: CHAT }, body: { user_id: D } }],
    ['remove', msgs.removeMember, { params: { id: CHAT, memberId: C } }],
    ['promote', msgs.promoteMember, { params: { id: CHAT, memberId: C } }],
    ['leave', msgs.leaveGroup, { params: { id: CHAT } }],
    ['delete', msgs.deleteGroup, { params: { id: CHAT } }],
  ];
  test.each(cases)('%s on a DM → 400 NOT_A_GROUP, nothing written', async (_n, fn, req) => {
    mockMembers.add(`${CHAT}:${ME}`);
    mockNext = chatIs(false);
    const r = await call(fn, req);
    expect(r.statusCode).toBe(400);
    expect(r.body.code).toBe('NOT_A_GROUP');
    expect(writes()).toHaveLength(0);
  });
  test('a DM broken by the old path (deleted, or one side left) is mended, not handed back unreadable', async () => {
    mockNext = (q) => {
      if (q[0] === 'from:users' && has(q, 'deleted_at')) return { data: [{ id: C }] };
      if (q[0] === 'from:users') return { data: { message_privacy: 'everyone' } };
      if (q[0] === 'from:chats' && has(q, 'dm_key')) return { data: { id: CHAT, is_group: false, deleted_at: '2026-09-27T00:00:00Z' } };
      return { data: q[0] === 'from:chat_participants' ? [] : null };
    };
    const r = await call(msgs.getOrCreateDM, { body: { user_id: C } });
    expect(r.body.chat).toEqual(expect.objectContaining({ id: CHAT, deleted_at: null }));
    expect(mockLog.some((q) => q[0] === 'from:chats' && has(q, 'update:[{"deleted_at":null}]'))).toBe(true);
    expect(mockMembers.has(`${CHAT}:${ME}`) && mockMembers.has(`${CHAT}:${C}`)).toBe(true);
  });
});

describe('F4 · only a member can list a chat\'s members', () => {
  test('non-member → 403; member → 200', async () => {
    expect((await call(msgs.getGroupMembers, { params: { id: CHAT } })).statusCode).toBe(403);
    mockMembers.add(`${CHAT}:${ME}`);
    mockNext = () => ({ data: [{ user_id: ME }] });
    expect((await call(msgs.getGroupMembers, { params: { id: CHAT } })).statusCode).toBe(200);
  });
});

describe('F5 · a chat is checked before it is made', () => {
  test('a DM with an unknown account → 404, no chat', async () => {
    mockNext = (q) => ({ data: q[0] === 'from:users' ? [] : q[0] === 'from:chat_participants' ? [] : null });
    const r = await call(msgs.getOrCreateDM, { body: { user_id: D } });
    expect(r.statusCode).toBe(404);
    expect(writes()).toHaveLength(0);
  });
  test.each([
    [{ name: '   ', member_ids: [C] }, 400],
    [{ name: 12, member_ids: [C] }, 400],
    [{ name: 'P3', member_ids: 'x' }, 400],
    [{ name: 'P3', member_ids: ['nope'] }, 400],
    [{ name: 'P3', member_ids: [ME] }, 400],
  ])('createGroup %j → %i, nothing written', async (body, code) => {
    const r = await call(msgs.createGroup, { body });
    expect(r.statusCode).toBe(code);
    expect(writes()).toHaveLength(0);
  });
  test('an unknown member → 404; a block among members → 403 BLOCKED_FROM_GROUP', async () => {
    mockNext = (q) => ({ data: q[0] === 'from:users' ? [{ id: C }] : null });
    expect((await call(msgs.createGroup, { body: { name: 'P3', member_ids: [C, D] } })).statusCode).toBe(404);
    mockNext = (q) => ({ data: q[0] === 'from:users' ? [{ id: C }, { id: D }] : q[0] === 'from:user_blocks' ? [{ id: 'b' }] : null });
    const r = await call(msgs.createGroup, { body: { name: 'P3', member_ids: [C, D] } });
    expect(r.statusCode).toBe(403);
    expect(r.body.code).toBe('BLOCKED_FROM_GROUP');
    expect(writes()).toHaveLength(0);
  });
  test('if the members can\'t be added, the new group is taken back out', async () => {
    mockNext = (q) => {
      if (q[0] === 'from:users') return { data: [{ id: C }] };
      if (q[0] === 'from:chats') return { data: { id: CHAT } };
      if (q[0] === 'from:chat_participants') return { error: { message: 'fk' } };
      return { data: null };
    };
    const r = await call(msgs.createGroup, { body: { name: ' P3 ', member_ids: [C, C] } });
    expect(r.statusCode).toBe(500);
    expect(softDeleteChat).toHaveBeenCalledWith(CHAT);
    expect(mockLog.find((q) => has(q, 'insert:{"is_group":true'))!.join()).toContain('"name":"P3"');
  });
});

describe('F6 · adding, removing or promoting someone who isn\'t there isn\'t a success', () => {
  const admin = (q: Q) => (q[0] === 'from:chats' ? { data: { is_group: true } } : q[0] === 'from:chat_participants' && has(q, 'select:["role"]') ? { data: { role: 'admin' } } : null);
  test.each([['nope', 400], [undefined, 400], [D, 404]])('add %s → %i, no system line', async (user_id, code) => {
    mockNext = (q) => admin(q) ?? { data: q[0] === 'from:users' ? [] : null, count: 1 };
    const r = await call(msgs.addMember, { params: { id: CHAT }, body: { user_id } });
    expect(r.statusCode).toBe(code);
    expect(mockLog.some((q) => q[0] === 'from:messages')).toBe(false);
  });
  test('remove / promote a non-member → 404', async () => {
    mockNext = (q) => admin(q) ?? { data: [] };
    expect((await call(msgs.removeMember, { params: { id: CHAT, memberId: D } })).statusCode).toBe(404);
    expect((await call(msgs.promoteMember, { params: { id: CHAT, memberId: D } })).statusCode).toBe(404);
  });
});

describe('F7 · no blank messages', () => {
  test.each([{ text: '   ' }, { content: 12345 }, { content: ['x'] }, {}])('%j → 400 EMPTY_MESSAGE', async (body) => {
    mockMembers.add(`${CHAT}:${ME}`);
    const r = await call(msgs.sendMessage, { params: { id: CHAT }, body });
    expect(r.statusCode).toBe(400);
    expect(r.body.code).toBe('EMPTY_MESSAGE');
  });
  test('forwarding a deleted message → 409', async () => {
    mockMembers.add(`${CHAT}:${ME}`);
    mockNext = (q) => ({ data: q[0] === 'from:messages' ? { content: null, chat_id: CHAT, is_deleted: true, is_system: false } : null });
    const r = await call(msgs.forwardMessage, { body: { message_id: MSG, chat_ids: [CHAT] } });
    expect(r.statusCode).toBe(409);
    expect(writes()).toHaveLength(0);
  });
});

describe('F8 · bad input answers 400, not 500', () => {
  beforeEach(() => mockMembers.add(`${CHAT}:${ME}`));
  test.each([{ cursor: 'garbage' }, { limit: '-5' }, { limit: 'x' }, { limit: ['1', '2'] }])('getMessages %j → 400', async (query) => {
    expect((await call(msgs.getMessages, { params: { id: CHAT }, query })).statusCode).toBe(400);
  });
  test('reply_to_id "nope" → 400', async () => {
    expect((await call(msgs.sendMessage, { params: { id: CHAT }, body: { text: 'hi', reply_to_id: 'nope' } })).statusCode).toBe(400);
  });
  test('read with a non-id → 400', async () => {
    expect((await call(msgs.batchMarkRead, { body: { messageIds: ['x'] } })).statusCode).toBe(400);
  });
  test.each([['__proto__', '__proto__'], ['3000 characters', 'x'.repeat(3000)], ['a number', 7], ['an object', { a: 1 }]])('react with %s → 400 (F10)', async (_n, emoji) => {
    const r = await call(msgs.reactToMessage, { params: { messageId: MSG }, body: { emoji } });
    expect(r.statusCode).toBe(400);
    expect(writes()).toHaveLength(0);
  });
  test('a real reaction still toggles', async () => {
    mockNext = (q) => ({ data: q[0] === 'from:messages' && has(q, 'maybeSingle') ? { id: MSG, chat_id: CHAT, reactions: {} } : null });
    const r = await call(msgs.reactToMessage, { params: { messageId: MSG }, body: { emoji: '👍' } });
    expect(r.body.reactions).toEqual({ '👍': [ME] });
  });
});

describe('F9 · replies stay in their chat, and reply_to is the parent', () => {
  test('a reply to another chat\'s message → 400 INVALID_REPLY', async () => {
    mockMembers.add(`${CHAT}:${ME}`);
    mockNext = () => ({ data: null });
    const r = await call(msgs.sendMessage, { params: { id: CHAT }, body: { text: 'hi', reply_to_id: MSG } });
    expect(r.statusCode).toBe(400);
    expect(r.body.code).toBe('INVALID_REPLY');
    expect(writes()).toHaveLength(0);
  });
  test('the thread carries the replied-to message, read from this chat only', async () => {
    mockMembers.add(`${CHAT}:${ME}`);
    const reply = { id: 'r', reply_to_id: MSG, created_at: '2026-09-28T01:00:00Z' };
    mockNext = (q) => {
      if (q[0] === 'from:messages' && has(q, `in:["id",["${MSG}"]]`)) return { data: [{ id: MSG, content: 'parent' }] };
      if (q[0] === 'from:messages') return { data: [reply] };
      return { data: [] };
    };
    const r = await call(msgs.getMessages, { params: { id: CHAT } });
    expect(r.body.messages[0].reply_to).toEqual({ id: MSG, content: 'parent' });
    expect(mockLog.find((q) => has(q, `in:["id",["${MSG}"]]`))!.join()).toContain(`eq:["chat_id","${CHAT}"]`);
    expect(mockLog.some((q) => has(q, 'messages!reply_to_id'))).toBe(false);
  });
});

describe('F11 · the chat list counts unread the way the Home dot does', () => {
  test('deleted messages and blocked or deleted senders count nowhere', async () => {
    mockBlocked = new Set([D]);
    mockDead = new Set(['dead']);
    mockNext = (q) => {
      if (q[0] === 'from:chat_participants' && has(q, 'select:["chat_id"]')) return { data: [{ chat_id: CHAT }] };
      if (q[0] === 'from:chats') return { data: [{ id: CHAT }], count: 1 };
      if (q[0] === 'from:messages' && has(q, 'not:["read_by"')) return { data: [{ sender_id: C }, { sender_id: 'dead' }] };
      return { data: null };
    };
    const r = await call(msgs.listChats, {});
    expect(r.body.chats[0].unreadCount).toBe(1);
    const unread = mockLog.find((q) => q[0] === 'from:messages' && has(q, 'not:["read_by"'))!.join();
    expect(unread).toContain('eq:["is_deleted",false]');
    expect(unread).toContain(D); // blocked sender excluded
  });
});

describe('F20 · group names and the chat total', () => {
  test.each(['   ', 12345])('rename to %j → 400', async (name) => {
    mockNext = (q) => (q[0] === 'from:chats' ? { data: { is_group: true } } : { data: { role: 'admin' } });
    expect((await call(msgs.updateGroup, { params: { id: CHAT }, body: { name } })).statusCode).toBe(400);
    expect(writes()).toHaveLength(0);
  });
  test('total counts listed (not deleted) chats', async () => {
    mockNext = (q) => {
      if (q[0] === 'from:chat_participants' && has(q, 'select:["chat_id"]')) return { data: [{ chat_id: CHAT }, { chat_id: 'gone' }] };
      if (q[0] === 'from:chats') return { data: [{ id: CHAT }], count: 1 };
      return { data: [] };
    };
    const r = await call(msgs.listChats, {});
    expect(r.body.total).toBe(1);
  });
});

describe('F19 · one chat by id, for Group info', () => {
  test('a member gets the chat and its members; a non-member 403; a deleted chat 404', async () => {
    expect((await call(msgs.getChat, { params: { id: CHAT } })).statusCode).toBe(403);
    mockMembers.add(`${CHAT}:${ME}`);
    mockNext = (q) => ({ data: q[0] === 'from:chats' ? { id: CHAT, is_group: true, name: 'P3' } : [{ user_id: ME, role: 'admin' }] });
    const r = await call(msgs.getChat, { params: { id: CHAT } });
    expect(r.body.chat).toEqual(expect.objectContaining({ id: CHAT, participants: [{ user_id: ME, role: 'admin' }] }));
    mockNext = () => ({ data: null });
    expect((await call(msgs.getChat, { params: { id: CHAT } })).statusCode).toBe(404);
  });
});
