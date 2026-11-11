/**
 * N-R7-S138 (SIDE-C6b-1): the Fair play award line read '-6 fair-play points' with an ASCII hyphen,
 * while the table writes a negative with the minus sign ('−1', N-R7-304). The award now says '−6'.
 */
import { computedAwards } from '../controllers/awards.controller';

const names = new Map([['t1', 'Lions'], ['t2', 'Tigers']]);

test.each([[-6, '−6 fair-play points'], [-1, '−1 fair-play point'], [0, 'no cards']])('fair play %i reads %s', (n, want) => {
  const out = computedAwards('hockey', [], new Map([['t1', n], ['t2', n - 3]]), ['t1', 't2'], names);
  const v = out.find((a) => a.key === 'fair_play')?.value;
  expect(v).toBe(want);
  expect(v).not.toMatch(/-\d/);
});
