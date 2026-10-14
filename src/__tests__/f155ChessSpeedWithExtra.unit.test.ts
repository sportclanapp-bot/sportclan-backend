/**
 * F155 (launch test plan, Round 2): a chess game with extra time after move 20 or 40 was labelled
 * one speed (the stored format counts the extra minutes, FIDE's 60-move estimate) but rated in
 * another (the rating speed didn't). Both now come from chessSpeedOf.
 */
import { timeControlOf } from '../utils/chessTcRatings';
import { legacyFromRules, standardRules, chessSpeedOf } from '../utils/matchRules';

const chess = (r: object) => ({ ...standardRules('chess'), ...r });
it.each([
  [{ baseMinutes: 8, incrementSeconds: 0, secondPeriodMoves: 20, secondPeriodMinutes: 5 }, 'rapid'],
  [{ baseMinutes: 40, incrementSeconds: 0, secondPeriodMoves: 40, secondPeriodMinutes: 30 }, 'classical'],
  [{ baseMinutes: 90, incrementSeconds: 30, secondPeriodMoves: 40, secondPeriodMinutes: 30 }, 'classical'],
  [{ baseMinutes: 8, incrementSeconds: 0 }, 'blitz'],
])('%j is rated %s, the speed its label says', (r, speed) => {
  const rules = chess(r);
  expect(timeControlOf({ rules })).toBe(speed);
  expect(chessSpeedOf(rules).toLowerCase()).toBe(speed);
  expect(legacyFromRules('chess', rules).format?.toLowerCase().startsWith(speed)).toBe(true);
});
