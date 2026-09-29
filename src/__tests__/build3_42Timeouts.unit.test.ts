/**
 * BUILD 3.42 · volleyball timeouts: 2 a side each set by default (0–3 allowed),
 * one a set in the beach preset; the timeline names the side.
 */
import { BEACH_VOLLEYBALL, rulesRefusal, standardRules, timedRulesLabel } from '../utils/matchRules';
import { sportCommentary } from '../utils/commentary';

test('0–3 a set, standard 2, labelled when not 2', () => {
  const std = standardRules('volleyball');
  expect(std.timeoutsPerSet).toBe(2);
  expect(rulesRefusal('volleyball', { ...std, timeoutsPerSet: 0 })).toBeNull();
  expect(rulesRefusal('volleyball', { ...std, timeoutsPerSet: 4 })?.error).toBe('Timeouts must be 0 to 3 a set.');
  expect(rulesRefusal('badminton', { ...standardRules('badminton'), timeoutsPerSet: 2 })).not.toBeNull();
  expect(timedRulesLabel('volleyball', { ...std, timeoutsPerSet: 0 })).toBe('no timeouts');
  expect(timedRulesLabel('volleyball', { ...std, ...BEACH_VOLLEYBALL })).toBe('2-a-side · sets to 21 · 1 timeout a set');
});

test('the timeline names the side (it read "Timeout called by team")', () => {
  expect(sportCommentary('timeout', { team_side: 'B' }, { sport: 'volleyball', teamA: 'Spikers', teamB: 'Blockers', period: 0 } as never)).toBe('⏸ Timeout — Blockers');
});
