/**
 * N-R7-138 (Step 2, Batch 8 · OBS-A2-1): after a result the clocks went back to the times stored at
 * each side's last move: Black resigning 40 s into its turn still read its old clock. The app now sends
 * the clock of the side to move with the result; the summary stops that clock there.
 */
import { fakeDb } from './helpers/fakeSupabase';

let db = fakeDb();
jest.mock('../utils/supabase', () => ({ get supabase() { return db.client; } }));
// eslint-disable-next-line import/first
import { recomputeSummary } from '../controllers/scoring.controller';

const S = 'cccccccc-cccc-4ccc-8ccc-cccccccccccc';
const ev = (i: number, event_type: string, payload: Record<string, unknown>, clock: number | null = null) => ({ id: `e${i}`, match_id: 'm1', seq: i, created_at: `2026-11-06T10:00:0${i}Z`, event_type, payload, clock_seconds: clock, period: null, deleted_at: null });
const seed = (moves: number, result: ReturnType<typeof ev>) => {
  const mv = [ev(1, 'move', { side: 'A' }, 290), ev(2, 'move', { side: 'B' }, 210), ev(3, 'move', { side: 'A' }, 280)].slice(0, moves);
  db = fakeDb({
    sports: [{ id: S, slug: 'chess', allows_draw: true }],
    matches: [{ id: 'm1', sport_id: S, score_summary: {}, format: 'Blitz · 5+0', overs: null, rules: null }],
    match_events: [...mv, { ...result, id: 'e9', seq: 9 }],
  });
};

test('Black resigns 40 s into its turn: clock_black 170, White as stored', async () => {
  seed(3, ev(9, 'result', { winner: 'white', reason: 'resignation' }, 170));
  const s = await recomputeSummary('m1', { persist: false });
  expect(s?.chess?.clock_black).toBe(170);
  expect(s?.chess?.clock_white).toBe(280);
});

test('a draw agreed on White\'s turn stops White\'s clock', async () => {
  seed(2, ev(9, 'result', { winner: 'draw', reason: 'draw_agreement' }, 250));
  const s = await recomputeSummary('m1', { persist: false });
  expect(s?.chess?.clock_white).toBe(250);
  expect(s?.chess?.clock_black).toBe(210);
});

test('a result with no clock (an older app) keeps the stored clocks; on time the loser is still 0', async () => {
  seed(3, ev(9, 'result', { winner: 'white', reason: 'resignation' }));
  expect((await recomputeSummary('m1', { persist: false }))?.chess?.clock_black).toBe(210);
  seed(3, ev(9, 'result', { winner: 'white', reason: 'timeout' }, 3));
  expect((await recomputeSummary('m1', { persist: false }))?.chess?.clock_black).toBe(0);
});
