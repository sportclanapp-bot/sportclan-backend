/**
 * BUILD 3.22 · the match clock's minute on the timeline: a football / hockey
 * event scored on the clock says "23' ⚽ GOAL!", past time "45+2'"; KICK-OFF
 * is a note of its own.
 */
import { matchMinute, sportCommentary } from '../utils/commentary';

test('the minute', () => {
  expect(matchMinute(0, 45, 1)).toBe("1'");
  expect(matchMinute(22 * 60 + 30, 45, 1)).toBe("23'");
  expect(matchMinute(46 * 60 + 5, 45, 1)).toBe("45+2'");
  expect(matchMinute(45 * 60, 45, 2)).toBe("46'");
  expect(matchMinute(91 * 60, 45, 2)).toBe("90+2'");
});
test('commentary: a goal on the clock, a goal off it, the kick-off', () => {
  const ctx = (clockSeconds: number | null, period = 0) => ({ sport: 'football', teamA: 'Lions', teamB: 'Tigers', period, clockSeconds, periodMinutes: 25 });
  expect(sportCommentary('score', { team_side: 'A', kind: 'goal' }, ctx(600))).toBe("11' ⚽ GOAL! Lions");
  expect(sportCommentary('score', { team_side: 'A', kind: 'goal' }, ctx(26 * 60 + 10, 1))).toBe("27' ⚽ GOAL! Lions"); // second half
  expect(sportCommentary('score', { team_side: 'A', kind: 'goal' }, ctx(null))).toBe('⚽ GOAL! Lions');
  expect(sportCommentary('note', { kind: 'kickoff' }, ctx(null))).toBe('⏱ Kick-off');
  expect(sportCommentary('score', { team_side: 'A', kind: 'goal' }, { sport: 'football', teamA: 'Lions', teamB: 'T', period: 0, clockSeconds: 600 })).toBe('⚽ GOAL! Lions'); // no length set
});
