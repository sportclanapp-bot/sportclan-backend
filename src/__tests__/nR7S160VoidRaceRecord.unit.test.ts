/**
 * Step 2 Batch 14 · N-R7-S160 (SIDE-B13-1): three wins voided in the same few ms each read
 * the same record and wrote it back one lower (read-modify-write), so two wins stayed on the
 * Profile. The write now only lands on the row it read; a write that lost the race reads again.
 * The fake table below answers each read and write after a tick, like the real database would.
 */
type Row = Record<string, any>;
const mockTables: Record<string, Row[]> = {};
jest.mock('../utils/supabase', () => {
  const tick = () => new Promise((r) => setTimeout(r, 0));
  const from = (table: string) => {
    const f: Array<[string, unknown]> = [];
    let patch: Row | null = null;
    const match = () => (mockTables[table] ?? []).filter((r) => f.every(([k, v]) => r[k] === v));
    const run = async () => {
      await tick();
      if (!patch) return { data: match().map((r) => ({ ...r })), error: null };
      const hit = match();
      for (const r of hit) Object.assign(r, patch);
      return { data: hit.map((r) => ({ ...r })), error: null };
    };
    const q: any = {
      select: () => q,
      update: (p: Row) => { patch = p; return q; },
      eq: (k: string, v: unknown) => { f.push([k, v]); return q; },
      maybeSingle: async () => { const r = await run(); return { data: r.data[0] ?? null, error: null }; },
      then: (ok: (v: unknown) => unknown, bad?: (e: unknown) => unknown) => run().then(ok, bad),
    };
    return q;
  };
  return { supabase: { from } };
});
// eslint-disable-next-line import/first
import { applyRecordDeltas } from '../utils/matchVoid';
// eslint-disable-next-line import/first
import { applyChessTcDeltas } from '../utils/chessTcRatings';

const win = { user_id: 'u1', matches_played: 1, wins: 1, losses: 0, draws: 0, rating: 0 };

test('three wins voided at once take three wins off (not one)', async () => {
  mockTables.user_sport_profiles = [{ user_id: 'u1', sport_id: 'fb', rating: 1000, matches_played: 63, wins: 53, losses: 10, draws: 0 }];
  await Promise.all([1, 2, 3].map(() => applyRecordDeltas('fb', [win], -1)));
  expect(mockTables.user_sport_profiles[0]).toMatchObject({ matches_played: 60, wins: 50, losses: 10 });
});

test('a void and a restore at once leave the record where it was', async () => {
  mockTables.user_sport_profiles = [{ user_id: 'u1', sport_id: 'fb', rating: 1016.4, matches_played: 7, wins: 4, losses: 2, draws: 1 }];
  await Promise.all([applyRecordDeltas('fb', [{ ...win, rating: 16.4 }], -1), applyRecordDeltas('fb', [{ ...win, rating: 16.4 }], 1)]);
  expect(mockTables.user_sport_profiles[0]).toMatchObject({ matches_played: 7, wins: 4, rating: 1016.4 });
});

test('chess time-control ratings: two voids at once take both games off', async () => {
  mockTables.chess_rating_history = [
    { match_id: 'm1', user_id: 'u1', time_control: 'blitz', result: 'win', delta: 10 },
    { match_id: 'm2', user_id: 'u1', time_control: 'blitz', result: 'win', delta: 8 },
  ];
  mockTables.user_chess_ratings = [{ user_id: 'u1', time_control: 'blitz', rating: 1218, matches_played: 2, wins: 2, losses: 0, draws: 0 }];
  await Promise.all([applyChessTcDeltas('m1', -1), applyChessTcDeltas('m2', -1)]);
  expect(mockTables.user_chess_ratings[0]).toMatchObject({ matches_played: 0, wins: 0, rating: 1200 });
});
