/**
 * N-R7-S43 (Step 2 Batch 14, RW-R3C-047) · joining an open team by code when already in it answers
 * 409 'Already a member of this team' — the same status as an approval team, a racing second join
 * and adding an existing member. Before: the open-team path answered 400 for the same words.
 */
type Q = string[];
let mockNext: (q: Q) => { data?: unknown; error?: unknown; count?: number } = () => ({ data: null, error: null });
jest.mock('../utils/supabase', () => {
  const start = (t: string) => {
    const q: string[] = [`from:${t}`];
    const chain: any = {};
    for (const m of ['select', 'in', 'not', 'eq', 'neq', 'is', 'limit', 'maybeSingle', 'single', 'update', 'delete', 'order', 'or', 'ilike', 'range', 'gte', 'gt', 'lt', 'upsert', 'insert']) {
      chain[m] = jest.fn((...a: unknown[]) => { q.push(`${m}:${JSON.stringify(a)}`); return chain; });
    }
    chain.then = (ok: (v: unknown) => unknown) => Promise.resolve(ok({ data: null, error: null, ...mockNext(q) }));
    return chain;
  };
  return { supabase: { from: jest.fn(start), rpc: jest.fn(async () => ({ data: null, error: null })) } };
});
jest.mock('../utils/blocks', () => ({ ...jest.requireActual('../utils/blocks'), isBlockedBetween: jest.fn(async () => false), blockedUserIds: jest.fn(async () => new Set()) }));
jest.mock('../utils/notify', () => ({ notifyUser: jest.fn(), notifyUsers: jest.fn(), notifyUnlessBlocked: jest.fn(), sendPushToUsers: jest.fn(), allowedRecipients: jest.fn(async () => []) }));
// eslint-disable-next-line import/first
import { joinTeamByCode } from '../controllers/teams.controller';

test('open team, already a member: 409 Already a member of this team', async () => {
  mockNext = (q) => {
    if (q[0] === 'from:teams') return { data: { id: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', name: 'Pune XI', join_policy: 'open', deleted_at: null, kind: 'club' } };
    if (q[0] === 'from:team_members' && q.some((c) => c.startsWith('maybeSingle'))) return { data: { id: 'm1' } };
    return { data: null, count: 0 };
  };
  const r: any = { statusCode: 200, body: null }; r.status = jest.fn((c: number) => { r.statusCode = c; return r; }); r.json = jest.fn((b: unknown) => { r.body = b; return r; });
  await joinTeamByCode({ userId: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb', body: { join_code: 'ABC123' }, params: {}, query: {}, headers: {} } as any, r);
  expect(r.statusCode).toBe(409);
  expect(r.body).toEqual({ error: 'Already a member of this team' });
});
