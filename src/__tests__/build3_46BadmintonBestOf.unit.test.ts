/** BUILD 3.46 · badminton best of 1, 3 or 5 (standard 3). */
import { bestOfFor, isAcceptableMatchLength } from '../utils/matchLength';
import { rulesRefusal, rulesOf, setConfigOf, standardRules } from '../utils/matchRules';
import { rollupSets } from '../controllers/scoring.controller';

test('1, 3 or 5; "bo5" reads back', () => {
  for (const n of [1, 3, 5]) expect(rulesRefusal('badminton', { ...standardRules('badminton'), bestOf: n })).toBeNull();
  expect(rulesRefusal('badminton', { ...standardRules('badminton'), bestOf: 7 })?.field).toBe('bestOf');
  expect(isAcceptableMatchLength('badminton', 'bo5')).toBe(true);
  expect(bestOfFor('badminton', 'bo5')).toBe(5);
  expect(rulesOf('badminton', { format: 'bo5' }).bestOf).toBe(5);
});
test('best of 5: two games up is not the match; three is', () => {
  const g = (side: string) => Array.from({ length: 15 }, () => ({ event_type: 'score', payload: { team_side: side, value: 1 } }));
  const cfg = setConfigOf({ ...standardRules('badminton'), bestOf: 5 });
  const side = (p: { team_side?: string }) => (p.team_side === 'B' ? 'B' : 'A') as 'A' | 'B';
  expect(rollupSets(cfg, [...g('A'), ...g('A')], side).decided).toBeNull();
  expect(rollupSets(cfg, [...g('A'), ...g('A'), ...g('A')], side).decided).toBe('A');
});
