/**
 * N-R7-S55 (Step 2 Batch 14, RW-G5-202) · a play invite from someone the receiver has blocked (or who
 * blocked them), or from an account that was since deleted, stayed in Received as 'pending' and could
 * be accepted (200, and the sender was told 'Tap to … set up a match'). Such an invite is no longer
 * offered: it leaves the Received list and its pending count, and accepting it is refused.
 */
type Q = string[];
let mockNext: (q: Q) => { data?: unknown; error?: unknown; count?: number } = () => ({ data: null, error: null });
const mockBlocked = new Set<string>();
jest.mock('../utils/supabase', () => {
  const start = (t: string) => {
    const q: string[] = [`from:${t}`];
    const chain: any = {};
    for (const m of ['select', 'in', 'not', 'eq', 'neq', 'is', 'gte', 'limit', 'maybeSingle', 'single', 'update', 'order', 'range']) {
      chain[m] = jest.fn((...a: unknown[]) => { q.push(`${m}:${JSON.stringify(a)}`); return chain; });
    }
    chain.then = (ok: (v: unknown) => unknown) => Promise.resolve(ok({ data: null, error: null, ...mockNext(q) }));
    return chain;
  };
  return { supabase: { from: jest.fn(start), rpc: jest.fn(async () => ({ data: null, error: null })) } };
});
jest.mock('../utils/blocks', () => ({
  ...jest.requireActual('../utils/blocks'),
  isBlockedBetween: jest.fn(async (a: string, b: string) => mockBlocked.has(a) || mockBlocked.has(b)),
  blockedUserIds: jest.fn(async () => new Set(mockBlocked)),
}));
jest.mock('../utils/notify', () => ({ notifyUser: jest.fn(), notifyUsers: jest.fn(), notifyUnlessBlocked: jest.fn(async () => undefined) }));
// eslint-disable-next-line import/first
import { listInvites, respondToInvite } from '../controllers/invites.controller';

const ME = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const FRIEND = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb'; const BLOCKED = 'cccccccc-cccc-4ccc-8ccc-cccccccccccc'; const GONE = 'dddddddd-dddd-4ddd-8ddd-dddddddddddd';
const now = new Date().toISOString();
const inv = (id: string, sender: string, deleted = false) => ({ id, sender_id: sender, receiver_id: ME, sport_id: 's', message: null, status: 'pending', created_at: now, responded_at: null, sender: { id: sender, name: deleted ? 'Deleted User' : 'X', username: null, profile_picture_url: null, deleted_at: deleted ? now : null }, sport: null });
const res = () => { const r: any = { statusCode: 200, body: null }; r.status = (c: number) => { r.statusCode = c; return r; }; r.json = (b: unknown) => { r.body = b; return r; }; return r; };
beforeEach(() => { mockBlocked.clear(); mockBlocked.add(BLOCKED); });

test('Received leaves out invites from a blocked account or a deleted one; the pending count agrees', async () => {
  mockNext = (q) => {
    if (q.some((c) => c.startsWith('range'))) return { data: [inv('1', FRIEND), inv('2', BLOCKED), inv('3', GONE, true)], count: 3 };
    return { data: [{ sender_id: FRIEND, sender: { deleted_at: null } }, { sender_id: BLOCKED, sender: { deleted_at: null } }, { sender_id: GONE, sender: { deleted_at: now } }], count: 3 };
  };
  const r = res();
  await listInvites({ userId: ME, query: {} } as any, r);
  expect(r.body.invites.map((i: { id: string }) => i.id)).toEqual(['1']);
  expect(r.body.pending_count).toBe(1);
});
test('accepting an invite from a blocked account is refused', async () => {
  mockNext = (q) => (q[0] === 'from:invites' && q.some((c) => c.startsWith('maybeSingle')) && !q.some((c) => c.startsWith('update'))
    ? { data: { created_at: now, status: 'pending', receiver_id: ME, sender_id: BLOCKED, sender: { deleted_at: null } } } : { data: { id: '2', status: 'accepted', sender_id: BLOCKED, sport_id: 's' } });
  const r = res();
  await respondToInvite({ userId: ME, params: { id: '2' }, body: { status: 'accepted' } } as any, r);
  expect(r.statusCode).toBe(403);
  expect(r.body).toEqual({ error: 'This invite is no longer available.', code: 'INVITE_UNAVAILABLE' });
});
test('accepting an invite from a deleted account is refused', async () => {
  mockNext = (q) => (q[0] === 'from:invites' && q.some((c) => c.startsWith('maybeSingle')) && !q.some((c) => c.startsWith('update'))
    ? { data: { created_at: now, status: 'pending', receiver_id: ME, sender_id: GONE, sender: { deleted_at: now } } } : { data: { id: '3', status: 'accepted', sender_id: GONE, sport_id: 's' } });
  const r = res();
  await respondToInvite({ userId: ME, params: { id: '3' }, body: { status: 'accepted' } } as any, r);
  expect(r.statusCode).toBe(403);
});
test('a friend’s invite is still accepted, and a blocked one can still be declined', async () => {
  mockNext = (q) => (q[0] === 'from:invites' && q.some((c) => c.startsWith('maybeSingle')) && !q.some((c) => c.startsWith('update'))
    ? { data: { created_at: now, status: 'pending', receiver_id: ME, sender_id: FRIEND, sender: { deleted_at: null } } } : { data: { id: '1', status: 'accepted', sender_id: FRIEND, sport_id: 's' } });
  const r = res();
  await respondToInvite({ userId: ME, params: { id: '1' }, body: { status: 'accepted' } } as any, r);
  expect(r.statusCode).toBe(200);
  mockNext = (q) => (q[0] === 'from:invites' && q.some((c) => c.startsWith('maybeSingle')) && !q.some((c) => c.startsWith('update'))
    ? { data: { created_at: now, status: 'pending', receiver_id: ME, sender_id: BLOCKED, sender: { deleted_at: null } } } : { data: { id: '2', status: 'declined', sender_id: BLOCKED, sport_id: 's' } });
  const d = res();
  await respondToInvite({ userId: ME, params: { id: '2' }, body: { status: 'declined' } } as any, d);
  expect(d.statusCode).toBe(200);
});
