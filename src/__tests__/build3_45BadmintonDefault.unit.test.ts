/**
 * BUILD 3.45 · badminton's standard is 15 a game, capped at 21 — and a match
 * or fixture with no rules (an older app) still counts games to 21 (cap 30).
 */
import { BADMINTON_LEGACY, rulesFromLegacy, rulesOf, setConfigOf, stageRules, standardRules } from '../utils/matchRules';
import { rollupSets } from '../controllers/scoring.controller';

const pts = (side: string, n: number) => Array.from({ length: n }, () => ({ event_type: 'score', payload: { team_side: side, value: 1 } }));
const side = (p: { team_side?: string }) => (p.team_side === 'B' ? 'B' : 'A') as 'A' | 'B';

test('the standard is 15 (cap 21): 15-0 is a game', () => {
  expect(standardRules('badminton')).toMatchObject({ target: 15, cap: 21 });
  expect(rollupSets(setConfigOf(standardRules('badminton')), pts('A', 15), side)).toMatchObject({ setScoresA: [15], setsA: 1 });
});
test('no rules — an older app’s match — still plays 21 (cap 30)', () => {
  // What createMatch stores when no rules are sent.
  expect(rulesFromLegacy('badminton', 'bo3', null)).toMatchObject({ ...BADMINTON_LEGACY, bestOf: 3 });
  const cfg = setConfigOf(rulesOf('badminton', { format: 'bo3', rules: null }));
  const r = rollupSets(cfg, pts('A', 15), side);
  expect([r.setScoresA, r.curA, r.setsA]).toEqual([[], 15, 0]); // still in game 1 — not won at 15
  expect(rollupSets(cfg, pts('A', 21), side)).toMatchObject({ setScoresA: [21], setsA: 1 });
  expect(stageRules('badminton', null, 'knockout')).toMatchObject(BADMINTON_LEGACY);
  expect(stageRules('badminton', { default: standardRules('badminton') }, 'group')).toMatchObject({ target: 15, cap: 21 });
});
