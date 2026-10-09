/**
 * BUILD 4.9 · minimum rest between a team's matches. The scheduler only kept a
 * team out of two matches in the same slot, so on one ground a team could
 * finish at 10:00 and start again at 10:10 (the buffer). With a rest set, its
 * next match starts at least that long after its last one ends; a knockout
 * round (teams not yet known) starts that long after the previous round ends.
 */
import { buildSchedule, keyOf, type FixtureShape, type SchedulingConfig } from '../utils/scheduleFixtures';
import { settingsRefusal } from '../utils/tournamentSettings';

const cfg = (extra: Partial<SchedulingConfig> = {}): SchedulingConfig => ({
  startDateYmd: '2026-10-05', endDateYmd: '2026-10-06', dailyStartMin: 9 * 60, dailyEndMin: 18 * 60,
  durationMin: 60, bufferMin: 0, groundCount: 2, groundNames: null, bounded: true, ...extra,
});
const fx = (round: number, match_no: number, a: string | null, b: string | null): FixtureShape => ({ round, match_no, team_a_id: a, team_b_id: b });
const mins = (iso: string) => { const d = new Date(new Date(iso).getTime() + 330 * 60000); return d.getUTCDate() * 1440 + d.getUTCHours() * 60 + d.getUTCMinutes(); };

// A round robin of 4: every team plays three times.
const rr = [fx(0, 0, 'A', 'B'), fx(0, 1, 'C', 'D'), fx(0, 2, 'A', 'C'), fx(0, 3, 'B', 'D'), fx(0, 4, 'A', 'D'), fx(0, 5, 'B', 'C')];
const gaps = (res: ReturnType<typeof buildSchedule>, fixtures: FixtureShape[]) => {
  if (!res.ok) throw new Error(res.error);
  const byTeam = new Map<string, number[]>();
  for (const f of fixtures) for (const t of [f.team_a_id, f.team_b_id]) if (t) (byTeam.get(t) ?? byTeam.set(t, []).get(t)!).push(mins(res.assignments.get(keyOf(f.round, f.match_no))!.scheduled_at));
  let min = Infinity;
  for (const times of byTeam.values()) { times.sort((x, y) => x - y); for (let i = 1; i < times.length; i++) min = Math.min(min, times[i]! - (times[i - 1]! + 60)); }
  return min;
};

test('without rest, a team can play back to back (as before)', () => {
  expect(gaps(buildSchedule(rr, cfg()), rr)).toBe(0);
});
test('with 60 minutes’ rest, every team has at least an hour between matches', () => {
  expect(gaps(buildSchedule(rr, cfg({ restMin: 60 })), rr)).toBeGreaterThanOrEqual(60);
});
test('a knockout round starts the rest after the previous round ends', () => {
  const ko = [fx(1, 0, 'A', 'B'), fx(1, 1, 'C', 'D'), fx(2, 0, null, null)];
  const res = buildSchedule(ko, cfg({ restMin: 90 }));
  if (!res.ok) throw new Error(res.error);
  const semisEnd = Math.max(mins(res.assignments.get('1:0')!.scheduled_at), mins(res.assignments.get('1:1')!.scheduled_at)) + 60;
  expect(mins(res.assignments.get('2:0')!.scheduled_at) - semisEnd).toBeGreaterThanOrEqual(90);
});
test('a rest that can’t fit says so', () => {
  const res = buildSchedule(rr, cfg({ endDateYmd: '2026-10-05', dailyEndMin: 13 * 60, restMin: 240 }));
  expect(res.ok).toBe(false);
  if (!res.ok) expect(res.error).toMatch(/— or the 240-minute rest between a team’s matches\.$/);
});
test('rest is 0 or more whole minutes (Stage 13 · CR3: no top)', () => {
  for (const ok of [0, 240, 241, 600]) expect(settingsRefusal('football', 'league', { restMinutes: ok })).toBeNull();
  for (const bad of [-1, 30.5]) expect(settingsRefusal('football', 'league', { restMinutes: bad })?.error).toBe('Rest between a team’s matches must be a whole number of minutes.');
  expect(settingsRefusal('football', 'league', { restMinutes: 30 })).toBeNull();
});
