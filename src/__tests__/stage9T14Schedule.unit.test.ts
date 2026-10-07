/**
 * Stage 9 · T14 · the schedule's match length: the organiser's, else the
 * format's, else the sport's standard.
 */
import { buildTournamentScheduleConfig } from '../controllers/tournaments.controller';

const base = { daily_start_time: '09:00', daily_end_time: '18:00', buffer_minutes: 5, ground_count: 2, settings: null, end_date: '2026-11-29' };

test('a pro set gets a short slot; best of 5 a long one; the organiser’s number wins', () => {
  const pro = buildTournamentScheduleConfig({ ...base, match_rules: { default: { v: 1, bestOf: 1, gamesPerSet: 8 } } }, '2026-11-28', undefined, 'tennis');
  expect([pro.durationMin, pro.bounded]).toEqual([55, true]);
  const bo5 = buildTournamentScheduleConfig({ ...base, match_rules: { default: { v: 1, bestOf: 5, finalSetTiebreakTo: 10 } } }, '2026-11-28', undefined, 'tennis');
  expect(bo5.durationMin).toBe(145);
  const own = buildTournamentScheduleConfig({ ...base, match_duration_minutes: 40, match_rules: { default: { v: 1, bestOf: 5 } } }, '2026-11-28', undefined, 'tennis');
  expect(own.durationMin).toBe(40);
});

test('no rules: the sport’s standard (football with no period length: 90)', () => {
  expect(buildTournamentScheduleConfig({ ...base, match_rules: null }, '2026-11-28', undefined, 'football').durationMin).toBe(90);
  expect(buildTournamentScheduleConfig({ ...base, match_rules: null }, '2026-11-28', undefined, 'badminton').durationMin).toBe(30);
});
