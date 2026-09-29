/**
 * BUILD 3.13 · powerplay overs (display only): off, or 1 to the overs. Its
 * score is read from the log; nothing about scoring changes. A cut in overs
 * (3.12) brings a longer powerplay down with it.
 */
import { powerplayState } from '../utils/cricketRules';
import { rulesRefusal, standardRules } from '../utils/matchRules';

const ev = (event_type: string, payload: object) => ({ event_type, payload: { team_side: 'A', ...payload } });

test('off, or whole 1 to the overs', () => {
  const r = (powerplayOvers: unknown) => rulesRefusal('cricket', { ...standardRules('cricket'), overs: 20, powerplayOvers });
  expect(standardRules('cricket').powerplayOvers).toBeNull();
  for (const ok of [null, 1, 6, 20]) expect(r(ok)).toBeNull();
  for (const bad of [0, 21, 2.5]) expect(r(bad)?.field).toBe('powerplayOvers');
});
test('its score: the first N overs of the side’s innings', () => {
  const over = (runs: number) => Array.from({ length: 6 }, () => ev('ball', { runs }));
  const log = [...over(1), ev('extra', { type: 'Wd', runs: 1 }), ev('wicket', { wicket_type: 'bowled' }), ...Array.from({ length: 5 }, () => ev('ball', { runs: 2 })), ...over(4), ev('ball', { team_side: 'B', runs: 6 })];
  expect(powerplayState(log, 'A', null)).toBeNull();
  expect(powerplayState(log, 'A', 2)).toEqual({ runs: 17, wickets: 1, overNow: 2, overs: 2, running: false, done: true });
  expect(powerplayState(log.slice(0, 3), 'A', 2)).toMatchObject({ runs: 3, overNow: 1, running: true });
  expect(powerplayState(log, 'B', 2)).toMatchObject({ runs: 6, running: true });
});
