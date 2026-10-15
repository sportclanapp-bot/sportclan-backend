/**
 * N-RWG4-6 (launch test plan, Round 4) · follower / following numbers still counted
 * accounts that were deleted, so a profile said 5 followers while the list showed 4.
 * The counts join the other account and skip deleted ones, as the lists do.
 * Supabase is a small stand-in that resolves the `u:<column>!inner(id)` join and the
 * `u.deleted_at` filter against a users table.
 */
const users: Record<string, { deleted_at: string | null }> = {};
let follows: Array<{ id: string; follower_id: string; following_id: string }> = [];
jest.mock('../utils/supabase', () => {
  const from = (table: string) => {
    let join: string | null = null;
    let liveOnly = false;
    const eqs: Array<[string, unknown]> = [];
    const b: any = {
      select(cols: string) { const m = /u:(\w+)!inner/.exec(cols); join = m ? m[1]! : null; return b; },
      eq(c: string, v: unknown) { eqs.push([c, v]); return b; },
      is(c: string, v: null) { if (c === 'u.deleted_at' && v === null) liveOnly = true; return b; },
      then(ok: (v: unknown) => unknown) {
        if (table !== 'follow_relationships') return Promise.resolve(ok({ data: null, count: 0 }));
        const rows = follows.filter((r) => eqs.every(([c, v]) => (r as any)[c] === v))
          .filter((r) => !join || ((r as any)[join] in users && (!liveOnly || !users[(r as any)[join]]!.deleted_at)));
        return Promise.resolve(ok({ data: null, count: rows.length }));
      },
    };
    return b;
  };
  return { supabase: { from } };
});
// eslint-disable-next-line import/first
import { followCounts } from '../controllers/users.controller';

test('a deleted follower (or followed account) is not counted', async () => {
  Object.assign(users, { g: { deleted_at: null }, a: { deleted_at: null }, b: { deleted_at: null }, gone: { deleted_at: '2026-10-10T00:00:00Z' } });
  follows = [
    { id: '1', follower_id: 'a', following_id: 'g' },
    { id: '2', follower_id: 'b', following_id: 'g' },
    { id: '3', follower_id: 'gone', following_id: 'g' },
    { id: '4', follower_id: 'g', following_id: 'a' },
    { id: '5', follower_id: 'g', following_id: 'gone' },
  ];
  expect(await followCounts('g')).toEqual([2, 1]);
});
