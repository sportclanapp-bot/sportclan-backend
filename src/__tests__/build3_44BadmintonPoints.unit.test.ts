/** BUILD 3.44 · badminton points a game 5–30, a cap up to target + 15; presets 15/21 and 21/30. */
import { BADMINTON_PRESETS, badmintonCapFor, rulesRefusal, standardRules, setConfigOf, timedRulesLabel } from '../utils/matchRules';
import { rollupSets } from '../controllers/scoring.controller';

const bd = (x: object) => rulesRefusal('badminton', { ...standardRules('badminton'), ...x });
test('the range, in games', () => {
  for (const p of BADMINTON_PRESETS) expect(bd(p)).toBeNull();
  expect(bd({ target: 5, cap: null })).toBeNull();
  expect(bd({ target: 4, cap: null })?.error).toBe('Points to win a game must be 5 to 30.');
  expect(bd({ target: 15, cap: 31 })?.error).toBe('The cap must be off, or 15 to 30.');
  expect(timedRulesLabel('badminton', { ...standardRules('badminton'), target: 11, cap: null })).toBe('games to 11 · no cap');
  expect([badmintonCapFor(15), badmintonCapFor(21), badmintonCapFor(11)]).toEqual([21, 30, null]);
});
test('15 capped at 21: the server ends the game 21-20', () => {
  const pts = (side: string, n: number) => Array.from({ length: n }, () => ({ event_type: 'score', payload: { team_side: side, value: 1 } }));
  const cfg = setConfigOf({ ...standardRules('badminton'), target: 15, cap: 21 });
  const seq = [...pts('A', 14), ...pts('B', 14)];
  for (let i = 0; i < 6; i++) seq.push(...pts('A', 1), ...pts('B', 1));
  seq.push(...pts('B', 1));
  const r = rollupSets(cfg, seq, (p) => (p.team_side === 'B' ? 'B' : 'A'));
  expect([r.setScoresA[0], r.setScoresB[0]]).toEqual([20, 21]);
});
