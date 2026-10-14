/** F186 (launch test plan, Round 2): the timeline's minute in extra time — its halves have their own length (2 × 30 + 2 × 10). */
import { matchMinute, sportCommentary } from '../utils/commentary';

test('a goal 5 minutes into ET2 is 76′ (it read 96′); stoppage time in ET2 is 80+2′', () => {
  expect(matchMinute(75 * 60, 30, 4, 2, 10)).toBe("76'");
  expect(matchMinute(81 * 60, 30, 4, 2, 10)).toBe("80+2'");
  expect(matchMinute(62 * 60, 30, 3, 2, 10)).toBe("63'");
});
test('normal time, and no extra-time length, as before', () => {
  expect(matchMinute(35 * 60, 30, 2, 2, 10)).toBe("36'");
  expect(matchMinute(95 * 60, 30, 4)).toBe("96'");
});
test('the line carries it', () => {
  const ctx = { sport: 'football', teamA: 'Lions', teamB: 'Tigers', period: 3, periodMinutes: 30, regulation: 2, extraMinutes: 10, clockSeconds: 75 * 60 } as never;
  expect(sportCommentary('score', { team_side: 'A', value: 1 }, ctx)).toMatch(/^76' /);
});
