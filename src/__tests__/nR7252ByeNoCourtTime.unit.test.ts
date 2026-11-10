/**
 * N-R7-252 (Step 2 B10, SPP2-VOL-008) · a knockout of 5: the three byes are
 * decided at the draw and take no court time. The one real round-1 match
 * starts at the first slot (9:00, Court 1); it was pushed to the 4th slot
 * (10:25 am) behind the three bye rows. A bye row is dated with its round's
 * first match and has no court. Every knockout sport.
 *
 * N-R7-253 (Step 2 B10, SPP2-VOL-015) · a double elimination on one court with
 * no day hours (9 am – 9 pm assumed): the back draw, the final and the reset
 * take the schedule's own slots — one match per court at a time, inside the
 * day hours, after the main draw — where they were the main final's time plus
 * a round's gap (two back matches at 10:25 pm, round 4 at 6:10 am, the reset
 * at 3:20 am).
 */
import { bracketShape, byeSlot, buildTournamentScheduleConfig } from '../controllers/tournaments.controller';
import { buildSchedule, keyOf } from '../utils/scheduleFixtures';
import { deScheduleShape, scheduleRound, backRounds } from '../utils/doubleElim';

const T = (id: string) => ({ id, name: id });
// seededRound1 for 5 in 8: seeds 1–3 get byes (1 v bye, 4 v 5, 3 v bye, 2 v bye).
const ko5 = [{ a: T('A'), b: null }, { a: T('D'), b: T('E') }, { a: T('C'), b: null }, { a: T('B'), b: null }];
const istHm = (iso: string) => { const d = new Date(Date.parse(iso) + 330 * 60000); return d.getUTCHours() * 60 + d.getUTCMinutes(); };

describe('N-R7-252 · a bye takes no court time', () => {
  const cfg = buildTournamentScheduleConfig({ ground_count: 1, ground_names: ['Court 1'], match_duration_minutes: 75, buffer_minutes: 10, settings: {} }, '2026-11-10');
  const r = buildSchedule(bracketShape(ko5), cfg);
  if (!r.ok) throw new Error(r.error);
  it('the bye rows are not scheduled; D v E has the first slot', () => {
    expect(r.assignments.has(keyOf(1, 0))).toBe(false);
    expect(r.assignments.has(keyOf(1, 2))).toBe(false);
    expect(r.assignments.has(keyOf(1, 3))).toBe(false);
    expect(r.assignments.get(keyOf(1, 1))).toEqual({ scheduled_at: '2026-11-10T03:30:00.000Z', ground_label: 'Court 1' }); // 9:00 IST
  });
  it('the semi-finals follow straight after it', () => {
    expect(istHm(r.assignments.get(keyOf(2, 0))!.scheduled_at)).toBe(9 * 60 + 85);
  });
  it("a bye row: its round's first match's date, no court", () => {
    expect(byeSlot(ko5, (rd, m) => r.assignments.get(keyOf(rd, m)))).toEqual({ scheduled_at: '2026-11-10T03:30:00.000Z', ground_label: null });
  });
  it('a full draw is scheduled as before', () => {
    const full = [{ a: T('A'), b: T('H') }, { a: T('D'), b: T('E') }, { a: T('C'), b: T('F') }, { a: T('B'), b: T('G') }];
    const f = buildSchedule(bracketShape(full), cfg);
    if (!f.ok) throw new Error(f.error);
    expect(f.assignments.size).toBe(7);
    expect(istHm(f.assignments.get(keyOf(1, 3))!.scheduled_at)).toBe(9 * 60 + 3 * 85);
  });
});

describe('N-R7-253 · the back draw on the schedule', () => {
  const k = 3;
  const full = [{ a: T('A'), b: T('H') }, { a: T('D'), b: T('E') }, { a: T('C'), b: T('F') }, { a: T('B'), b: T('G') }];
  const cfg = buildTournamentScheduleConfig({ ground_count: 1, ground_names: ['Court 1'], match_duration_minutes: 75, buffer_minutes: 10, settings: {} }, '2026-11-10');
  const r = buildSchedule([...bracketShape(full), ...deScheduleShape(k)], cfg);
  if (!r.ok) throw new Error(r.error);
  const all = [...r.assignments.values()];
  it('every match: its own time on the one court, inside 9 am – 9 pm', () => {
    expect(all).toHaveLength(7 + 6 + 2);
    expect(new Set(all.map((x) => x.scheduled_at)).size).toBe(all.length);
    for (const x of all) { expect(istHm(x.scheduled_at)).toBeGreaterThanOrEqual(540); expect(istHm(x.scheduled_at) + 75).toBeLessThanOrEqual(1260); expect(x.ground_label).toBe('Court 1'); }
  });
  it('back rounds after the main final, in order; the final, then the reset last', () => {
    const at = (rd: number, m = 0) => Date.parse(r.assignments.get(keyOf(rd, m))!.scheduled_at);
    let prev = at(k);
    backRounds(k).forEach((n, i) => { for (let m = 0; m < n; m++) expect(at(scheduleRound(k, 'back', i + 1), m)).toBeGreaterThan(prev); prev = Math.max(...Array.from({ length: n }, (_, m) => at(scheduleRound(k, 'back', i + 1), m))); });
    expect(at(scheduleRound(k, 'final', 0))).toBeGreaterThan(prev);
    expect(at(scheduleRound(k, 'reset', 0))).toBeGreaterThan(at(scheduleRound(k, 'final', 0)));
  });
});
