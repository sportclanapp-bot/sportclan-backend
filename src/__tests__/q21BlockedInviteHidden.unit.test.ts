/**
 * Q21 (Dipak, 21 Nov 2026: A): a play invite from someone you blocked is hidden. The Received list
 * already leaves it out (N-R7-S55, nR7S55_invitesBlockedDeleted); blocking now also hides the
 * "sent you a play invite" notification, both ways, with the inbox's soft hide (hidden_at).
 * Supabase is a recording chain: every from() starts its own query.
 */
type Q = string[];
let mockLog: Q[] = [];
jest.mock('../utils/supabase', () => {
  const start = (t: string) => {
    const q: string[] = [`from:${t}`];
    mockLog.push(q);
    const chain: any = {};
    for (const m of ['select', 'insert', 'update', 'delete', 'eq', 'is', 'or', 'in', 'maybeSingle']) {
      chain[m] = jest.fn((...a: unknown[]) => { q.push(`${m}:${JSON.stringify(a)}`); return chain; });
    }
    chain.then = (ok: (v: unknown) => unknown, bad?: (e: unknown) => unknown) => Promise.resolve({ data: null, error: null }).then(ok, bad);
    return chain;
  };
  return { supabase: { from: jest.fn(start) } };
});
// eslint-disable-next-line import/first
import { blockUser } from '../controllers/users.controller';

const ME = '11111111-1111-4111-8111-111111111111';
const THEM = '22222222-2222-4222-8222-222222222222';
const res = () => { const r: any = { statusCode: 200 }; r.status = (c: number) => { r.statusCode = c; return r; }; r.json = (b: unknown) => { r.body = b; return r; }; return r; };

test('blocking hides the play-invite notifications between the two people, both ways (soft hide)', async () => {
  const r = res();
  await blockUser({ userId: ME, params: { id: THEM } } as any, r);
  expect(r.body).toEqual({ success: true });
  const hides = mockLog.filter((q) => q[0] === 'from:notifications');
  expect(hides).toHaveLength(2);
  for (const [to, from] of [[ME, THEM], [THEM, ME]]) {
    expect(hides).toContainEqual(expect.arrayContaining([
      expect.stringMatching(/^update:\[\{"hidden_at":"/),
      `eq:["user_id","${to}"]`, 'eq:["type","invite"]', `eq:["data->>sender_id","${from}"]`, 'is:["hidden_at",null]',
    ]));
  }
  expect(mockLog.some((q) => q[0] === 'from:notifications' && q.some((c) => c.startsWith('delete')))).toBe(false);
});
