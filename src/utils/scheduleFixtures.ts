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
  dailyStartMin: number; // default daily window — minutes from local midnight
  dailyEndMin: number;
  durationMin: number;
  bufferMin: number;
  groundCount: number;
  groundNames: string[] | null;
  bounded: boolean; // true = real config (capacity can fail); false = fallback (never fails)
  // Per-day window overrides (tournament_days), keyed 'YYYY-MM-DD'. Any day
  // without an entry uses the default window above. (Sat 8–8, Sun 8–2.)
  dayWindows?: Map<string, { startMin: number; endMin: number }>;
  // BUILD 4.9: minimum rest between a team's matches (0–240 min): a team's next
  // match starts at least this long after its last one ends. A knockout slot's
  // teams aren't known at the draw, so each round starts at least this long
  // after the previous round's last match ends.
  restMin?: number;
  // Badminton gap 3: events of one tournament share its courts. Slots the other
  // events already hold (court + time, on this schedule's minute clock), and
  // each player's other matches, so a player in two events is never on two
  // courts at once and gets the rest between them. `playersOf` maps a team (an
  // entry) to its players.
  busyGrounds?: Array<{ ground: string; start: number; end: number }>;
  playersOf?: Map<string, string[]>;
  playerBusy?: Map<string, Array<[number, number]>>;
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
  const N = fixtures.length;
  const slotsInWindow = (winMin: number) => Math.max(0, Math.floor((winMin + B) / (D + B)));
  const defaultWindowMin = cfg.dailyEndMin - cfg.dailyStartMin;

  // Resolve the window for a given day (override row → else the default).
  const windowForDay = (dayIndex: number): { startMin: number; endMin: number } => {
    if (cfg.dayWindows && cfg.dayWindows.size > 0) {
      const ymd = addDaysYmd(cfg.startDateYmd, dayIndex);
      const ov = cfg.dayWindows.get(ymd);
      if (ov) return ov;
    }
    return { startMin: cfg.dailyStartMin, endMin: cfg.dailyEndMin };
  };

  // Bounded (real config) → fixed day count from the date range; capacity can fail.
  // Unbounded (fallback) → roll forward enough days that it always fits.
  const days = cfg.bounded && cfg.endDateYmd
    ? daysInclusive(cfg.startDateYmd, cfg.endDateYmd)
    : Math.max(1, Math.ceil(N / (G * Math.max(1, slotsInWindow(defaultWindowMin)))) + N);

  // Build the ordered time-slot list DAY BY DAY, each day using its OWN window
  // (so slots-per-day varies with per-day overrides). Each entry is one time-slot
  // holding G parallel ground-slots; global `order` preserves the round-ordering
  // greedy below.
  const timeSlotMeta: Array<{ dayIndex: number; wallMin: number }> = [];
  for (let dayIndex = 0; dayIndex < days; dayIndex++) {
    const win = windowForDay(dayIndex);
    const slots = slotsInWindow(win.endMin - win.startMin);
    for (let t = 0; t < slots; t++) {
      timeSlotMeta.push({ dayIndex, wallMin: win.startMin + t * (D + B) });
    }
  }
  const totalTimeSlots = timeSlotMeta.length;

  if (totalTimeSlots < 1) {
    return {
      ok: false,
      code: 'CAPACITY',
      error: `The daily window is too short for even one ${D}-minute match. Widen the daily start/end times.`,
    };
  }

  const rawCapacity = totalTimeSlots * G;
  const usedGround: boolean[][] = Array.from({ length: totalTimeSlots }, () => new Array(G).fill(false));
  // Badminton gap 3: a court another event holds at that time is taken.
  const shared = (cfg.busyGrounds?.length ?? 0) > 0 || (cfg.playerBusy?.size ?? 0) > 0;
  if (cfg.busyGrounds?.length) {
    for (const bz of cfg.busyGrounds) {
      const g = Array.from({ length: G }, (_, i) => groundLabelFor(i, cfg.groundNames)).indexOf(bz.ground);
      if (g === -1) continue;
      for (let o = 0; o < totalTimeSlots; o++) {
        const at = timeSlotMeta[o]!.dayIndex * 1440 + timeSlotMeta[o]!.wallMin;
        if (at < bz.end && at + D > bz.start) usedGround[o]![g] = true;
      }
    }
  }
  const playerBusy = new Map<string, Array<[number, number]>>();
  for (const [p, list] of cfg.playerBusy ?? []) playerBusy.set(p, [...list]);
  const playersFor = (teamId: string | null): string[] => (teamId && cfg.playersOf?.get(teamId)) || [];
  const teamsAt: Array<Set<string>> = Array.from({ length: totalTimeSlots }, () => new Set<string>());

  const assignments = new Map<string, SlotAssign>();
  // BUILD 4.9: rest. Minutes on one clock across days, per time-slot.
  const R = Math.max(0, cfg.restMin ?? 0);
  const absStart = (order: number) => timeSlotMeta[order]!.dayIndex * 1440 + timeSlotMeta[order]!.wallMin;
  const teamFree = new Map<string, number>(); // team → earliest start of its next match
  let prevRoundEnd = -Infinity; // the previous round's last finish
  let curRoundEnd = -Infinity;

  // Round-ascending, match_no order. Round r can't start until strictly after the
  // last time-slot used by round r−1 (so a SF follows its QFs; groups precede KO).
  const sorted = [...fixtures].sort((a, b) => a.round - b.round || a.match_no - b.match_no);
  let prevRoundMaxOrder = -1;
  let curRound = sorted.length ? sorted[0].round : 0;
  let curRoundMaxOrder = -1;

  const capacityError = (): ScheduleResult => {
    const perDayDefault = Math.max(1, slotsInWindow(defaultWindowMin));
    const needDays = Math.ceil(N / (G * perDayDefault));
    return {
      ok: false,
      code: 'CAPACITY',
      error:
        `These ${N} fixtures need ${N} slots, but the schedule (${G} ground${G > 1 ? 's' : ''} at ` +
        `${D} min/match across ${days} day${days > 1 ? 's' : ''}) fits only ${rawCapacity}. ` +
        `Add a ground, extend to ${needDays} day${needDays > 1 ? 's' : ''}, or shorten the match duration` +
        (R > 0 ? ` — or the ${R}-minute rest between a team’s matches.` : '.') +
        (shared ? ' The courts are shared with the tournament’s other events, and a player in two events can’t play both at once.' : ''),
    };
  };

  for (const f of sorted) {
    if (f.round !== curRound) {
      prevRoundMaxOrder = curRoundMaxOrder;
      prevRoundEnd = curRoundEnd;
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
      // BUILD 4.9: rest after the team's last match, or after the last round.
      if (R > 0) {
        const at = absStart(order);
        if (at < prevRoundEnd + R) continue;
        if (hasTeams && (at < (teamFree.get(f.team_a_id!) ?? -Infinity) || at < (teamFree.get(f.team_b_id!) ?? -Infinity))) continue;
      }
      // Badminton gap 3: none of these players is playing (or resting) in another event then.
      if (hasTeams && playerBusy.size > 0) {
        const at = absStart(order);
        const clash = [...playersFor(f.team_a_id), ...playersFor(f.team_b_id)]
          .some((p) => (playerBusy.get(p) ?? []).some(([s0, e0]) => at < e0 + R && at + D + R > s0));
        if (clash) continue;
      }
      const groundIdx = usedGround[order].findIndex((u) => !u);
      if (groundIdx === -1) continue; // this time-slot's grounds are all taken
      usedGround[order][groundIdx] = true;
      if (hasTeams) {
        teamsAt[order].add(f.team_a_id!);
        teamsAt[order].add(f.team_b_id!);
      }
      const meta = timeSlotMeta[order]!;
      assignments.set(keyOf(f.round, f.match_no), {
        scheduled_at: slotUtcIso(cfg.startDateYmd, meta.dayIndex, meta.wallMin),
        ground_label: groundLabelFor(groundIdx, cfg.groundNames),
      });
      curRoundMaxOrder = Math.max(curRoundMaxOrder, order);
      curRoundEnd = Math.max(curRoundEnd, absStart(order) + D);
      if (R > 0 && hasTeams) {
        teamFree.set(f.team_a_id!, absStart(order) + D + R);
        teamFree.set(f.team_b_id!, absStart(order) + D + R);
      }
      if (hasTeams && cfg.playersOf) {
        for (const p of [...playersFor(f.team_a_id), ...playersFor(f.team_b_id)]) {
          playerBusy.set(p, [...(playerBusy.get(p) ?? []), [absStart(order), absStart(order) + D]]);
        }
      }
      placed = true;
      break;
    }
    if (!placed) return capacityError();
  }

  return { ok: true, assignments };
}

// Format a stored UTC slot as "Sat 15 Jul · 14:00 · Ground 2" in IST (for
// change-notification copy). Manual IST shift — no Intl/tz dependency.
export function formatSlotIst(scheduledAt: string | null | undefined, groundLabel: string | null | undefined): string {
  const parts: string[] = [];
  if (scheduledAt) {
    const d = new Date(scheduledAt);
    if (!isNaN(d.getTime())) {
      const ist = new Date(d.getTime() + TOURNAMENT_TZ_OFFSET_MIN * 60000);
      const days = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
      const mons = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
      const hh = String(ist.getUTCHours()).padStart(2, '0');
      const mm = String(ist.getUTCMinutes()).padStart(2, '0');
      parts.push(`${days[ist.getUTCDay()]} ${ist.getUTCDate()} ${mons[ist.getUTCMonth()]}`, `${hh}:${mm}`);
    }
  }
  if (groundLabel) parts.push(groundLabel);
  return parts.length ? parts.join(' · ') : 'a new slot';
}

// Stored UTC slot → "HH:MM" in IST. Same manual IST shift as formatSlotIst (one
// timezone path, not a second — SC-271) but returns only the wall-clock time, for
// imminent-reminder copy where the date is redundant.
export function formatTimeIst(scheduledAt: string | null | undefined): string | null {
  if (!scheduledAt) return null;
  const d = new Date(scheduledAt);
  if (isNaN(d.getTime())) return null;
  const ist = new Date(d.getTime() + TOURNAMENT_TZ_OFFSET_MIN * 60000);
  const hh = String(ist.getUTCHours()).padStart(2, '0');
  const mm = String(ist.getUTCMinutes()).padStart(2, '0');
  return `${hh}:${mm}`;
}

/** 'YYYY-MM-DD' + n days → 'YYYY-MM-DD' (used to resolve per-day window overrides). */
export function addDaysYmd(startYmd: string, n: number): string {
  const [y, m, d] = startYmd.split('-').map(Number);
  return new Date(Date.UTC(y, m - 1, d + n)).toISOString().slice(0, 10);
}

/** A stored UTC instant on the schedule's minute clock (minutes from 00:00 IST on its start date). */
export function absMinutesOf(iso: string, startYmd: string): number {
  const [y, m, d] = startYmd.split('-').map(Number);
  const base = Date.UTC(y, m - 1, d) - TOURNAMENT_TZ_OFFSET_MIN * 60000;
  return Math.round((Date.parse(iso) - base) / 60000);
}
