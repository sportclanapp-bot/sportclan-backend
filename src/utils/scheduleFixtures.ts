// Tournament fixture scheduler (round-aware deterministic greedy).
//
// Given the fixture SHAPE (round + match_no + the two team ids) and a scheduling
// config (date range, one daily window, ground count, match duration + buffer),
// assign every fixture a real slot: date + time + ground. Deterministic (sorted
// inputs, no randomness) so it's reproducible and debuggable.
//
// TIMEZONE: the daily window is IST wall-clock (the app's India market). We store
// the resulting instant as a UTC timestamptz. The offset lives in ONE constant.
// Per-day window overrides (Sat 8–8, Sun 8–2) are a later enhancement; v1 uses a
// single window for all days.
export const TOURNAMENT_TZ_OFFSET_MIN = 330; // IST = UTC+05:30

export interface SchedulingConfig {
  startDateYmd: string; // 'YYYY-MM-DD'
  endDateYmd: string | null; // null → unbounded (fallback rolls forward as needed)
  dailyStartMin: number; // minutes from local midnight
  dailyEndMin: number;
  durationMin: number;
  bufferMin: number;
  groundCount: number;
  groundNames: string[] | null;
  bounded: boolean; // true = real config (capacity can fail); false = fallback (never fails)
}

export interface FixtureShape {
  round: number;
  match_no: number;
  team_a_id: string | null;
  team_b_id: string | null;
}

export interface SlotAssign {
  scheduled_at: string; // UTC ISO
  ground_label: string;
}

export type ScheduleResult =
  | { ok: true; assignments: Map<string, SlotAssign> } // key `${round}:${match_no}`
  | { ok: false; error: string; code: 'CAPACITY' };

export const keyOf = (round: number, matchNo: number): string => `${round}:${matchNo}`;

/** 'HH:MM[:SS]' → minutes from midnight. */
export function timeToMinutes(t: string | null | undefined, fallback: number): number {
  if (!t) return fallback;
  const m = String(t).match(/^(\d{1,2}):(\d{2})/);
  if (!m) return fallback;
  return parseInt(m[1], 10) * 60 + parseInt(m[2], 10);
}

/** Inclusive day count between two 'YYYY-MM-DD' dates (min 1). */
export function daysInclusive(startYmd: string, endYmd: string): number {
  const [ys, ms, ds] = startYmd.split('-').map(Number);
  const [ye, me, de] = endYmd.split('-').map(Number);
  const a = Date.UTC(ys, ms - 1, ds);
  const b = Date.UTC(ye, me - 1, de);
  return Math.max(1, Math.floor((b - a) / 86400000) + 1);
}

const groundLabelFor = (i: number, names: string[] | null): string =>
  (names && names[i]) ? names[i] : `Ground ${i + 1}`;

/** IST wall-clock (startDate + dayIndex, at wallMin) → UTC ISO. */
function slotUtcIso(startYmd: string, dayIndex: number, wallMin: number): string {
  const [y, m, d] = startYmd.split('-').map(Number);
  const hour = Math.floor(wallMin / 60);
  const min = wallMin % 60;
  // Treat the IST components as if UTC, then subtract the offset to get the true
  // UTC instant. (Date.UTC handles day/month rollover for d + dayIndex.)
  const utcMs = Date.UTC(y, m - 1, d + dayIndex, hour, min) - TOURNAMENT_TZ_OFFSET_MIN * 60000;
  return new Date(utcMs).toISOString();
}

export function buildSchedule(fixtures: FixtureShape[], cfg: SchedulingConfig): ScheduleResult {
  const G = Math.max(1, cfg.groundCount || 1);
  const D = Math.max(1, cfg.durationMin || 1);
  const B = Math.max(0, cfg.bufferMin || 0);
  const window = cfg.dailyEndMin - cfg.dailyStartMin;
  // k matches fit a day when k·D + (k−1)·B ≤ window → k ≤ (window + B)/(D + B).
  const slotsPerDay = Math.max(0, Math.floor((window + B) / (D + B)));
  const N = fixtures.length;

  if (slotsPerDay < 1) {
    return {
      ok: false,
      code: 'CAPACITY',
      error: `The daily window is too short for even one ${D}-minute match. Widen the daily start/end times.`,
    };
  }

  // Bounded (real config) → fixed day count from the date range; capacity can fail.
  // Unbounded (fallback) → roll forward enough days that it always fits.
  const days = cfg.bounded && cfg.endDateYmd
    ? daysInclusive(cfg.startDateYmd, cfg.endDateYmd)
    : Math.max(1, Math.ceil(N / (G * slotsPerDay)) + N); // generous; sequential fallback always fits

  const rawCapacity = days * G * slotsPerDay;

  // Time-slots ordered (day, timeIndex); each holds G parallel ground-slots.
  // order = dayIndex*slotsPerDay + timeIndex.
  const totalTimeSlots = days * slotsPerDay;
  const usedGround: boolean[][] = Array.from({ length: totalTimeSlots }, () => new Array(G).fill(false));
  const teamsAt: Array<Set<string>> = Array.from({ length: totalTimeSlots }, () => new Set<string>());

  const assignments = new Map<string, SlotAssign>();

  // Round-ascending, match_no order. Round r can't start until strictly after the
  // last time-slot used by round r−1 (so a SF follows its QFs; groups precede KO).
  const sorted = [...fixtures].sort((a, b) => a.round - b.round || a.match_no - b.match_no);
  let prevRoundMaxOrder = -1;
  let curRound = sorted.length ? sorted[0].round : 0;
  let curRoundMaxOrder = -1;

  const capacityError = (): ScheduleResult => {
    const needDays = Math.ceil(N / (G * slotsPerDay));
    return {
      ok: false,
      code: 'CAPACITY',
      error:
        `These ${N} fixtures need ${N} slots, but ${fmtWindow(cfg)} on ${G} ground${G > 1 ? 's' : ''} at ` +
        `${D} min/match (${days} day${days > 1 ? 's' : ''}) fits only ${rawCapacity}. ` +
        `Add a ground, extend to ${needDays} day${needDays > 1 ? 's' : ''}, or shorten the match duration.`,
    };
  };

  for (const f of sorted) {
    if (f.round !== curRound) {
      prevRoundMaxOrder = curRoundMaxOrder;
      curRound = f.round;
    }
    const hasTeams = !!f.team_a_id && !!f.team_b_id;
    let placed = false;
    for (let order = prevRoundMaxOrder + 1; order < totalTimeSlots; order++) {
      // Team conflict (real-team fixtures only; TBD bracket slots exempt).
      if (hasTeams) {
        const s = teamsAt[order];
        if (s.has(f.team_a_id!) || s.has(f.team_b_id!)) continue;
      }
      const groundIdx = usedGround[order].findIndex((u) => !u);
      if (groundIdx === -1) continue; // this time-slot's grounds are all taken
      usedGround[order][groundIdx] = true;
      if (hasTeams) {
        teamsAt[order].add(f.team_a_id!);
        teamsAt[order].add(f.team_b_id!);
      }
      const dayIndex = Math.floor(order / slotsPerDay);
      const timeIndex = order % slotsPerDay;
      const wallMin = cfg.dailyStartMin + timeIndex * (D + B);
      assignments.set(keyOf(f.round, f.match_no), {
        scheduled_at: slotUtcIso(cfg.startDateYmd, dayIndex, wallMin),
        ground_label: groundLabelFor(groundIdx, cfg.groundNames),
      });
      curRoundMaxOrder = Math.max(curRoundMaxOrder, order);
      placed = true;
      break;
    }
    if (!placed) return capacityError();
  }

  return { ok: true, assignments };
}

function fmtWindow(cfg: SchedulingConfig): string {
  const hhmm = (min: number) => `${String(Math.floor(min / 60)).padStart(2, '0')}:${String(min % 60).padStart(2, '0')}`;
  return `${hhmm(cfg.dailyStartMin)}–${hhmm(cfg.dailyEndMin)}`;
}
