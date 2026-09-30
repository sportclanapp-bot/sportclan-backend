/** BUILD 3.56 · pickleball golden point: the server ends the game at 15-14. */
import { rulesRefusal, setConfigOf, standardRules } from '../utils/matchRules';
import { rollupSets } from '../controllers/scoring.controller';

test('15-14 ends a golden-point game, not a win-by-2 one', () => {
  const level = Array.from({ length: 28 }, (_, i) => ({ event_type: 'score', payload: { team_side: i % 2 ? 'B' : 'A', value: 1 } }));
  const evs = [...level, { event_type: 'score', payload: { team_side: 'B', value: 1 } }];
  const side = (p: { team_side?: string }) => (p.team_side === 'B' ? 'B' : 'A') as 'A' | 'B';
  const golden = setConfigOf({ ...standardRules('pickleball'), target: 15, winBy2: false });
  expect(rollupSets(golden, evs, side).setScoresB).toEqual([15]);
  expect(rollupSets(setConfigOf({ ...standardRules('pickleball'), target: 15 }), evs, side).setScoresB).toEqual([]);
  expect(rulesRefusal('pickleball', { ...standardRules('pickleball'), winBy2: false })).toBeNull();
});
