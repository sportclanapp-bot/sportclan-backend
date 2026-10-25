/**
 * N-R7-S51 (Step 2 Batch 7, SPP1-PKB-141): after TIME CALLED at 6-6 (the next point wins), a technical
 * foul took a point off Lions (5-6) and the match stayed open — the point off skipped the buzzer check
 * (rollupSets; the side-out core's replay). Tigers now lead and win, as after a point.
 */
import { rollupSets } from '../controllers/scoring.controller';
import { setConfigOf, standardRules } from '../utils/matchRules';
import { sideOutReplay } from '../utils/pickleballCore';

const sideOf = (p: any): 'A' | 'B' => (p?.team_side === 'B' ? 'B' : 'A');
const pt = (side: 'A' | 'B', n = 1) => Array.from({ length: n }, () => ({ event_type: 'score', payload: { team_side: side, kind: 'point', value: 1 } }));
const buzzer = { event_type: 'note', payload: { kind: 'buzzer' } };
const off = (side: 'A' | 'B') => ({ event_type: 'note', payload: { kind: 'point_off', team_side: side } });
const cfg = setConfigOf({ ...standardRules('pickleball') });

test('rally scoring: 6-6, time called, a point off Lions → Tigers win', () => {
  expect(rollupSets(cfg, [...pt('A', 6), ...pt('B', 6), buzzer], sideOf, { level: 'next_point' }).decided).toBeNull();
  const r = rollupSets(cfg, [...pt('A', 6), ...pt('B', 6), buzzer, off('A')], sideOf, { level: 'next_point' });
  expect(r.decided).toBe('B');
  expect([r.setScoresA, r.setScoresB]).toEqual([[5], [6]]);
  expect(rollupSets(cfg, [...pt('A', 6), ...pt('B', 6), off('A')], sideOf, { level: 'next_point' }).decided).toBeNull(); // no buzzer: play on
});
test('side-out scoring: the same in the shared core', () => {
  const rally = (side: 'A' | 'B') => ({ event_type: 'score', payload: { team_side: side, kind: 'rally' } });
  const opts = { target: 11, winBy2: true, maxGames: 3, doubles: false, timedLevel: 'next_point' as const };
  const s = sideOutReplay([rally('A'), rally('A'), rally('B'), rally('B'), rally('B'), buzzer, off('A')], opts);
  expect(s.winner).toBe('B');
});
