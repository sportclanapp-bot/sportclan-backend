/**
 * N-R7-259 (Step 2 B10, SPP2-CRI-015 shared re-run) · a double elimination of 5 (three main-draw byes): the
 * back-draw places those byes leave empty (BYE v E, BYE v BYE, BYE v the semi-final loser) took court time —
 * Wed 12:10 and 3:20 pm, Thu 12:10 — pushing the real back-draw matches later. They are decided without play
 * and now take no slot. Every knockout sport.
 */
import { buildSchedule, keyOf } from '../utils/scheduleFixtures';
import { bracketShape, buildTournamentScheduleConfig } from '../controllers/tournaments.controller';
import { backByes, deScheduleShape, scheduleRound } from '../utils/doubleElim';

const T = (id: string) => ({ id, name: id });
const ko5 = [{ a: T('A'), b: null }, { a: T('D'), b: T('E') }, { a: T('B'), b: null }, { a: T('C'), b: null }];
const byes = ko5.map((p) => !p.a || !p.b);

test('the back-draw places of a 5-team draw: which are byes, which are empty', () => {
  const b = backByes(3, byes);
  expect([...b.entries()].sort()).toEqual([['1:0', 'bye'], ['1:1', 'empty'], ['2:1', 'bye']]);
});

test('a full draw has no back-draw byes', () => {
  expect(backByes(3, [false, false, false, false]).size).toBe(0);
});

test('only the back-draw matches that are played take court time', () => {
  const k = 3;
  const cfg = buildTournamentScheduleConfig({ ground_count: 1, ground_names: ['Court 1'], match_duration_minutes: 75, buffer_minutes: 10, settings: {} }, '2026-11-10');
  const r = buildSchedule([...bracketShape(ko5), ...deScheduleShape(k, backByes(k, byes))], cfg);
  if (!r.ok) throw new Error(r.error);
  expect(r.assignments.has(keyOf(scheduleRound(k, 'back', 1), 0))).toBe(false);
  expect(r.assignments.has(keyOf(scheduleRound(k, 'back', 1), 1))).toBe(false);
  expect(r.assignments.has(keyOf(scheduleRound(k, 'back', 2), 1))).toBe(false);
  // main: D v E, 2 semis, final = 4; back: r2 #1, r3, r4 = 3; final + reset = 2
  expect(r.assignments.size).toBe(9);
  const times = [...r.assignments.values()].map((x) => x.scheduled_at);
  expect(new Set(times).size).toBe(times.length);
});
