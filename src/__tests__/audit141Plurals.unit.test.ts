/** Audit #141 (11 Oct 2026): the server's counted strings at 1 and 2 — "1 fair-play points", "1 sets to win", "1 boards a game" and the rest. */
import fs from 'fs';
import path from 'path';
import { computedAwards } from '../controllers/awards.controller';
import { buildSchedule } from '../utils/scheduleFixtures';

test.each([-1, -2])('fair play at %i', (n) => {
  const out = computedAwards('football', [], new Map([['t1', n], ['t2', n - 5]]), ['t1', 't2'], new Map([['t1', 'Lions'], ['t2', 'Tigers']]));
  expect(out.find((a) => a.key === 'fair_play')?.value).toBe(n === -1 ? '-1 fair-play point' : '-2 fair-play points');
});

test.each([1, 2])('the schedule that can’t fit, at %i', (n) => {
  const fx = Array.from({ length: n + 1 }, (_, i) => ({ round: 1, match_no: i + 1, team_a_id: `a${i}`, team_b_id: `b${i}` }));
  const r = buildSchedule(fx as never, { startDateYmd: '2026-10-12', endDateYmd: '2026-10-12', dailyStartMin: 600, dailyEndMin: 600 + 60, durationMin: 60, bufferMin: 0, groundCount: n, groundNames: null, areaWord: 'Court', bounded: true });
  expect(r.ok).toBe(false);
  const e = (r as { error: string }).error;
  expect(e).toContain(`These ${n + 1} fixtures need ${n + 1} slots`);
  expect(e).toContain(n === 1 ? '(1 court at' : '(2 courts at');
  expect(e).toContain('across 1 day)');
  expect(e).toContain('Add a court');
});

test('the other server sites go through the helper', () => {
  const c = (f: string) => fs.readFileSync(path.join(__dirname, '../controllers', f), 'utf8');
  expect(c('courtBoard.controller.ts')).toContain("is running ${plural(minutes, 'minute')} late");
  expect(c('squads.controller.ts')).toContain("at most ${plural(size, 'player')} in this tournament");
  expect(c('tournaments.controller.ts')).toContain("${plural(ng, 'group')} need${ng === 1 ? 's' : ''} at least");
});
