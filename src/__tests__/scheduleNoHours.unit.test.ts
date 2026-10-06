/**
 * Oct 2026 (Dipak) · a draw with no day hours still uses every court / ground
 * the organiser set (it put every match on Ground 1, one after another), with
 * their match length and gap when given, 9 am–9 pm assumed, and the rest gap
 * between a team's matches kept.
 */
import { buildTournamentScheduleConfig } from '../controllers/tournaments.controller';
import { buildSchedule, keyOf } from '../utils/scheduleFixtures';

const round1 = (n: number) => Array.from({ length: n }, (_, i) => ({ round: 1, match_no: i + 1, team_a_id: `a${i}`, team_b_id: `b${i}` }));

test('no day hours: every court, the organiser’s length and gap', () => {
  const cfg = buildTournamentScheduleConfig({ ground_count: 4, ground_names: ['Court 1', 'Court 2', 'Court 3', 'Court 4'], match_duration_minutes: 30, buffer_minutes: 5, settings: { v: 1, restMinutes: 20 } }, '2026-11-20');
  expect(cfg).toMatchObject({ groundCount: 4, durationMin: 30, bufferMin: 5, restMin: 20, bounded: false, dailyStartMin: 540, dailyEndMin: 1260 });
  const r = buildSchedule(round1(8), cfg);
  if (!r.ok) throw new Error(r.error);
  const slots = [...r.assignments.values()];
  expect(new Set(slots.map((x) => x.ground_label))).toEqual(new Set(['Court 1', 'Court 2', 'Court 3', 'Court 4']));
  // 8 matches on 4 courts: two waves, 35 minutes apart (30 + 5) — not 8 one after another.
  const times = [...new Set(slots.map((x) => x.scheduled_at))].sort();
  expect(times).toHaveLength(2);
  expect(Date.parse(times[1]!) - Date.parse(times[0]!)).toBe(35 * 60000);
  expect(r.assignments.get(keyOf(1, 1))!.scheduled_at).toBe('2026-11-20T03:30:00.000Z'); // 9:00 IST
});

test('nothing set at all: one ground, 60 + 10 minutes — as before', () => {
  const cfg = buildTournamentScheduleConfig({ settings: {} }, '2026-11-20');
  expect(cfg).toMatchObject({ groundCount: 1, durationMin: 60, bufferMin: 10, groundNames: null });
});

test('with day hours: unchanged (bounded to the dates)', () => {
  const cfg = buildTournamentScheduleConfig({ daily_start_time: '08:00', daily_end_time: '20:00', match_duration_minutes: 30, buffer_minutes: 5, ground_count: 3, end_date: '2026-11-21', settings: {} }, '2026-11-20');
  expect(cfg).toMatchObject({ bounded: true, groundCount: 3, dailyStartMin: 480, dailyEndMin: 1200, endDateYmd: '2026-11-21' });
});
