/** BUILD 3.55 · pickleball points a game 5–25 — the server counts a game to 15 the same way. */
import { rulesRefusal, setConfigOf, standardRules } from '../utils/matchRules';
import { rollupSets } from '../controllers/scoring.controller';

test('range and rollup', () => {
  expect(rulesRefusal('pickleball', { ...standardRules('pickleball'), target: 21 })).toBeNull();
  for (const ok of [4, 26, 50]) expect(rulesRefusal('pickleball', { ...standardRules('pickleball'), target: ok })).toBeNull(); // Stage 13 · CR3: no top
  expect(rulesRefusal('pickleball', { ...standardRules('pickleball'), target: 0 })?.field).toBe('target');
  const pts = (n: number) => Array.from({ length: n }, () => ({ event_type: 'score', payload: { team_side: 'A', value: 1 } }));
  const cfg = setConfigOf({ ...standardRules('pickleball'), target: 15 });
  expect(rollupSets(cfg, pts(11), () => 'A').setScoresA).toEqual([]);
  expect(rollupSets(cfg, pts(15), () => 'A').setScoresA).toEqual([15]);
});
