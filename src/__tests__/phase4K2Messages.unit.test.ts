/**
 * Phase 4 · K2 — regression tests for backend chat fixes (see the app repo's
 * phase4/K2.md). Supabase is mocked: every `from()` starts its own query,
 * resolved by `mockNext(q)`; `mockLog` keeps every query in order.
 */
type Q = string[];
let mockLog: Q[] = [];
let mockNext: (q: Q) => { data?: unknown; error?: unknown; count?: number } = () => ({ data: null, error: null });
jest.mock('../utils/supabase', () => {
  const start = (t: string) => {
    const q: string[] = [`from:${t}`];
    mockLog.push(q);
    const chain: any = {};
    for (const m of ['select', 'in', 'not', 'eq', 'neq', 'is', 'limit', 'maybeSingle', 'single', 'update', 'delete', 'order', 'or', 'range', 'gt', 'gte', 'lt', 'upsert']) {
      chain[m] = jest.fn((...a: unknown[]) => { q.push(`${m}:${JSON.stringify(a)}`); return chain; });
    }
    chain.insert = jest.fn((row: unknown) => { q.push(`insert:${JSON.stringify(row)}`); return chain; });
    chain.then = (ok: (v: unknown) => unknown, bad?: (e: unknown) => unknown) => {
      try { return Promise.resolve(ok({ data: null, error: null, ...mockNext(q) })); } catch (e) { return bad ? bad(e) : Promise.reject(e); }
    };
    return chain;
  };
  return { supabase: { from: jest.fn(start), rpc: jest.fn(async () => ({ data: null, error: null })) } };
});
let mockMember = true;
jest.mock('../utils/chatMembership', () => ({
  isActiveMember: jest.fn(async () => mockMember),
  activeMembership: jest.fn(async () => (mockMember ? { role: 'admin' } : null)),
  joinChat: jest.fn(async () => undefined),
  leaveChat: jest.fn(async () => undefined),
  softDeleteChat: jest.fn(async () => undefined),
}));
let mockBlocked = new Set<string>();
let mockBlockedPair = false;
jest.mock('../utils/blocks', () => ({
  ...jest.requireActual('../utils/blocks'),
  blockedUserIds: jest.fn(async () => mockBlocked),
  isBlockedBetween: jest.fn(async () => mockBlockedPair),
}));
jest.mock('../utils/activeUser', () => ({ ...jest.requireActual('../utils/activeUser'), deletedIdSet: jest.fn(async () => new Set()) }));
jest.mock('../utils/chatPush', () => ({ ...jest.requireActual('../utils/chatPush'), pushChatMessage: jest.fn() }));
jest.mock('../utils/tagPrivacy', () => ({ taggableBy: jest.fn(async (_a: string, ids: string[]) => ids) }));
jest.mock('../utils/notify', () => ({ notifyUser: jest.fn(), notifyUsers: jest.fn(), notifyUnlessBlocked: jest.fn(), sendPushToUsers: jest.fn() }));
jest.mock('../utils/testContent', () => ({ testUserIdSet: jest.fn(async () => new Set()), hideTestFor: jest.fn(async () => false), excludeTest: (q: unknown) => q }));

// eslint-disable-next-line import/first
import * as msgs from '../controllers/messages.controller';

const ME = '11111111-1111-4111-8111-111111111111';
const CHAT = '22222222-2222-4222-8222-222222222222';
const D = '33333333-3333-4333-8333-333333333333';
const MSG = '44444444-4444-4444-8444-444444444444';
const res = () => {
  const r: any = { statusCode: 200, body: null, setHeader: jest.fn(), set: jest.fn(), on: jest.fn() };
  r.status = jest.fn((c: number) => { r.statusCode = c; return r; });
  r.json = jest.fn((b: unknown) => { r.body = b; return r; });
  return r;
};
const call = async (fn: any, req: object) => { const r = res(); await fn({ userId: ME, params: {}, query: {}, body: {}, headers: {}, ...req }, r); return r; };
const flush = () => new Promise((r) => setTimeout(r, 0));

beforeEach(() => {
  mockLog = [];
  mockNext = () => ({ data: null, error: null });
  mockBlocked = new Set();
  mockBlockedPair = false;
  mockMember = true;
  jest.restoreAllMocks();
});

describe('K2-2i · batchMarkRead only touches the caller’s chats (SC-107)', () => {
  it('K2-2i (99ffb16): the messages read is constrained to chat_id ∈ my chats', async () => {
    mockNext = (q) => (q[0] === 'from:chat_participants' ? { data: [{ chat_id: CHAT }] } : { data: [] });
    await call(msgs.batchMarkRead, { body: { messageIds: [MSG] } });
    const m = mockLog.find((q) => q[0] === 'from:messages')!;
    expect(m).toContain(`in:["chat_id",["${CHAT}"]]`);
  });
  it('K2-2i (99ffb16): a caller in no chats marks nothing and never reads messages', async () => {
    const r = await call(msgs.batchMarkRead, { body: { messageIds: [MSG] } });
    expect(r.body).toEqual({ success: true, updated: 0 });
    expect(mockLog.filter((q) => q[0] === 'from:messages')).toHaveLength(0);
  });
});

describe('K2-2j · updateGroup survives a bodyless request (SC-108)', () => {
  it('K2-2j (99ffb16): no body → not a 500', async () => {
    const r = await call(msgs.updateGroup, { params: { id: CHAT }, body: undefined });
    expect(r.statusCode).not.toBe(500);
  });
});

describe('K2-4 / K2-5 · the fire-and-forget @mention insert logs its failures (SC-112)', () => {
  const world = (insertOutcome: 'error' | 'throw') => (q: Q) => {
    if (q[0] === 'from:notifications' && q.some((c) => c.startsWith('insert:'))) {
      if (insertOutcome === 'throw') throw new Error('socket hang up');
      return { data: null, error: { message: 'insert denied' } };
    }
    if (q[0] === 'from:messages' && q.some((c) => c.startsWith('insert:'))) return { data: { id: MSG, sender: { name: 'Dipak' } } };
    if (q[0] === 'from:users' && q.some((c) => c.startsWith('in:["username"'))) return { data: [{ id: D, username: 'rahul' }] };
    return { data: null };
  };
  it('K2-4 (703e1a7): a REJECTED insert is handled (logged), not left as an unhandled rejection', async () => {
    const warn = jest.spyOn(console, 'warn').mockImplementation(() => undefined);
    mockNext = world('throw');
    const r = await call(msgs.sendMessage, { params: { id: CHAT }, body: { text: 'hi @rahul' } });
    await flush();
    expect(r.statusCode).toBe(201);
    expect(warn).toHaveBeenCalledWith('[mention-notify] threw:', 'socket hang up');
  });
  it('K2-5a (e73f9e8): an insert that resolves with an error is logged, not dropped', async () => {
    const warn = jest.spyOn(console, 'warn').mockImplementation(() => undefined);
    mockNext = world('error');
    const r = await call(msgs.sendMessage, { params: { id: CHAT }, body: { text: 'hi @rahul' } });
    await flush();
    expect(r.statusCode).toBe(201);
    expect(warn).toHaveBeenCalledWith('[mention-notify] insert failed:', 'insert denied');
  });
});

describe('K2-6b · the chat list is paginated (SC-117)', () => {
  it('K2-6b (cdba317): chats are read with .range() from ?limit/?offset', async () => {
    mockNext = (q) => (q[0] === 'from:chat_participants' ? { data: [{ chat_id: CHAT }] } : { data: [] });
    await call(msgs.listChats, { query: { limit: '10', offset: '20' } });
    const c = mockLog.find((q) => q[0] === 'from:chats')!;
    expect(c.find((x) => x.startsWith('range:'))).toBe('range:[20,29]');
  });
});

describe('K2-10c · forward and batch-read arrays are capped (AUDIT-5)', () => {
  it('K2-10c (d02809c): forwarding to 21 chats → 400 before any query', async () => {
    const chat_ids = Array.from({ length: 21 }, () => CHAT);
    const r = await call(msgs.forwardMessage, { body: { message_id: MSG, chat_ids } });
    expect([r.statusCode, r.body.error]).toEqual([400, 'Too many chats (max 20)']);
    expect(mockLog).toHaveLength(0);
  });
  it('K2-10c (d02809c): marking 501 messages read → 400 before any query', async () => {
    const messageIds = Array.from({ length: 501 }, () => MSG);
    const r = await call(msgs.batchMarkRead, { body: { messageIds } });
    expect([r.statusCode, r.body.error]).toEqual([400, 'Too many messageIds (max 500)']);
    expect(mockLog).toHaveLength(0);
  });
});

describe('K2-48 · a block / privacy setting also gates an EXISTING 1:1 thread (SC-241) and reactions need membership (SC-242)', () => {
  const dm = (extra: (q: Q) => any = () => null) => (q: Q) => extra(q)
    ?? (q[0] === 'from:chats' ? { data: { is_group: false } }
      : q[0] === 'from:chat_participants' ? { data: [{ user_id: D }] }
        : q[0] === 'from:messages' && q.some((c) => c.startsWith('maybeSingle')) ? { data: { id: MSG, chat_id: CHAT, reactions: {} } }
          : { data: null });
  const inserts = () => mockLog.filter((q) => q[0] === 'from:messages' && q.some((c) => c.startsWith('insert:')));
  it('K2-48a (e816964): sending into an existing DM with a blocked counterpart → 403, nothing stored', async () => {
    mockBlockedPair = true;
    mockNext = dm();
    const r = await call(msgs.sendMessage, { params: { id: CHAT }, body: { text: 'hi' } });
    expect([r.statusCode, r.body.error]).toEqual([403, 'You can’t message this user.']);
    expect(inserts()).toHaveLength(0);
  });
  it('K2-48a (e816964): the recipient’s message_privacy "nobody" → 403; "followers" and I don’t follow → 403', async () => {
    mockNext = dm((q) => (q[0] === 'from:users' ? { data: { message_privacy: 'nobody' } } : null));
    expect((await call(msgs.sendMessage, { params: { id: CHAT }, body: { text: 'hi' } })).statusCode).toBe(403);
    mockNext = dm((q) => (q[0] === 'from:users' ? { data: { message_privacy: 'followers' } } : q[0] === 'from:follow_relationships' ? { data: null } : null));
    expect((await call(msgs.sendMessage, { params: { id: CHAT }, body: { text: 'hi' } })).statusCode).toBe(403);
    expect(inserts()).toHaveLength(0);
  });
  it('K2-48a (e816964): a GROUP chat is not gated by a block between two members', async () => {
    mockBlockedPair = true;
    mockNext = (q) => (q[0] === 'from:chats' ? { data: { is_group: true } }
      : q[0] === 'from:messages' && q.some((c) => c.startsWith('insert:')) ? { data: { id: MSG, sender: { name: 'D' } } } : { data: null });
    expect((await call(msgs.sendMessage, { params: { id: CHAT }, body: { text: 'hi' } })).statusCode).toBe(201);
  });
  it.each([['getMessages', 'getMessages'], ['markAsRead', 'markAsRead']])('K2-48b (e816964): %s on a blocked 1:1 → 403', async (_n, fn) => {
    mockBlockedPair = true;
    mockNext = dm();
    const r = await call((msgs as any)[fn], { params: { id: CHAT } });
    expect(r.statusCode).toBe(403);
  });
  it('K2-48b (e816964): batchMarkRead drops a blocked 1:1 chat from the set it marks', async () => {
    mockBlocked = new Set([D]);
    mockNext = (q) => (q[0] === 'from:chat_participants' && q.some((c) => c.startsWith('neq:')) ? { data: [{ chat_id: CHAT, user_id: D }] }
      : q[0] === 'from:chat_participants' ? { data: [{ chat_id: CHAT }] } : { data: [] });
    const r = await call(msgs.batchMarkRead, { body: { messageIds: [MSG] } });
    expect(r.body).toEqual({ success: true, updated: 0 });
    expect(mockLog.filter((q) => q[0] === 'from:messages')).toHaveLength(0);
  });
  it('K2-48c (e816964): reacting to a message in a chat I’m not in → 403, nothing written', async () => {
    mockMember = false;
    mockNext = dm();
    const r = await call(msgs.reactToMessage, { params: { messageId: MSG }, body: { emoji: '👍' } });
    expect([r.statusCode, r.body.error]).toEqual([403, 'Not a member of this chat']);
    expect(mockLog.filter((q) => q.some((c) => c.startsWith('update:')))).toHaveLength(0);
  });
  it('K2-48c (e816964): reacting in a blocked 1:1 → 403', async () => {
    mockBlockedPair = true;
    mockNext = dm();
    const r = await call(msgs.reactToMessage, { params: { messageId: MSG }, body: { emoji: '👍' } });
    expect(r.statusCode).toBe(403);
  });
});
