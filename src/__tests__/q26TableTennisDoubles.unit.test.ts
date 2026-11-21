/**
 * Q26 (Dipak, 21 Nov 2026), F172: table tennis doubles can be set (players 2),
 * like badminton, so the app's pad shows who serves to whom; the line-up is
 * held to two a side as for the other doubles sports.
 */
import { rulesRefusal, standardRules, doublesLineupProblem, DOUBLES_SPORTS } from '../utils/matchRules';

const names = { A: 'Asha & Ravi', B: 'Meena & Kiran' };
test('players 2 is table tennis doubles; anything else is refused', () => {
  expect(rulesRefusal('tabletennis', { ...standardRules('tabletennis'), players: 2 })).toBeNull();
  expect(rulesRefusal('tabletennis', { ...standardRules('tabletennis'), players: 3 })?.field).toBe('players');
  expect(rulesRefusal('tabletennis', standardRules('tabletennis'))).toBeNull(); // singles as before
});
test('the line-up is two a side', () => {
  expect(DOUBLES_SPORTS).toContain('tabletennis');
  const r = { ...standardRules('tabletennis'), players: 2 } as never;
  expect(doublesLineupProblem('tabletennis', r, { A: 3, B: 2 }, names, 'lineup')).toBe('Doubles is two a side — Asha & Ravi has 3.');
  expect(doublesLineupProblem('tabletennis', r, { A: 2, B: 2 }, names, 'start')).toBeNull();
});
