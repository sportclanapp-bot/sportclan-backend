/**
 * N-R7-96 (SPP1-TTN-057) · a team tie's timeline opens with who names A, B, C. With the toss or the
 * pick recorded it did; with NO toss recorded it had no line at all, though the rule (the first-named
 * side is A, B) still decides the order. Expected first line 'No toss recorded, so <first-named>
 * (named first) is A, B · <other> is X, Y'.
 */
import { tieTossTimelineLine } from '../controllers/matches.controller';
import { tieSpecOf } from '../utils/matchRules';
import { tieTossOf } from '../utils/tieCore';

const names = { A: 'Deccan', B: 'PYC' };
const corbillon = tieSpecOf('table-tennis', { rubbers: 5 } as never)!;
const swaythling = tieSpecOf('table-tennis', { rubbers: 9 } as never)!;

test('no toss recorded: the first-named side is A, B', () => {
  expect(tieTossTimelineLine(corbillon, null, names)).toBe('No toss recorded, so Deccan (named first) is A, B · PYC is X, Y');
  expect(tieTossTimelineLine(swaythling, null, names)).toBe('No toss recorded, so Deccan (named first) is A, B, C · PYC is X, Y, Z');
});
test('toss and pick lines unchanged', () => {
  expect(tieTossTimelineLine(corbillon, tieTossOf({ abc: 'B', how: 'toss', winner: 'B' }), names)).toBe('🪙 Toss: PYC won the toss and chose A, B · Deccan is X, Y');
  expect(tieTossTimelineLine(corbillon, tieTossOf({ abc: 'B', how: 'pick' }), names)).toBe('🪙 Positions: PYC is A, B · Deccan is X, Y');
});
test('not a team tie, or a tie without positions (badminton S1 D1 S2): no line', () => {
  expect(tieTossTimelineLine(null, null, names)).toBeNull();
  expect(tieTossTimelineLine(tieSpecOf('badminton', { rubbers: 3 } as never)!, null, names)).toBeNull();
});
