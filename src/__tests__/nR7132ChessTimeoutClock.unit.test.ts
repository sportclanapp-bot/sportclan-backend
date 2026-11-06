/**
 * N-R7-132 (Step 2, Batch 8 · SP-CHS-S01): Black lost on time, but the summary's clock_black was the
 * time stored at Black's last move (Match detail CLOCKS read 3:30). A game lost on time ends at 0:00.
 */
import { fakeDb } from './helpers/fakeSupabase';

let db = fakeDb();
jest.mock('../utils/supabase', () => ({ get supabase() { return db.client; } }));
// eslint-disable-next-line import/first
import { recomputeSummary } from '../controllers/scoring.controller';

const S = 'cccccccc-cccc-4ccc-8ccc-cccccccccccc';
const ev = (i: number, event_type: string, payload: Record<string, unknown>, clock: number | null = null) => ({ id: `e${i}`, match_id: 'm1', seq: i, created_at: `2026-11-06T10:00:0${i}Z`, event_type, payload, clock_seconds: clock, period: null, deleted_at: null });
const seed = (reason: string) => {
  db = fakeDb({
    sports: [{ id: S, slug: 'chess', allows_draw: true }],
    matches: [{ id: 'm1', sport_id: S, score_summary: {}, format: 'Blitz · 5+0', overs: null, rules: null }],
    match_events: [ev(1, 'move', { side: 'A' }, 290), ev(2, 'move', { side: 'B' }, 210), ev(3, 'move', { side: 'A' }, 280), ev(4, 'result', { winner: 'white', reason })],
  });
};

test('White wins on time: clock_black 0, clock_white as stored', async () => {
  seed('timeout');
  const s = await recomputeSummary('m1', { persist: false });
  expect(s?.chess?.clock_black).toBe(0);
  expect(s?.chess?.clock_white).toBe(280);
});

test('a resignation keeps the stored clocks', async () => {
  seed('resignation');
  const s = await recomputeSummary('m1', { persist: false });
  expect(s?.chess?.clock_black).toBe(210);
});
