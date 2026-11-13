/**
 * N-R7-409 (Step 2 Batch 14, SIDE-C6-4) · 'Already a member of this team' (409) also names the team
 * (team_id), so the app's Join team screen can offer 'Open team →' instead of leaving the person on
 * the code screen with no way to the team. Open and approval teams both.
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

const call = async (policy: string) => {
  mockNext = (q) => {
    if (q[0] === 'from:teams') return { data: { id: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', name: 'Pune XI', join_policy: policy, deleted_at: null, kind: 'club' } };
    if (q[0] === 'from:team_members' && q.some((c) => c.startsWith('maybeSingle'))) return { data: { id: 'm1' } };
    return { data: null, count: 0 };
  };
  const r: any = { statusCode: 200, body: null }; r.status = jest.fn((c: number) => { r.statusCode = c; return r; }); r.json = jest.fn((b: unknown) => { r.body = b; return r; });
  await joinTeamByCode({ userId: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb', body: { join_code: 'ABC123' }, params: {}, query: {}, headers: {} } as any, r);
  return r;
};

test.each(['open', 'approval'])('%s team, already a member: 409 names the team id', async (policy) => {
  const r = await call(policy);
  expect(r.statusCode).toBe(409);
  expect(r.body).toEqual({ error: 'Already a member of this team', team_id: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa' });
});
