/**
 * Stage 10 · TT1 · team ties by position: the Corbillon / Swaythling line-ups
 * (A plays two singles) can be saved; positions named once fill their matches;
 * a position is one player everywhere and two positions are two players.
 */
import { tieSpecLineupProblem } from '../controllers/tieLineup.controller';
import { tieSpecOf } from '../utils/matchRules';
import { expandPositions, positionLetter, positionsLabel, positionsOf, tieSpecProblem } from '../utils/tieCore';

const members = new Set(['a', 'b', 'c', 'd', 'x', 'y', 'z']);

test('the Corbillon: positions A and B, the doubles a free pair — the line-up saves (was "one singles at most")', () => {
  const spec = tieSpecOf('table-tennis', { rubbers: 5 } as never)!;
  expect(spec.rubbers.map((r) => positionsLabel(r) ?? r.label)).toEqual(['A v X', 'B v Y', 'Doubles', 'A v Y', 'B v X']);
  expect(positionsOf(spec, 'A')).toEqual([1, 2]);
  const lineup = expandPositions(spec, 'A', { 1: 'a', 2: 'b' }, { Doubles: ['c', 'd'] });
  expect(lineup).toEqual({ 'A v X': ['a'], 'B v Y': ['b'], Doubles: ['c', 'd'], 'A v Y': ['a'], 'B v X': ['b'] });
  expect(tieSpecLineupProblem(spec, lineup, members, 'A')).toBeNull();
  const side2 = expandPositions(spec, 'B', { 1: 'x', 2: 'y' }, { Doubles: ['x', 'y'] }); // a player in the doubles too
  expect(tieSpecLineupProblem(spec, side2, members, 'B')).toBeNull();
});

test('the Swaythling (9): three positions, each player three singles', () => {
  const spec = tieSpecOf('table-tennis', { rubbers: 9 } as never)!;
  const l = expandPositions(spec, 'A', { 1: 'a', 2: 'b', 3: 'c' });
  expect(Object.values(l).flat().filter((u) => u === 'a')).toHaveLength(3);
  expect(tieSpecLineupProblem(spec, l, members, 'A')).toBeNull();
});

test('a position is one player in every match; two positions are two players', () => {
  const spec = tieSpecOf('table-tennis', { rubbers: 5 } as never)!;
  const l = expandPositions(spec, 'A', { 1: 'a', 2: 'b' }, { Doubles: ['c', 'd'] });
  expect(tieSpecLineupProblem(spec, { ...l, 'A v Y': ['c'] }, members, 'A')).toBe('A is one player in every match.');
  expect(tieSpecLineupProblem(spec, expandPositions(spec, 'A', { 1: 'a', 2: 'a' }, { Doubles: ['c', 'd'] }), members, 'A')).toBe('A and B are two different players.');
  expect(tieSpecLineupProblem(spec, expandPositions(spec, 'A', { 1: 'a' }, { Doubles: ['c', 'd'] }), members, 'A')).toBe('B v Y needs a player.');
});

test('badminton S1 D1 S2 keeps its rule (no positions)', () => {
  const spec = tieSpecOf('badminton', { rubbers: 3 } as never)!;
  expect(tieSpecLineupProblem(spec, { S1: ['a'], D1: ['b', 'c'], S2: ['a'] }, members)).toBe('A player plays one singles at most.');
});

test('letters and checks', () => {
  expect([positionLetter('A', 1), positionLetter('A', 3), positionLetter('B', 1), positionLetter('B', 3), positionLetter('B', 4)]).toEqual(['A', 'C', 'X', 'Z', 'U']);
  expect(tieSpecProblem({ rubbers: [{ key: 'R1', label: 'A v X', players: 1, a: [1] }], win: 'first' })).toBe('A v X: give positions for both sides, or neither.');
  expect(tieSpecProblem({ rubbers: [{ key: 'D', label: 'Doubles', players: 2, a: [1, 1], b: [1, 2] }], win: 'first' })).toBe('Doubles: two different positions a side.');
});
