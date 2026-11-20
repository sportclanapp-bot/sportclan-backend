/**
 * N-R7-S177 (Step 2 FINAL, RW-G6-240@B8): the arbiter's added time (add_time, and the opponent's minute for an
 * illegal move or a wrong draw claim) was in the scorer's pad clocks but not in the summary, so a viewer's CLOCKS
 * card (and the home card) read White 4:18 after the scorer gave White +1 min (pad 5:18) — until White's next
 * move, whose clock has it. The summary's clock now has the time added since that side's last move (or the
 * result's / restart's clock), as the app's chess ruleset counts it.
 */
import { fakeDb } from './helpers/fakeSupabase';

let db = fakeDb();
jest.mock('../utils/supabase', () => ({ get supabase() { return db.client; } }));
// eslint-disable-next-line import/first
import { recomputeSummary } from '../controllers/scoring.controller';

const S = 'cccccccc-cccc-4ccc-8ccc-cccccccccccc';
const ev = (i: number, event_type: string, payload: Record<string, unknown>, clock: number | null = null) => ({ id: `e${i}`, match_id: 'm1', seq: i, created_at: `2026-11-06T10:00:${String(i).padStart(2, '0')}Z`, event_type, payload, clock_seconds: clock, period: null, deleted_at: null });
const seed = (extra: Array<ReturnType<typeof ev>>) => {
  db = fakeDb({
    sports: [{ id: S, slug: 'chess', allows_draw: true }],
    matches: [{ id: 'm1', sport_id: S, score_summary: {}, format: 'Blitz · 5+0', overs: null, rules: null }],
    match_events: [ev(1, 'move', { side: 'A' }, 258), ev(2, 'move', { side: 'B' }, 282), ...extra],
  });
};
const clocks = async () => { const s = await recomputeSummary('m1', { persist: false }); return [s?.chess?.clock_white, s?.chess?.clock_black]; };

test("a wrong draw claim by Black gives White +60 s: White's clock reads 318, not 258", async () => {
  seed([ev(3, 'note', { kind: 'wrong_claim', side: 'B', seconds: 60 })]);
  expect(await clocks()).toEqual([318, 282]);
});

test('an illegal move by White gives Black the time; add_time goes to the side named; all add up', async () => {
  seed([ev(3, 'note', { kind: 'illegal_move', side: 'A', seconds: 120 })]);
  expect(await clocks()).toEqual([258, 402]);
  seed([ev(3, 'note', { kind: 'add_time', side: 'A', seconds: 30 }), ev(4, 'note', { kind: 'wrong_claim', side: 'B', seconds: 60 }), ev(5, 'note', { kind: 'add_time', side: 'B', seconds: 60 })]);
  expect(await clocks()).toEqual([348, 342]);
});

test("a move after the added time already has it (its clock): not counted twice", async () => {
  seed([ev(3, 'note', { kind: 'wrong_claim', side: 'B', seconds: 60 }), ev(4, 'note', { kind: 'add_time', side: 'B', seconds: 30 }), ev(5, 'move', { side: 'A' }, 310)]);
  expect(await clocks()).toEqual([310, 312]);
});

test('a result stops the side to move at its clock (time included); a timeout loser stays 0:00', async () => {
  seed([ev(3, 'note', { kind: 'add_time', side: 'A', seconds: 60 }), ev(4, 'result', { winner: 'black', reason: 'resignation' }, 300)]);
  expect(await clocks()).toEqual([300, 282]);
  seed([ev(3, 'note', { kind: 'add_time', side: 'A', seconds: 60 }), ev(4, 'result', { winner: 'black', reason: 'timeout' })]);
  expect(await clocks()).toEqual([0, 282]);
});

test("a side yet to move gets its start time plus the added time (5+0: 300 + 60)", async () => {
  db = fakeDb({
    sports: [{ id: S, slug: 'chess', allows_draw: true }],
    matches: [{ id: 'm1', sport_id: S, score_summary: {}, format: 'Blitz · 5+0', overs: null, rules: null }],
    match_events: [ev(1, 'move', { side: 'A' }, 290), ev(2, 'note', { kind: 'wrong_claim', side: 'A', seconds: 60 })],
  });
  expect(await clocks()).toEqual([290, 360]);
});
