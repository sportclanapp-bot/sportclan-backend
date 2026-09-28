/**
 * Dipak's decisions, group 1 (29 Sep 2026) — see the app repo's
 * phase3/DECISIONS.md, items 3, 5 and 8 (item 4 is app-only).
 *  3 · delete-for-everyone at any age (the app asks first);
 *  5 · "Who can message you" also decides who can add you to a group;
 *  8 · a password reset signs every device out.
 * Supabase is mocked the way phase3ChatB09 mocks it: each query resolves to
 * `mockNext(q)`, where `q` lists that query's builder calls.
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
let mockMembers = new Set<string>();
jest.mock('../utils/chatMembership', () => ({
  isActiveMember: jest.fn(async (c: string, u: string) => mockMembers.has(`${c}:${u}`)),
  activeMembership: jest.fn(async () => null),
  joinChat: jest.fn(async (c: string, ms: Array<{ user_id: string }>) => { for (const m of ms) mockMembers.add(`${c}:${m.user_id}`); }),
  leaveChat: jest.fn(async () => undefined),
  softDeleteChat: jest.fn(async () => undefined),
}));
jest.mock('../utils/blocks', () => ({
  ...jest.requireActual('../utils/blocks'),
  blockedUserIds: jest.fn(async () => new Set()),
  isBlockedBetween: jest.fn(async () => false),
}));
jest.mock('../utils/activeUser', () => ({ deletedIdSet: jest.fn(async () => new Set()) }));
jest.mock('../utils/chatPush', () => ({ ...jest.requireActual('../utils/chatPush'), pushChatMessage: jest.fn() }));
jest.mock('../utils/tagPrivacy', () => ({ taggableBy: jest.fn(async () => []) }));
jest.mock('../utils/notify', () => ({
  allowedRecipients: jest.fn(async (ids: string[]) => ids),
  sendPushToUsers: jest.fn(async () => undefined),
  notifyUser: jest.fn(),
}));
jest.mock('../utils/testContent', () => ({ testUserIdSet: jest.fn(async () => new Set()) }));
jest.mock('../utils/sessionRevocation', () => ({ revokeSessionsNow: jest.fn(async () => Date.now()) }));
jest.mock('../utils/otpCheck', () => ({
  ...jest.requireActual('../utils/otpCheck'),
  checkOtpCode: jest.fn(async () => 'ok'),
}));
jest.mock('../utils/otpStore', () => ({
  setOtp: jest.fn(), getOtp: jest.fn(), deleteOtp: jest.fn(async () => undefined),
  bumpCounter: jest.fn(async () => 1), readCounter: jest.fn(async () => 0), clearCounter: jest.fn(),
}));

// eslint-disable-next-line import/first
import fs from 'fs';
// eslint-disable-next-line import/first
import path from 'path';
// eslint-disable-next-line import/first
import * as msgs from '../controllers/messages.controller';
// eslint-disable-next-line import/first
import { resetPassword } from '../controllers/auth.controller';
// eslint-disable-next-line import/first
import { revokeSessionsNow } from '../utils/sessionRevocation';
// eslint-disable-next-line import/first
import { joinChat } from '../utils/chatMembership';

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

beforeEach(() => {
  mockLog = [];
  mockNext = () => ({ data: null, error: null });
  mockMembers = new Set();
  jest.clearAllMocks();
});

describe('3 · delete for everyone, at any age', () => {
  const DAY = 86400000;
  test.each([[true], [false], [undefined]])('a day-old message with for_everyone=%s is blanked for everyone', async (forEveryone) => {
    mockNext = (q) => {
      if (q[0] === 'from:messages' && has(q, 'select:["sender_id, created_at"]')) {
        return { data: { sender_id: ME, created_at: new Date(Date.now() - DAY).toISOString() } };
      }
      if (q[0] === 'from:messages' && has(q, 'update:')) return { data: [{ id: MSG }] };
      return { data: null };
    };
    const r = await call(msgs.deleteMessage, { params: { messageId: MSG }, body: forEveryone === undefined ? undefined : { for_everyone: forEveryone } });
    expect(r.statusCode).toBe(200);
    expect(r.body).toEqual({ success: true });
    expect(writes()[0].join()).toContain('"is_deleted":true');
  });
  test('still only the sender', async () => {
    mockNext = (q) => ({ data: q[0] === 'from:messages' ? { sender_id: C, created_at: new Date().toISOString() } : null });
    const r = await call(msgs.deleteMessage, { params: { messageId: MSG }, body: { for_everyone: true } });
    expect(r.statusCode).toBe(403);
    expect(writes()).toHaveLength(0);
  });
  test('no age window left in the code', () => {
    const src = fs.readFileSync(path.join(__dirname, '..', 'controllers', 'messages.controller.ts'), 'utf8');
    expect(src).not.toMatch(/window has passed/);
  });
});

describe('5 · "Who can message you" also decides who can add you to a group', () => {
  /** users → C's and D's privacy; follows → who ME follows. */
  const world = (privacy: Record<string, string | null>, iFollow: string[] = []) => (q: Q) => {
    if (q[0] === 'from:users') return { data: Object.keys(privacy).map((id) => ({ id, name: id === C ? 'Asha' : 'Ravi', message_privacy: privacy[id] })) };
    if (q[0] === 'from:follow_relationships') return { data: iFollow.map((following_id) => ({ following_id })) };
    if (q[0] === 'from:user_blocks') return { data: [] };
    if (q[0] === 'from:chats') return { data: { id: CHAT, is_group: true } };
    return { data: null };
  };
  test('create: someone who accepts nobody → 403, named, nothing written', async () => {
    mockNext = world({ [C]: 'everyone', [D]: 'nobody' });
    const r = await call(msgs.createGroup, { body: { name: 'P3', member_ids: [C, D] } });
    expect(r.statusCode).toBe(403);
    expect(r.body).toEqual({ error: 'Ravi isn’t accepting messages, so they can’t be added to a group.', code: 'MESSAGE_PRIVACY' });
    expect(writes()).toHaveLength(0);
  });
  test('create: followers-only, and I don\'t follow them → 403', async () => {
    mockNext = world({ [C]: 'followers', [D]: null });
    const r = await call(msgs.createGroup, { body: { name: 'P3', member_ids: [C, D] } });
    expect(r.statusCode).toBe(403);
    expect(r.body.error).toBe('Asha only accepts messages from people who follow them, so you can’t add them to a group.');
    expect(writes()).toHaveLength(0);
  });
  test('create: followers-only and I follow them, or everyone → the group is made', async () => {
    mockNext = world({ [C]: 'followers', [D]: 'everyone' }, [C]);
    const r = await call(msgs.createGroup, { body: { name: 'P3', member_ids: [C, D] } });
    expect(r.statusCode).toBe(201);
    expect(mockLog.find((q) => has(q, 'from:follow_relationships'))!.join()).toContain(`eq:["follower_id","${ME}"]`);
  });
  const admin = (q: Q) => (q[0] === 'from:chat_participants' && has(q, 'select:["role"]') ? { data: { role: 'admin' } } : null);
  test('add: nobody → 403, never joined, no system line', async () => {
    const base = world({ [D]: 'nobody' });
    mockNext = (q) => admin(q) ?? { ...base(q), count: 2 };
    const r = await call(msgs.addMember, { params: { id: CHAT }, body: { user_id: D } });
    expect(r.statusCode).toBe(403);
    expect(r.body.code).toBe('MESSAGE_PRIVACY');
    expect(joinChat).not.toHaveBeenCalled();
    expect(mockLog.some((q) => q[0] === 'from:messages')).toBe(false);
  });
  test('add: everyone → added', async () => {
    const base = world({ [D]: 'everyone' });
    mockNext = (q) => admin(q) ?? { ...base(q), count: 2 };
    const r = await call(msgs.addMember, { params: { id: CHAT }, body: { user_id: D } });
    expect(r.statusCode).toBe(200);
    expect(joinChat).toHaveBeenCalledWith(CHAT, [{ user_id: D, role: 'member' }]);
  });
});

describe('8 · a password reset signs every device out', () => {
  const body = { phone: '9000000006', code: '123456', newPassword: 'longenough1' };
  test('refresh tokens deleted, access tokens revoked, push tokens gone', async () => {
    mockNext = (q) => ({ data: q[0] === 'from:users' && has(q, 'update:') ? [{ id: C }] : null });
    const r = await call(resetPassword, { body });
    expect(r.body).toEqual({ success: true });
    expect(mockLog.some((q) => q[0] === 'from:refresh_tokens' && has(q, 'delete:') && has(q, `eq:["user_id","${C}"]`))).toBe(true);
    expect(mockLog.some((q) => q[0] === 'from:push_tokens' && has(q, 'delete:') && has(q, `eq:["user_id","${C}"]`))).toBe(true);
    expect(revokeSessionsNow).toHaveBeenCalledWith(C);
  });
  test('no account → 404, nobody signed out', async () => {
    mockNext = () => ({ data: [] });
    const r = await call(resetPassword, { body });
    expect(r.statusCode).toBe(404);
    expect(revokeSessionsNow).not.toHaveBeenCalled();
    expect(mockLog.some((q) => q[0] === 'from:refresh_tokens')).toBe(false);
  });
});
