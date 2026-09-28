/**
 * Phase 4 · K1 (backend fix commits) — blocks and chat membership on read and
 * write paths: SC-81/82 edge (public lists), like/comment across a block, and
 * the SC-94 forwardMessage IDOR. Harness in the style of phase3ChatB09.
 */
import fs from 'fs';
import path from 'path';

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
let mockMembers = new Set<string>();
jest.mock('../utils/chatMembership', () => ({
  isActiveMember: jest.fn(async (c: string, u: string) => mockMembers.has(`${c}:${u}`)),
  activeMembership: jest.fn(async () => null),
  joinChat: jest.fn(async () => undefined),
  leaveChat: jest.fn(async () => undefined),
  softDeleteChat: jest.fn(async () => undefined),
}));
let mockBlocked = new Set<string>();
let mockPairBlocked = false;
jest.mock('../utils/blocks', () => ({
  ...jest.requireActual('../utils/blocks'),
  blockedUserIds: jest.fn(async () => mockBlocked),
  isBlockedBetween: jest.fn(async () => mockPairBlocked),
  targetUserHidden: jest.fn(async () => false),
}));
jest.mock('../middleware/admin.middleware', () => ({ isAdminUser: jest.fn(async () => false) }));
jest.mock('../utils/testContent', () => ({
  hideTestFor: jest.fn(async () => false), excludeTest: jest.fn((q: unknown) => q),
  excludeTestEmbed: jest.fn((q: unknown) => q), testUserIdSet: jest.fn(async () => new Set()),
}));
jest.mock('../utils/notify', () => ({
  allowedRecipients: jest.fn(async (ids: string[]) => ids), sendPushToUsers: jest.fn(async () => undefined),
  notifyUser: jest.fn(), notifyUsers: jest.fn(), notifyUnlessBlocked: jest.fn(),
}));
jest.mock('../utils/chatPush', () => ({ ...jest.requireActual('../utils/chatPush'), pushChatMessage: jest.fn() }));

// eslint-disable-next-line import/first
import { getFollowers, getFollowing, getReviews } from '../controllers/users.controller';
// eslint-disable-next-line import/first
import { listReceivedKudos } from '../controllers/kudos.controller';
// eslint-disable-next-line import/first
import { likePost, createComment } from '../controllers/community.controller';
// eslint-disable-next-line import/first
import { forwardMessage } from '../controllers/messages.controller';

const ME = '11111111-1111-4111-8111-111111111111';
const OWNER = '22222222-2222-4222-8222-222222222222';
const BAD = '33333333-3333-4333-8333-333333333333';
const CHAT = '44444444-4444-4444-8444-444444444444';
const MSG = '55555555-5555-4555-8555-555555555555';
const SRC = '66666666-6666-4666-8666-666666666666';
const POST = '77777777-7777-4777-8777-777777777777';
const res = () => {
  const r: any = { statusCode: 200, body: null, setHeader: jest.fn() };
  r.status = jest.fn((c: number) => { r.statusCode = c; return r; });
  r.json = jest.fn((b: unknown) => { r.body = b; return r; });
  return r;
};
const call = async (fn: any, req: object) => { const r = res(); await fn({ userId: ME, params: {}, query: {}, body: {}, ...req }, r); return r; };
const writes = () => mockLog.filter((q) => q.some((c) => /^(insert|update|upsert|delete):/.test(c)));
const code = (rel: string) => fs.readFileSync(path.join(__dirname, '..', rel), 'utf8');

beforeEach(() => { mockLog = []; mockNext = () => ({ data: [], error: null }); mockMembers = new Set(); mockBlocked = new Set(); mockPairBlocked = false; });

describe('SC-81/82 edge · public lists leave out people the viewer has blocked', () => {
  test.each([
    ['followers', () => call(getFollowers, { params: { id: OWNER } }), 'follow_relationships', 'follower_id'],
    ['following', () => call(getFollowing, { params: { id: OWNER } }), 'follow_relationships', 'following_id'],
    ['reviews', () => call(getReviews, { params: { id: OWNER } }), 'user_reviews', 'reviewer_id'],
    ['kudos received', () => call(listReceivedKudos, { params: { userId: OWNER } }), 'kudos', 'from_user_id'],
  ])('K1-66 (abff690): %s filters the blocked ids out in the query', async (_n, run, table, col) => {
    mockBlocked = new Set([BAD]);
    const r = await run();
    expect(r.statusCode).toBe(200);
    const q = mockLog.find((x) => x[0] === `from:${table}`)!;
    expect(q.join(' ')).toContain(`not:["${col}","in","(${BAD})"]`);
  });
  test('K1-66 (abff690): the three public routes read the viewer (optionalAuth)', () => {
    const r = code('routes/users.routes.ts');
    for (const p of ['followers', 'following', 'reviews']) {
      expect(r).toContain(`router.get('/:id/${p}', optionalAuth,`);
    }
  });
});

describe('a blocked user cannot like or comment on the blocker’s posts', () => {
  beforeEach(() => {
    mockNext = (q) => (q[0] === 'from:community_posts' ? { data: { author_id: OWNER, deleted_at: null, scheduled_at: null } } : { data: null });
  });
  test('K1-67 (3937974): like across a block → 403 BLOCKED, no like written', async () => {
    mockPairBlocked = true;
    const r = await call(likePost, { params: { id: POST } });
    expect([r.statusCode, r.body]).toEqual([403, { error: 'BLOCKED' }]);
    expect(mockLog.some((q) => q[0] === 'from:post_likes')).toBe(false);
  });
  test('K1-67 (3937974): comment across a block → 403 BLOCKED, no comment written', async () => {
    mockPairBlocked = true;
    const r = await call(createComment, { params: { id: POST }, body: { content: 'nice game' } });
    expect([r.statusCode, r.body]).toEqual([403, { error: 'BLOCKED' }]);
    expect(mockLog.some((q) => q[0] === 'from:post_comments' && q.some((c) => c.startsWith('insert:')))).toBe(false);
  });
  test('K1-67 (3937974): control — no block, the like goes through', async () => {
    const r = await call(likePost, { params: { id: POST } });
    expect(r.statusCode).toBe(200);
    expect(mockLog.some((q) => q[0] === 'from:post_likes')).toBe(true);
  });
});

describe('SC-94 · forward needs membership of the source AND every target chat', () => {
  beforeEach(() => {
    mockNext = (q) => (q[0] === 'from:messages' && q.some((c) => c.startsWith('select:'))
      ? { data: { content: 'secret', image_url: null, chat_id: SRC, is_deleted: false, is_system: false } }
      : { data: [] });
  });
  test('K1-75a (dabb9a1): not in the source chat → 403, nothing inserted (no read of others’ messages)', async () => {
    mockMembers.add(`${CHAT}:${ME}`);
    const r = await call(forwardMessage, { body: { message_id: MSG, chat_ids: [CHAT] } });
    expect([r.statusCode, r.body.error]).toEqual([403, 'Not a member of the source chat']);
    expect(writes()).toHaveLength(0);
  });
  test('K1-75b (dabb9a1): not in a target chat → 403, nothing inserted (no inject)', async () => {
    mockMembers.add(`${SRC}:${ME}`);
    const r = await call(forwardMessage, { body: { message_id: MSG, chat_ids: [CHAT] } });
    expect([r.statusCode, r.body.error]).toEqual([403, 'Not a member of a target chat']);
    expect(writes()).toHaveLength(0);
  });
  test('K1-75c (dabb9a1): a DM target with a blocked person → 403, nothing inserted', async () => {
    mockMembers.add(`${SRC}:${ME}`); mockMembers.add(`${CHAT}:${ME}`);
    mockPairBlocked = true;
    const base = mockNext;
    mockNext = (q) => (q[0] === 'from:chat_participants' ? { data: [{ user_id: BAD }] } : base(q));
    const r = await call(forwardMessage, { body: { message_id: MSG, chat_ids: [CHAT] } });
    expect(r.statusCode).toBe(403);
    expect(writes()).toHaveLength(0);
  });
  test('K1-75 (dabb9a1): control — member of both → forwarded', async () => {
    mockMembers.add(`${SRC}:${ME}`); mockMembers.add(`${CHAT}:${ME}`);
    const r = await call(forwardMessage, { body: { message_id: MSG, chat_ids: [CHAT] } });
    expect(r.statusCode).toBe(200);
    expect(writes().some((q) => q[0] === 'from:messages')).toBe(true);
  });
});
