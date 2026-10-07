/**
 * Stage 10 · TT1b · who names A, B, C: the toss (the winner chooses) or the
 * organiser's pick; none = the first-named side, as before. The side that
 * names X, Y, Z is checked against the X positions.
 */
import { tieSpecLineupProblem } from '../controllers/tieLineup.controller';
import { tieSpecOf } from '../utils/matchRules';
import { abcSideOf, expandPositions, letterSideOf, lettersOf, tieTossOf, tieTossProblem, tieTossText } from '../utils/tieCore';

const spec = tieSpecOf('table-tennis', { rubbers: 5 } as never)!; // the Corbillon
const names = { A: 'Deccan', B: 'PYC' };

test('no toss: the first-named side names A, B (old ties unchanged)', () => {
  expect(abcSideOf(null)).toBe('A');
  expect(letterSideOf('A', null)).toBe('A');
  expect(letterSideOf('B', null)).toBe('B');
  expect(tieTossText(spec, null, names)).toBe('No toss recorded, so Deccan (named first) is A, B · PYC is X, Y');
});

test('the toss: PYC (second-named) wins and chooses A, B', () => {
  const t = tieTossOf({ abc: 'B', how: 'toss', winner: 'B', at: '2026-10-07T10:00:00Z' })!;
  expect(letterSideOf('B', t)).toBe('A');
  expect(letterSideOf('A', t)).toBe('B');
  expect(tieTossText(spec, t, names)).toBe('PYC won the toss and chose A, B · Deccan is X, Y');
  const choseX = tieTossOf({ abc: 'A', how: 'toss', winner: 'B' })!;
  expect(tieTossText(spec, choseX, names)).toBe('PYC won the toss and chose X, Y · Deccan is A, B');
});

test('the pick', () => {
  expect(tieTossText(spec, tieTossOf({ abc: 'B', how: 'pick' }), names)).toBe('PYC is A, B · Deccan is X, Y');
  expect(lettersOf(tieSpecOf('table-tennis', { rubbers: 9 } as never)!, 'B')).toBe('X, Y, Z');
});

test('refusals and bad stored values', () => {
  expect(tieTossProblem({ how: 'toss', abc: 'A' })).toBe('Say who won the toss.');
  expect(tieTossProblem({ how: 'pick' })).toBe('Say which side names A, B, C.');
  expect(tieTossProblem({ how: 'coin', abc: 'A' })).toBe('A toss, or the organiser’s pick.');
  expect(tieTossProblem(null)).toBe('Say who names A, B, C.');
  expect(tieTossProblem({ how: 'pick', abc: 'B' })).toBeNull();
  expect(tieTossOf({ abc: 'C', how: 'pick' })).toBeNull();
  expect(tieTossOf({ abc: 'A', how: 'toss' })).toBeNull(); // a toss needs its winner
  expect(tieTossOf('A')).toBeNull();
});

test('the fixture side that names X, Y is checked against the X positions', () => {
  const t = tieTossOf({ abc: 'B', how: 'pick' })!;
  const members = new Set(['a', 'b', 'c']);
  const L = letterSideOf('A', t); // Deccan names X, Y
  const lineup = expandPositions(spec, L, { 1: 'a', 2: 'b' }, { Doubles: ['b', 'c'] });
  expect(lineup).toEqual({ 'A v X': ['a'], 'B v Y': ['b'], Doubles: ['b', 'c'], 'A v Y': ['b'], 'B v X': ['a'] });
  expect(tieSpecLineupProblem(spec, lineup, members, L)).toBeNull();
  expect(tieSpecLineupProblem(spec, { ...lineup, 'A v Y': ['a'] }, members, L)).toBe('Y is one player in every match.');
});
