/**
 * Found on the device during BUILD 1.13: an account in a few hundred chats
 * (tournament and match chats add up) got a 500 for its chat list and its
 * unread badge — live too — because every chat id went into one `.in()` in
 * the URL. Lists of ids are chunked now (utils/inChunks).
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

import * as msgs from '../controllers/messages.controller';
import { savePushToken } from '../controllers/notifications.controller';
import { logout } from '../controllers/auth.controller';
// eslint-disable-next-line import/first
import { IN_CHUNK, chunks } from '../utils/inChunks';

const ME = '11111111-1111-4111-8111-111111111111';
const D = '33333333-3333-4333-8333-333333333333';
const res = () => {
  const r: any = { statusCode: 200, body: null };
  r.status = jest.fn((c: number) => { r.statusCode = c; return r; });
  r.json = jest.fn((b: unknown) => { r.body = b; return r; });
  return r;
};
const call = async (fn: any, req: object) => { const r = res(); await fn({ userId: ME, params: {}, query: {}, body: {}, headers: {}, ...req }, r); return r; };
const has = (q: Q, s: string) => q.some((c) => c.includes(s));
const idAt = (i: number) => `00000000-0000-4000-8000-${String(i).padStart(12, '0')}`;
const N = 400;
const ALL = Array.from({ length: N }, (_, i) => idAt(i));
/** The biggest id list any query put in its filters. */
const biggestIn = () => Math.max(0, ...mockLog.flatMap((q) => q.filter((c) => c.startsWith('in:')).map((c) => (JSON.parse(c.slice(3))[1] as unknown[]).length)));
const inIds = (q: Q, col: string) => {
  const c = q.find((x) => x.startsWith(`in:["${col}"`));
  return c ? (JSON.parse(c.slice(3))[1] as string[]) : [];
};

beforeEach(() => {
  mockLog = [];
  mockMembers = new Set();
  mockBlocked = new Set();
  mockDead = new Set();
  jest.clearAllMocks();
});

describe('inChunks', () => {
  test('splits into slices of at most IN_CHUNK, in order', () => {
    const parts = chunks(ALL);
    expect(parts.map((p) => p.length)).toEqual([150, 150, 100]);
    expect(parts.flat()).toEqual(ALL);
    expect(chunks([])).toEqual([]);
  });
});

describe('a user in 400 chats', () => {
  test('the unread badge counts across every chunk, and no URL carries more than IN_CHUNK ids', async () => {
    mockNext = (q) => {
      if (q[0] === 'from:chat_participants') return { data: ALL.map((chat_id) => ({ chat_id })) };
      // One unread message in every 50th chat.
      if (q[0] === 'from:messages') return { data: inIds(q, 'chat_id').filter((_, i) => i % 50 === 0).map((chat_id) => ({ id: `m-${chat_id}`, chat_id, sender_id: D })) };
      return { data: [] };
    };
    const r = await call(msgs.getUnreadCount, {});
    expect(r.statusCode).toBe(200);
    expect(r.body).toEqual({ unread: 8, chats: 8, capped: false }); // 3 + 3 + 2
    expect(biggestIn()).toBeLessThanOrEqual(IN_CHUNK);
  });

  test('the chat list orders all 400 by last message, pages them, and counts them', async () => {
    // Chat i's last message is i minutes after midnight; every 7th has none.
    const at = (i: number) => (i % 7 === 0 ? null : new Date(Date.UTC(2026, 8, 29, 0, i)).toISOString());
    mockNext = (q) => {
      if (q[0] === 'from:chat_participants' && has(q, 'select:["chat_id"]')) return { data: ALL.map((chat_id) => ({ chat_id })) };
      if (q[0] === 'from:chats') {
        const ids = inIds(q, 'id');
        return { data: ids.map((id) => ({ id, last_message_at: at(Number(id.slice(-12))), name: `c${Number(id.slice(-12))}` })) };
      }
      return { data: [] };
    };
    const r = await call(msgs.listChats, { query: { limit: '5', offset: '0' } });
    expect(r.statusCode).toBe(200);
    expect(r.body.total).toBe(N);
    expect(r.body.has_more).toBe(true);
    // Newest first: 399 (399 % 7 = 0, so no message) is last; 398 leads.
    expect(r.body.chats.map((c: { name: string }) => c.name)).toEqual(['c398', 'c397', 'c396', 'c395', 'c394']);
    expect(biggestIn()).toBeLessThanOrEqual(IN_CHUNK);
    // The last page ends with the never-messaged chats.
    mockLog = [];
    const tail = await call(msgs.listChats, { query: { limit: '5', offset: String(N - 5) } });
    expect(tail.body.chats.map((c: { last_message_at: string | null }) => c.last_message_at)).toEqual([null, null, null, null, null]);
  });
});
