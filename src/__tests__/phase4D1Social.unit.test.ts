/**
 * Phase 4 · D1 — social bugs from WORKING_NOTES fixed in non-fix commits:
 *  SC-204/205/206 (06ef37e): like / follow / gift never notified anyone
 *  SC-207 · SC-96s (a7f0fe6): gift, comment reaction, poll vote, review and kudos
 *                              went through a block
 *  SC-208 (a7f0fe6): a report on content that doesn't exist was accepted
 *  SC-324 (5f550a1): anyone could review anyone, players included
 *
 * Supabase is a table-routed fake: every query on table T resolves to
 * mockTable[T] (a value or a function of the query's call log). Writes and RPCs
 * are recorded.
 */
type Res = { data?: unknown; error?: unknown; count?: number };
let mockTable: Record<string, Res | ((log: string[]) => Res)> = {};
let mockWrites: string[] = [];
let mockRpcs: string[] = [];
jest.mock('../utils/supabase', () => {
  const make = (table: string) => {
    const log: string[] = [];
    const q: any = {};
    for (const m of ['select', 'eq', 'neq', 'is', 'in', 'gt', 'gte', 'lt', 'lte', 'order', 'range', 'or', 'not', 'limit', 'filter']) {
      q[m] = jest.fn((...a: unknown[]) => { log.push(`${m}:${JSON.stringify(a)}`); return q; });
    }
    for (const m of ['insert', 'update', 'upsert', 'delete']) {
      q[m] = jest.fn((...a: unknown[]) => { log.push(`${m}:${JSON.stringify(a)}`); mockWrites.push(`${table}.${m}`); return q; });
    }
    const result = (): Res => {
      const t = mockTable[table];
      return (typeof t === 'function' ? t(log) : t) ?? { data: null, error: null };
    };
    q.single = jest.fn(async () => result());
    q.maybeSingle = jest.fn(async () => result());
    q.then = (ok: (v: unknown) => unknown, bad?: (e: unknown) => unknown) => Promise.resolve(result()).then(ok, bad);
    return q;
  };
  return {
    supabase: {
      from: jest.fn((t: string) => make(t)),
      rpc: jest.fn((name: string) => { mockRpcs.push(name); return make(`rpc:${name}`); }),
    },
  };
});
let mockBlocked = false;
let mockBlockedIds: string[] = [];
jest.mock('../utils/blocks', () => ({
  ...jest.requireActual('../utils/blocks'),
  isBlockedBetween: jest.fn(async () => mockBlocked),
  blockedUserIds: jest.fn(async () => new Set(mockBlockedIds)),
}));
const mockNotify = jest.fn(async (..._a: unknown[]) => undefined);
jest.mock('../utils/notify', () => ({
  ...jest.requireActual('../utils/notify'),
  notifyUsers: (...a: unknown[]) => mockNotify(...a),
  notifyUser: jest.fn(async () => undefined),
}));
jest.mock('../controllers/badges.controller', () => ({ awardBadgesSafe: jest.fn(async () => undefined) }));

// eslint-disable-next-line import/first
import { sendGift } from '../controllers/gifts.controller';
// eslint-disable-next-line import/first
import { sendKudos } from '../controllers/kudos.controller';
// eslint-disable-next-line import/first
import { likePost, reactToComment, votePoll, reportContent } from '../controllers/community.controller';
// eslint-disable-next-line import/first
import { followUser, submitReview } from '../controllers/users.controller';
// eslint-disable-next-line import/first
import { addMember } from '../controllers/messages.controller';

const ME = '11111111-1111-4111-8111-111111111111';
const THEM = '22222222-2222-4222-8222-222222222222';
const POST = '33333333-3333-4333-8333-333333333333';
const res = () => {
  const r: any = { statusCode: 200, body: null };
  r.status = jest.fn((c: number) => { r.statusCode = c; return r; });
  r.json = jest.fn((b: unknown) => { r.body = b; return r; });
  return r;
};
const call = async (fn: any, req: object) => { const r = res(); await fn({ userId: ME, params: {}, query: {}, body: {}, headers: {}, ...req }, r); return r; };
const settle = async () => { for (let i = 0; i < 5; i++) await new Promise((r) => setTimeout(r, 0)); };

beforeEach(() => {
  mockTable = {};
  mockWrites = [];
  mockRpcs = [];
  mockBlocked = false;
  mockBlockedIds = [];
  mockNotify.mockClear();
});

describe('notifications (SC-204/205/206, 06ef37e)', () => {
  test('SC-204 (06ef37e): a new like notifies the post author', async () => {
    mockTable = { community_posts: { data: { author_id: THEM } }, post_likes: { data: [{ user_id: ME }], error: null, count: 1 }, notifications: { data: [] }, users: { data: { name: 'Me' } } };
    const r = await call(likePost, { params: { id: POST } });
    await settle();
    expect(r.body).toEqual({ liked: true });
    expect(mockNotify).toHaveBeenCalledWith([THEM], expect.objectContaining({ type: 'like' }), { actorId: ME });
  });

  test('SC-205 (06ef37e): a new follow notifies the followed user', async () => {
    mockTable = { user_blocks: { data: null }, users: { data: { id: THEM, name: 'Me' } }, follow_relationships: { data: null, error: null } };
    await call(followUser, { params: { id: THEM } });
    await settle();
    expect(mockNotify).toHaveBeenCalledWith([THEM], expect.objectContaining({ type: 'follow' }), { actorId: ME });
  });

  test('SC-206 (06ef37e): a sent gift notifies the receiver', async () => {
    mockTable = {
      users: (log) => (log.some((c) => c.includes('coin_balance')) ? { data: { coin_balance: 999, name: 'Me' } } : { data: { id: THEM } }),
      'rpc:send_gift': { data: { status: 'sent', gift: { id: 'g1' }, new_balance: 990 } },
    };
    const r = await call(sendGift, { body: { receiverId: THEM, giftId: 'flowers' } });
    await settle();
    expect(r.statusCode).toBe(200);
    expect(mockNotify).toHaveBeenCalledWith([THEM], expect.objectContaining({ type: 'gift' }), { actorId: ME });
  });
});

describe('block gates (SC-207, SC-96s, a7f0fe6)', () => {
  test('SC-207 (a7f0fe6): a blocked user cannot gift the blocker — refused before any coins move', async () => {
    mockBlocked = true;
    const r = await call(sendGift, { body: { receiverId: THEM, giftId: 'flowers' } });
    expect(r.statusCode).toBe(403);
    expect(mockRpcs).toEqual([]);
  });

  test('SC-96s (a7f0fe6): reacting to a blocked user\'s comment → 403, nothing written', async () => {
    mockBlocked = true;
    mockTable = { post_comments: { data: { reactions: {}, author_id: THEM, post_id: POST } }, community_posts: { data: { author_id: THEM } } };
    const r = await call(reactToComment, { params: { commentId: POST }, body: { emoji: '❤️' } });
    expect([r.statusCode, r.body]).toEqual([403, { error: 'BLOCKED' }]);
    expect(mockWrites).toEqual([]);
  });

  test('SC-96s (a7f0fe6): voting in a blocked user\'s poll → 403', async () => {
    mockBlocked = true;
    mockTable = { community_posts: { data: { author_id: THEM, poll_options: [{ id: 'o1' }] } } };
    const r = await call(votePoll, { params: { id: POST }, body: { option_id: 'o1' } });
    expect([r.statusCode, r.body]).toEqual([403, { error: 'BLOCKED' }]);
  });

  test('SC-96s (a7f0fe6): reviewing or sending kudos across a block → 403', async () => {
    mockBlocked = true;
    mockTable = { user_account_types: { data: [{ account_type: 'coach' }] }, match_participants: { data: [{ user_id: ME }, { user_id: THEM }] } };
    const review = await call(submitReview, { params: { id: THEM }, body: { rating: 5 } });
    expect([review.statusCode, review.body]).toEqual([403, { error: 'You can’t review this user.' }]);
    const kudos = await call(sendKudos, { body: { toUserId: THEM, matchId: POST } });
    expect([kudos.statusCode, kudos.body]).toEqual([403, { error: 'You can’t send kudos to this user.' }]);
    expect(mockWrites).toEqual([]);
  });
});

describe('group add (SC-96s, a7f0fe6)', () => {
  test('SC-96s (a7f0fe6): adding someone to a group where a member blocked them → 403 BLOCKED_FROM_GROUP', async () => {
    const OTHER = '44444444-4444-4444-8444-444444444444';
    mockBlockedIds = [OTHER];
    mockTable = {
      chats: { data: { is_group: true } },
      users: { data: [{ id: THEM }] },
      chat_participants: (log) => (log.some((c) => c.includes('"role"')) ? { data: { role: 'admin' } }
        : log.some((c) => c.includes('"count"')) ? { data: null, count: 3 }
        : { data: [{ user_id: ME }, { user_id: OTHER }] }),
    };
    const r = await call(addMember, { params: { id: POST }, body: { user_id: THEM } });
    expect([r.statusCode, r.body.code]).toEqual([403, 'BLOCKED_FROM_GROUP']);
    expect(mockWrites).toEqual([]);
  });
});

describe('reports (SC-208, a7f0fe6)', () => {
  test('SC-208 (a7f0fe6): reporting a user that does not exist → 404, no report row', async () => {
    mockTable = { users: { data: null }, content_reports: { data: null } };
    const r = await call(reportContent, { body: { target_type: 'user', target_id: THEM, reason: 'spam' } });
    expect(r.statusCode).toBe(404);
    expect(mockWrites).toEqual([]);
  });
});

describe('the review gate (SC-324, 5f550a1)', () => {
  test('SC-324 (5f550a1): a player-only profile cannot be reviewed', async () => {
    mockTable = { user_account_types: { data: [{ account_type: 'player' }] } };
    const r = await call(submitReview, { params: { id: THEM }, body: { rating: 1 } });
    expect([r.statusCode, r.body.code]).toEqual([403, 'REVIEW_PLAYER_NOT_REVIEWABLE']);
    expect(mockWrites).toEqual([]);
  });

  test('SC-324 (5f550a1): an umpire can be reviewed only by someone who played under them', async () => {
    mockTable = { user_account_types: { data: [{ account_type: 'umpire' }] }, match_participants: { data: [] } };
    const r = await call(submitReview, { params: { id: THEM }, body: { rating: 1 } });
    expect([r.statusCode, r.body.code]).toEqual([403, 'REVIEW_NOT_ELIGIBLE']);
    mockTable.match_participants = { data: [{ match_id: 'm1' }] };
    mockTable.user_reviews = { data: { id: 'rv1' } };
    const ok = await call(submitReview, { params: { id: THEM }, body: { rating: 4 } });
    expect(ok.statusCode).toBe(200);
  });
});
