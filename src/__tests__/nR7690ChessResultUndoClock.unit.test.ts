/**
 * N-R7-690 (Step 2 FINAL, SP-CHS-026@B8): the app restarts the clock when a result is undone — a note
 * { kind: 'clock_resume', after: 'result' } with clock_seconds, the clock the result stopped the side
 * to move at. The summary (a viewer's CLOCKS card) takes that clock for the side to move; the viewer's
 * clock runs from the note. Before, it kept the clock of that side's last move.
 */
import { fakeDb } from './helpers/fakeSupabase';

let db = fakeDb();
jest.mock('../utils/supabase', () => ({ get supabase() { return db.client; } }));
// eslint-disable-next-line import/first
import { recomputeSummary } from '../controllers/scoring.controller';

const S = 'cccccccc-cccc-4ccc-8ccc-cccccccccccc';
const ev = (i: number, event_type: string, payload: Record<string, unknown>, clock: number | null = null) => ({ id: `e${i}`, match_id: 'm1', seq: i, created_at: `2026-11-06T10:00:0${i}Z`, event_type, payload, clock_seconds: clock, period: null, deleted_at: null });
const seed = (extra: Array<ReturnType<typeof ev>>) => {
  db = fakeDb({
    sports: [{ id: S, slug: 'chess', allows_draw: true }],
    matches: [{ id: 'm1', sport_id: S, score_summary: {}, format: 'Blitz · 3+2', overs: null, rules: null }],
    match_events: [ev(1, 'move', { side: 'A' }, 178), ev(2, 'move', { side: 'B' }, 172), ...extra],
  });
};

test('a result undone: White to move reads the clock the result stopped it at (150), Black as stored', async () => {
  seed([ev(4, 'note', { kind: 'clock_resume', after: 'result', played_at: 1, clock_ms: 150000 }, 150)]);
  const s = await recomputeSummary('m1', { persist: false });
  expect(s?.chess?.clock_white).toBe(150);
  expect(s?.chess?.clock_black).toBe(172);
  expect(s?.chess?.result ?? 'No result yet').toBe('No result yet');
});

test('a football-style clock_resume (no after) and a move after the restart behave as before', async () => {
  seed([ev(4, 'note', { kind: 'clock_resume' }, 99)]);
  expect((await recomputeSummary('m1', { persist: false }))?.chess?.clock_white).toBe(178);
  seed([ev(4, 'note', { kind: 'clock_resume', after: 'result' }, 150), ev(5, 'move', { side: 'A' }, 140)]);
  expect((await recomputeSummary('m1', { persist: false }))?.chess?.clock_white).toBe(140);
});
