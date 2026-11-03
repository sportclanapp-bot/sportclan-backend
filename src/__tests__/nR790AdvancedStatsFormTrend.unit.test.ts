/**
 * N-R7-90 (Step 2, Batch 6 · SP-TT-C27): the Advanced Stats form card said "▼ -9 · last 5
 * matches" and "▲ Rising · +5 over last 5" at once. The trajectory points carried only the
 * rating AFTER each match, so the sparkline started from match 1's new rating and lost
 * match 1's own change (-9 over 4 steps, labelled "last 5"), while netDelta5 summed all 5.
 * One definition now: a window's change = the rating after its last match minus the rating
 * before its first match; each trajectory point carries `from` (the rating before it).
 */
import { fakeDb } from './helpers/fakeSupabase';

let db = fakeDb();
jest.mock('../utils/supabase', () => ({ get supabase() { return db.client; } }));
jest.mock('../utils/sportId', () => ({ resolveSportId: jest.fn(async () => 's') }));
jest.mock('../utils/sportCache', () => ({ ...jest.requireActual('../utils/sportCache'), getSport: jest.fn(async () => ({ id: 's', slug: 'table-tennis' })) }));
jest.mock('../utils/blocks', () => ({ ...jest.requireActual('../utils/blocks'), isBlockedBetween: jest.fn(async () => false) }));
// eslint-disable-next-line import/first
import { getAdvancedStats } from '../controllers/advancedStats.controller';

const ME = '11111111-1111-4111-8111-111111111111';
const uuid = (i: number) => `00000000-0000-4000-8000-${String(i).padStart(12, '0')}`;

async function run(deltas: number[], start = 1200) {
  let r0 = start;
  const matches = deltas.map((_, i) => ({ id: uuid(i + 1), team_a_id: null, team_b_id: null, team_a_name: null, team_b_name: null, winner_team_id: null,
    scheduled_at: '2026-11-03T10:00:00Z', format: 'singles', city_id: null, voided_at: null }));
  const rating_history = deltas.map((d, i) => { const old = r0; r0 = +(r0 + d).toFixed(2);
    return { id: uuid(5000 + i), user_id: ME, sport_id: 's', match_id: matches[i]!.id, old_rating: old, new_rating: r0, delta: d,
      created_at: new Date(Date.UTC(2026, 10, 3, 10, i)).toISOString(), match: { id: matches[i]!.id, voided_at: null } }; });
  db = fakeDb({ users: [{ id: ME, deleted_at: null }], rating_history, user_sport_profiles: [{ user_id: ME, sport_id: 's', rating: r0 }], matches,
    match_participants: matches.map((m) => ({ match_id: m.id, user_id: ME, team_side: 'A' })) });
  const r: any = { statusCode: 200, body: null }; r.status = (c: number) => { r.statusCode = c; return r; }; r.json = (b: unknown) => { r.body = b; return r; }; r.setHeader = () => r; r.set = () => r;
  await getAdvancedStats({ userId: ME, params: {}, query: { sport_id: 'table-tennis' }, header: () => undefined, headers: {} } as any, r);
  expect(r.statusCode).toBe(200);
  return r.body.form;
}

test('5 ranked matches: the trajectory window and "over last 5" give the same change', async () => {
  const f = await run([14, -18, 15, 13, -19]); // the SP-TT-C27 player: 1200 → 1214 → 1196 → 1211 → 1224 → 1205
  expect(f.trajectory[0]).toMatchObject({ rating: 1214, from: 1200 });
  expect(f.trajectory.map((p: any) => p.rating - p.from)).toEqual([14, -18, 15, 13, -19]);
  const windowChange = f.trajectory[f.trajectory.length - 1].rating - f.trajectory[0].from;
  expect(windowChange).toBe(5);
  expect(f.netDelta5).toBe(windowChange);
  expect(f.trend).toBe('rising');
});

test('decimal ratings: "over last 5" is the whole-number end rating minus the whole-number start', async () => {
  const f = await run([0.4, 0.4, 0.4, 0.4, 0.4, 0.4, 0.4], 1200.3); // 1200.3 → … → 1203.1
  const last5 = f.trajectory.slice(-5);
  expect(f.netDelta5).toBe(last5[last5.length - 1].rating - last5[0].from);
});
