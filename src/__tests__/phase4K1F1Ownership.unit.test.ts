/**
 * Phase 4 · K1 (rows K1-38a/b/e) — SC-31 blocks are real, SC-32 a write that
 * touched nothing is a 404 (not a false 200), SC-35 only the sender can blank a
 * message. Supabase is mocked: each from() is its own query → mockNext(q).
 */
type Q = string[];
let mockLog: Q[] = [];
let mockNext: (q: Q) => { data?: unknown; error?: unknown; count?: number } = () => ({ data: null, error: null });
jest.mock('../utils/supabase', () => {
  const start = (t: string) => {
    const q: string[] = [`from:${t}`];
    mockLog.push(q);
    const chain: any = {};
    for (const m of ['select', 'in', 'not', 'eq', 'neq', 'is', 'limit', 'maybeSingle', 'single', 'update', 'delete', 'order', 'or', 'ilike', 'range', 'gte', 'gt', 'lt', 'upsert']) {
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
jest.mock('../utils/postVisibility', () => ({
  ...jest.requireActual('../utils/postVisibility'),
  postForWrite: jest.fn(async () => null),
  softDeletePost: jest.fn(async () => false),
  softDeleteComment: jest.fn(async () => false),
}));
jest.mock('../utils/notify', () => ({
  notifyUser: jest.fn(), notifyUsers: jest.fn(), notifyUnlessBlocked: jest.fn(), sendPushToUsers: jest.fn(),
  matchAudienceIds: jest.fn(async () => []), matchFollowerIds: jest.fn(async () => []),
}));

// eslint-disable-next-line import/first
import { followUser, getUserById } from '../controllers/users.controller';
// eslint-disable-next-line import/first
import { markRead, deleteNotification } from '../controllers/notifications.controller';
// eslint-disable-next-line import/first
import { revokeSession } from '../controllers/account.controller';
// eslint-disable-next-line import/first
import { deleteExpense } from '../controllers/teamExpenses.controller';
// eslint-disable-next-line import/first
import { deletePost, deleteComment, updatePost } from '../controllers/community.controller';
// eslint-disable-next-line import/first
import { deleteMessage, getOrCreateDM } from '../controllers/messages.controller';

const ME = '11111111-1111-4111-8111-111111111111';
const THEM = '22222222-2222-4222-8222-222222222222';
const X = '33333333-3333-4333-8333-333333333333';
const res = () => {
  const r: any = { statusCode: 200, body: null, setHeader: jest.fn() };
  r.status = jest.fn((c: number) => { r.statusCode = c; return r; });
  r.json = jest.fn((b: unknown) => { r.body = b; return r; });
  return r;
};
const call = async (fn: any, req: object) => {
  const r = res();
  await fn({ userId: ME, params: {}, query: {}, body: {}, headers: {}, get: () => undefined, header: () => undefined, ...req }, r);
  return r;
};
const writes = () => mockLog.filter((q) => q.some((c) => /^(insert|update|upsert|delete):/.test(c)));

beforeEach(() => { mockLog = []; mockNext = () => ({ data: null, error: null }); });

describe('K1-38a (5bb2119) · SC-31 a block works both ways', () => {
  const blocked = (q: Q) => (q[0] === 'from:user_blocks' ? { data: { id: 'b1' } }
    : q[0] === 'from:users' ? { data: { id: THEM, name: 'Them', username: 'them' } } : { data: null });
  it('K1-38a (5bb2119): following across a block → 403, no follow row', async () => {
    mockNext = blocked;
    const r = await call(followUser, { params: { id: THEM } });
    expect(r.statusCode).toBe(403);
    expect(mockLog.some((q) => q[0] === 'from:follow_relationships')).toBe(false);
    const b = mockLog.find((q) => q[0] === 'from:user_blocks')!.join(' ');
    expect(b).toContain(`and(blocker_id.eq.${ME},blocked_id.eq.${THEM})`);
    expect(b).toContain(`and(blocker_id.eq.${THEM},blocked_id.eq.${ME})`);
  });
  it('K1-38a (5bb2119): the profile across a block reads as not found', async () => {
    mockNext = blocked;
    const r = await call(getUserById, { params: { id: THEM } });
    expect(r.statusCode).toBe(404);
    expect(r.body).toEqual({ error: 'User not found' });
  });
});

describe('K1-38b (5bb2119) · SC-32 a write that matched no row is a 404', () => {
  it.each([
    ['markRead', markRead, { id: X }, 'Notification not found'],
    ['deleteNotification', deleteNotification, { id: X }, 'Notification not found'],
    ['revokeSession', revokeSession, { sessionId: X }, 'Session not found'],
    ['deletePost', deletePost, { id: X }, 'Post not found or not yours'],
    ['deleteComment', deleteComment, { commentId: X }, 'Comment not found or not yours'],
  ] as Array<[string, any, object, string]>)('K1-38b (5bb2119): %s on someone else\'s row → 404', async (_n, fn, params, error) => {
    mockNext = () => ({ data: [] });
    const r = await call(fn, { params });
    expect(r.statusCode).toBe(404);
    expect(r.body.error).toBe(error);
  });
  it('K1-38b (5bb2119): updatePost that updated nothing → 404, not a 200 with null', async () => {
    mockNext = () => ({ data: null });
    const r = await call(updatePost, { params: { id: X }, body: { content: 'edited text' } });
    expect(r.statusCode).toBe(404);
    expect(r.body.error).toBe('Post not found or not yours');
  });
  it('K1-38b (5bb2119): deleteExpense of a row that isn\'t there → 404, nothing deleted', async () => {
    mockNext = (q) => (q[0] === 'from:team_members' ? { data: { id: 'm1' } } : { data: null });
    const r = await call(deleteExpense, { params: { id: X, expenseId: THEM } });
    expect(r.statusCode).toBe(404);
    expect(writes().some((q) => q[0] === 'from:team_expenses')).toBe(false);
  });
});

describe('K1-38e (5bb2119) · SC-35 only the sender can delete a message', () => {
  it('K1-38e (5bb2119): the plain delete (no for_everyone) of someone else\'s message → 403, nothing written', async () => {
    mockNext = (q) => (q[0] === 'from:messages' ? { data: { sender_id: THEM, created_at: new Date().toISOString() } } : { data: null });
    const r = await call(deleteMessage, { params: { messageId: X }, body: {} });
    expect(r.statusCode).toBe(403);
    expect(writes()).toHaveLength(0);
  });
  it('K1-38e (5bb2119): the update itself is scoped to the sender', async () => {
    mockNext = (q) => (q[0] === 'from:messages' && !q.some((c) => c.startsWith('update:'))
      ? { data: { sender_id: ME, created_at: new Date().toISOString() } } : { data: [{ id: X }] });
    const r = await call(deleteMessage, { params: { messageId: X }, body: {} });
    expect(r.statusCode).toBe(200);
    expect(writes()[0].join(' ')).toContain(`eq:["sender_id","${ME}"]`);
  });
});

describe('K1-50d (34c2985) · SC-62 one DM per pair', () => {
  it('K1-50d (34c2985): losing the dm_key race (23505) hands back the winner\'s chat, not a 500', async () => {
    const [a, b] = [ME, THEM].sort();
    let keyedLookups = 0;
    mockNext = (q) => {
      if (q[0] === 'from:users') return { data: [{ id: THEM }] };
      if (q[0] === 'from:chats' && q.some((c) => c.startsWith('insert:'))) return { data: null, error: { code: '23505', message: 'duplicate key value violates unique constraint "uq_chats_dm_key"' } };
      if (q[0] === 'from:chats' && q.some((c) => c.includes('"dm_key"'))) {
        keyedLookups += 1;
        return { data: keyedLookups === 1 ? null : { id: 'winner-chat', is_group: false, dm_key: `${a}:${b}`, deleted_at: null } };
      }
      return { data: q[0] === 'from:chat_participants' ? [] : null };
    };
    const r = await call(getOrCreateDM, { body: { user_id: THEM } });
    expect(r.statusCode).toBe(200);
    expect(r.body.chat.id).toBe('winner-chat');
    const ins = mockLog.find((q) => q[0] === 'from:chats' && q.some((c) => c.startsWith('insert:')))!.join(' ');
    expect(ins).toContain(`"dm_key":"${a}:${b}"`);
  });
});
