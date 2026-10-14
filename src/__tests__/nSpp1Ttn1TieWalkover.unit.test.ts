/**
 * N-SPP1-TTN-1 (launch test plan, Round 2): a 'straight' walkover in a table tennis team tie was
 * scored from the games ONE match needs (3–0, 2–0), not the matches the tie needs — a Swaythling
 * tie (first to 5) went down 3–0, a Corbillon played best of 3 as 2–0, throwing off the table's
 * match difference (a tie's score is in matches). It is now the matches the tie needs.
 */
import { walkoverScoreFor } from '../utils/walkoverScore';
import { seriesSpec } from '../utils/tieCore';

const S = { walkoverScore: 'straight' };
const tt = (r: object) => ({ v: 1, target: 11, winBy2: true, ...r }) as never;
it.each([
  ['a single match, best of 5', { bestOf: 5 }, 3],
  ['Corbillon (5 matches), best of 5', { bestOf: 5, rubbers: 5 }, 3],
  ['Corbillon (5 matches), best of 3', { bestOf: 3, rubbers: 5 }, 3],
  ['Swaythling (9 matches), best of 5', { bestOf: 5, rubbers: 9 }, 5],
])('%s → %j: %i–0', (_n, r, want) => {
  expect(walkoverScoreFor('table-tennis', tt(r), S)).toBe(want);
});
test('a custom tie and a best-of series: the matches / games the tie needs', () => {
  const custom = { rubbers: ['MS1', 'WS1', 'XD', 'MS2', 'WS2', 'MD', 'WD'].map((k) => ({ key: k, label: k, players: 1 as const })), win: 'first' as const };
  expect(walkoverScoreFor('badminton', { v: 1, bestOf: 3, tie: custom } as never, S)).toBe(4);
  expect(walkoverScoreFor('football', { v: 1, tie: seriesSpec(3) } as never, S)).toBe(2);
});
