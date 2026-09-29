/**
 * BUILD 3.3 · last man stands: the last batter bats on alone, so a side is all
 * out one wicket later — shared by the server's summary and completion.
 */
import { allOutBySide } from '../utils/cricketRules';
import { rulesRefusal, standardRules } from '../utils/matchRules';

test('all out one wicket later with last man stands', () => {
  expect(allOutBySide([], 3, true)).toEqual({ A: 3, B: 3 });
  expect(allOutBySide([], 3, false)).toEqual({ A: 2, B: 2 });
  const six = Array(6).fill({ team_side: 'A' });
  expect(allOutBySide(six, null, true).A).toBe(6);
  expect(allOutBySide([], null, true)).toEqual({ A: 11, B: 11 }); // typed teams: 10 + 1
});
test('on / off only', () => {
  expect(rulesRefusal('cricket', { ...standardRules('cricket'), lastManStands: true })).toBeNull();
  expect(rulesRefusal('cricket', { ...standardRules('cricket'), lastManStands: 'yes' })?.field).toBe('lastManStands');
});
