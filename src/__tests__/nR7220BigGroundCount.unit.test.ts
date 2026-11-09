/**
 * N-R7-220 (Step 2 Batch 9, RW-G4-057): a tournament with 3,00,00,00,128 boards
 * (ground_count 3000000128). No caps (Dipak): the count stays, but nothing builds
 * one entry per board — the scheduler marks only the boards it uses, and the
 * court board lists its courts a page at a time with the exact count.
 * 5,000,000,000 is past the longest array, so a one-per-board array throws at once.
 */
import { buildSchedule } from '../utils/scheduleFixtures';
import { courtsOf, courtCount, boardOf } from '../controllers/courtBoard.controller';

const BIG = 5_000_000_000;

test('the scheduler with more boards than an array can hold', () => {
  const fixtures = [1, 2, 3].map((n) => ({ round: 1, match_no: n, team_a_id: `a${n}`, team_b_id: `b${n}` }));
  const r = buildSchedule(fixtures as never, {
    startDateYmd: '2026-12-14', endDateYmd: '2026-12-14', dailyStartMin: 540, dailyEndMin: 600, durationMin: 30, bufferMin: 0,
    groundCount: BIG, groundNames: null, bounded: true, areaWord: 'Board',
    busyGrounds: [{ ground: 'Board 1', start: 540, end: 570 }, { ground: 'Board 4999999999', start: 540, end: 570 }],
  } as never);
  expect(r.ok).toBe(true);
  const labels = r.ok ? [...r.assignments.values()].map((a) => a.ground_label) : [];
  expect(labels).toEqual(['Board 2', 'Board 3', 'Board 4']); // Board 1 is another event's at 9:00
});

test('the scheduler still names boards as before', () => {
  const fixtures = [1, 2].map((n) => ({ round: 1, match_no: n, team_a_id: `a${n}`, team_b_id: `b${n}` }));
  const r = buildSchedule(fixtures as never, {
    startDateYmd: '2026-12-14', endDateYmd: '2026-12-14', dailyStartMin: 540, dailyEndMin: 600, durationMin: 30, bufferMin: 0,
    groundCount: 2, groundNames: ['Main'], bounded: true, areaWord: 'Board', busyGrounds: [{ ground: 'Main', start: 540, end: 570 }],
  } as never);
  expect(r.ok && [...r.assignments.values()].map((a) => [a.ground_label, a.scheduled_at])).toEqual([['Board 2', '2026-12-14T03:30:00.000Z'], ['Main', '2026-12-14T04:00:00.000Z']]);
});

test('the court board: an exact count, a page of courts', () => {
  const t = { ground_count: BIG, ground_names: ['Centre'] };
  expect(courtCount(t, ['Board 7', 'Lawn', null, 'Lawn'], 'carrom')).toBe(BIG + 1); // 'Board 7' is one of them; 'Lawn' isn't
  expect(courtsOf(t, ['Lawn'], 'carrom', 0, 3)).toEqual(['Centre', 'Board 2', 'Board 3']);
  expect(courtsOf(t, ['Lawn'], 'carrom', BIG - 1, 50)).toEqual(['Board 5000000000', 'Lawn']);
  expect(boardOf(courtsOf(t, [], 'carrom', 0, 2), [], new Map()).courts.map((c) => c.label)).toEqual(['Centre', 'Board 2']);
});
