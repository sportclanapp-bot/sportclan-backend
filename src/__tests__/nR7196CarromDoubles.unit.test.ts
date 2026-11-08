/** N-R7-196 (Step 2 Batch 9, SPP1-CRM-005): the server holds carrom doubles to two a side and takes a carrom match's players 2. */
import { doublesLineupProblem, rulesRefusal, standardRules, DOUBLES_PLAYERS, DOUBLES_SPORTS } from '../utils/matchRules';

test('carrom doubles: a third player is refused at the line-up save', () => {
  expect(DOUBLES_SPORTS).toContain('carrom');
  expect(doublesLineupProblem('carrom', { ...standardRules('carrom'), players: DOUBLES_PLAYERS } as never, { A: 3, B: 2 }, { A: 'Aces', B: 'Bees' }, 'lineup')).toBe('Doubles is two a side — Aces has 3.');
});
test('a carrom match may store players 2 (doubles) or none, nothing else', () => {
  expect(rulesRefusal('carrom', { ...standardRules('carrom'), players: 2 })).toBeNull();
  expect(rulesRefusal('carrom', { ...standardRules('carrom'), players: 3 })?.error).toBe('Carrom players a side is 2 (doubles), or not set for singles.');
});
