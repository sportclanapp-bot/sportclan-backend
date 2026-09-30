/** BUILD 3.50 · table tennis points a game 5–21, presets 11 and 21 — the server counts games the same way. */
import { rulesRefusal, setConfigOf, standardRules } from '../utils/matchRules';
import { rollupSets } from '../controllers/scoring.controller';

test('the range', () => {
  const std = standardRules('tabletennis');
  expect(rulesRefusal('tabletennis', { ...std, target: 21 })).toBeNull();
  expect(rulesRefusal('tabletennis', { ...std, target: 22 })?.error).toBe('Points to win a game must be 5 to 21.');
});
test('a 21-point game ends at 21-19, not at 11', () => {
  const pts = (side: string, n: number) => Array.from({ length: n }, () => ({ event_type: 'score', payload: { team_side: side, value: 1 } }));
  const cfg = setConfigOf({ ...standardRules('tabletennis'), target: 21 });
  const side = (p: { team_side?: string }) => (p.team_side === 'B' ? 'B' : 'A') as 'A' | 'B';
  expect(rollupSets(cfg, pts('A', 11), side).setScoresA).toEqual([]);
  expect(rollupSets(cfg, [...pts('B', 19), ...pts('A', 21)], side).setScoresA).toEqual([21]);
});
