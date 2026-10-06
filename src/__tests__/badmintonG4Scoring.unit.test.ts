/**
 * Badminton gap 4 (Oct 2026) · scoring per stage and per round: a stage "from
 * the quarter-finals" (the QF and SF rounds) between the early rounds and the
 * final, and the six badminton scorings as valid rules.
 */
import { stageRules, tournamentRulesRefusal } from '../utils/matchRules';
import { knockoutStage } from '../controllers/tournaments.controller';

const one21 = { v: 1, bestOf: 1, target: 21, cap: 30 };
const three15 = { v: 1, bestOf: 3, target: 15, cap: 21 };
const three21 = { v: 1, bestOf: 3, target: 21, cap: 30 };

test('which stage each knockout round plays', () => {
  // a 32 draw: R32, R16, QF, SF, F
  expect([1, 2, 3, 4, 5].map((r) => knockoutStage(r, 5))).toEqual(['knockout', 'knockout', 'qf', 'qf', 'final']);
  // a 4 draw: SF, F
  expect([1, 2].map((r) => knockoutStage(r, 2))).toEqual(['qf', 'final']);
  expect(knockoutStage(1, 1)).toBe('final');
});

test('the rules chain: final → from the QF → knockout → default', () => {
  const rules = { default: three15, knockout: one21, qf: three15, final: three21 };
  expect(stageRules('badminton', rules, 'knockout')).toMatchObject({ bestOf: 1, target: 21 });
  expect(stageRules('badminton', rules, 'qf')).toMatchObject({ bestOf: 3, target: 15 });
  expect(stageRules('badminton', rules, 'final')).toMatchObject({ bestOf: 3, target: 21 });
  // no final of its own → the quarter-finals' rules
  expect(stageRules('badminton', { knockout: one21, qf: three15 }, 'final')).toMatchObject({ bestOf: 3, target: 15 });
  // no QF rules → the knockout's (as before gap 4)
  expect(stageRules('badminton', { knockout: one21 }, 'qf')).toMatchObject({ bestOf: 1 });
  expect(stageRules('cricket', { knockout: { v: 1, overs: 8 } }, 'final').overs).toBe(8);
});

test('the six scorings are valid; qf is a stage; nonsense is refused by stage', () => {
  for (const r of [three15, three21, one21, { v: 1, bestOf: 1, target: 15, cap: 21 }, { v: 1, bestOf: 1, target: 30, cap: 30 }, { v: 1, bestOf: 5, target: 11, cap: 15 }]) {
    expect(tournamentRulesRefusal('badminton', { qf: r })).toBeNull();
  }
  expect(tournamentRulesRefusal('badminton', { semis: three15 })!.error).toMatch(/default, group, knockout, qf or final/);
  expect(tournamentRulesRefusal('badminton', { qf: { v: 1, bestOf: 3, target: 40 } })!.error).toMatch(/^From the quarter-finals: /);
});
