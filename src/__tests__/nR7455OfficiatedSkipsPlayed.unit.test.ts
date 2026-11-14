/**
 * N-R7-455 (SIDE-A15-3, Batch 14 lane A15 on emulator-5558): an umpire who was also a participant
 * of one match he umpired saw 'Officiated 3 matches' on Profile but 'Played 1 · Officiated 2' in the
 * history it opens. The profile count now follows the history: played wins, byes don't count.
 */
const tables: Record<string, any[]> = {};
const chain = (table: string) => {
  const filters: Array<(r: any) => boolean> = [];
  const q: any = {
    select: () => q,
    eq: (c: string, v: unknown) => { filters.push((r) => r[c] === v); return q; },
    is: (c: string, v: unknown) => { filters.push((r) => (r[c] ?? null) === v); return q; },
    in: (c: string, v: unknown[]) => { filters.push((r) => v.includes(r[c])); return q; },
    order: () => q,
    range: (from: number, to: number) => Promise.resolve({ data: (tables[table] ?? []).filter((r) => filters.every((f) => f(r))).slice(from, to + 1), error: null }),
  };
  return q;
};
jest.mock('../utils/supabase', () => ({ supabase: { from: (t: string) => chain(t) } }));
// eslint-disable-next-line import/first
import { officiatedCount } from '../utils/officiated';

const m = (id: string, extra: Record<string, unknown> = {}) => ({ id, umpire_id: 'u', status: 'completed', voided_at: null, team_a_id: 'ta', team_b_id: 'tb', tournament_id: null, team_a_name: 'A', team_b_name: 'B', ...extra });

beforeEach(() => {
  tables.matches = [m('m1'), m('m2'), m('m3'), m('m4', { voided_at: '2026-11-01' }), m('m5', { status: 'live' }), m('m6', { team_b_id: null, tournament_id: 't1' }), m('x', { umpire_id: 'other' })];
  tables.match_participants = [{ match_id: 'm3', user_id: 'u' }, { match_id: 'm1', user_id: 'someone' }];
});

test('a match he umpired and played in counts as played, not officiated (3 → 2)', async () => {
  expect(await officiatedCount('u')).toBe(2);
});

test('no participation: every completed, not voided, non-bye umpired match', async () => {
  tables.match_participants = [];
  expect(await officiatedCount('u')).toBe(3);
});

test('nothing umpired: 0', async () => {
  expect(await officiatedCount('nobody')).toBe(0);
});

test('more than 1000 umpired matches are all counted', async () => {
  tables.matches = Array.from({ length: 1205 }, (_, i) => m(`k${i}`));
  tables.match_participants = [{ match_id: 'k1200', user_id: 'u' }];
  expect(await officiatedCount('u')).toBe(1204);
});
