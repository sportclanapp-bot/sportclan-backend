/**
 * Q53 (Dipak, 21 Nov 2026: A) · N-R7-S36: in a volleyball "every set played" league a walkover is the
 * full straight win there, 5–0 (each set 25–0), as a played straight win — it went down 3–0.
 */
import { walkoverScoreFor, withWalkoverScore } from '../utils/walkoverScore';
import { standardRules } from '../utils/matchRules';

const VB = standardRules('volleyball');
test('every set played: 5–0, each set to nil; the usual best of 5 stays 3–0', () => {
  expect(walkoverScoreFor('volleyball', { ...VB, allGames: true }, { walkoverScore: 'straight' })).toBe(5);
  expect(walkoverScoreFor('volleyball', VB, { walkoverScore: 'straight' })).toBe(3);
  expect(walkoverScoreFor('volleyball', { ...VB, bestOf: 3, allGames: true }, { walkoverScore: 'straight' })).toBe(3);
  const ss = withWalkoverScore('volleyball', { ...VB, allGames: true }, {}, 'A', { walkoverScore: 'straight' });
  expect([ss.A.score, ss.B.score, ss.A.sets, ss.B.sets]).toEqual([5, 0, [25, 25, 25, 25, 25], [0, 0, 0, 0, 0]]);
});
