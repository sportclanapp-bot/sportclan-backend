/**
 * Phase 3 · B08 (28 Sep 2026) · what a tournament's details must be, on create
 * AND edit.
 *
 * Only lengths were checked. A name of "   " or {"a":1} was stored, an edit
 * could blank the name or put the end date before the start, a negative entry
 * fee saved, and text in a date or number column reached Postgres and came back
 * as a 500. These are the rules, in one place, with the words the organiser
 * sees.
 */
import { isUuid } from './uuid';
import { LIMITS } from './validation';
import type { TournamentStatus } from './tournamentStatus';

export type Refusal = { error: string; code?: string };

/** The four statuses the column allows (utils/tournamentStatus, migration 004). */
export const TOURNAMENT_STATUSES: readonly TournamentStatus[] = ['upcoming', 'live', 'completed', 'cancelled'];

/**
 * Older app builds filter the list by `registration` (or `draft`), which the
 * column never held — their Upcoming tab was always empty. Read them as the
 * status they meant.
 */
export function listStatusFilter(raw: unknown): TournamentStatus | null | 'bad' {
  if (raw === undefined || raw === null || raw === '') return null;
  if (typeof raw !== 'string') return 'bad';
  if (raw === 'registration' || raw === 'draft') return 'upcoming';
  return (TOURNAMENT_STATUSES as readonly string[]).includes(raw) ? (raw as TournamentStatus) : 'bad';
}

export const TOURNAMENT_NAME_MIN = 3;

export function tournamentNameRefusal(name: unknown): Refusal | null {
  if (typeof name !== 'string' || name.trim().length < TOURNAMENT_NAME_MIN) {
    return { error: `Give the tournament a name of at least ${TOURNAMENT_NAME_MIN} characters.`, code: 'INVALID_NAME' };
  }
  if (name.trim().length > LIMITS.tournamentNameMax) {
    return { error: `name must be ${LIMITS.tournamentNameMax} characters or fewer`, code: 'INVALID_NAME' };
  }
  return null;
}

const present = (v: unknown) => v !== undefined && v !== null && v !== '';
const isDateLike = (v: unknown) => typeof v === 'string' && Number.isFinite(Date.parse(v));
const TIME_RE = /^([01]\d|2[0-3]):[0-5]\d(:[0-5]\d)?$/;

/**
 * Dates, times, money, the schedule numbers and the city on a create or edit
 * body. Only the keys present are checked; `current` supplies the stored dates
 * so an edit that moves one end is still ordered against the other.
 */
export function tournamentDetailsRefusal(
  body: Record<string, unknown>,
  current: { start_date?: string | null; end_date?: string | null; registration_deadline?: string | null } = {},
): Refusal | null {
  for (const k of ['start_date', 'end_date', 'registration_deadline'] as const) {
    if (present(body[k]) && !isDateLike(body[k])) return { error: `${k} must be a date.`, code: 'INVALID_DATE' };
  }
  for (const k of ['daily_start_time', 'daily_end_time'] as const) {
    if (present(body[k]) && !(typeof body[k] === 'string' && TIME_RE.test(body[k] as string))) {
      return { error: `${k} must be a time like 09:00.`, code: 'INVALID_TIME' };
    }
  }
  const start = 'start_date' in body ? body.start_date : current.start_date;
  const end = 'end_date' in body ? body.end_date : current.end_date;
  if (present(start) && present(end) && isDateLike(start) && isDateLike(end)
      && Date.parse(end as string) < Date.parse(start as string)) {
    return { error: 'The end date can’t be before the start date.', code: 'END_BEFORE_START' };
  }
  // BUILD 4.10: entries close by the day the tournament starts, not after it.
  const deadline = 'registration_deadline' in body ? body.registration_deadline : current.registration_deadline;
  // Only when the edit moves one of them — an older tournament's other edits aren't held up.
  if (('registration_deadline' in body || 'start_date' in body) && present(start) && present(deadline) && isDateLike(start) && isDateLike(deadline)
      && Date.parse(deadline as string) > Date.parse(start as string) + 86_400_000) {
    return { error: 'Entries have to close by the day the tournament starts.', code: 'DEADLINE_AFTER_START' };
  }
  // BUILD 1.16: whole rupees. 12.5 passed this check and the int column then
  // refused it (a 500); a number past the column's range did the same.
  for (const k of ['entry_fee', 'prize_pool'] as const) {
    if (present(body[k])) {
      const n = Number(body[k]);
      if (typeof body[k] === 'boolean' || !Number.isFinite(n) || n < 0) {
        return { error: `${k} must be 0 or more.`, code: 'INVALID_AMOUNT' };
      }
      if (!Number.isInteger(n)) return { error: `${k} must be whole rupees.`, code: 'INVALID_AMOUNT' };
      if (n > MONEY_MAX) return { error: `${k} can be at most ₹${MONEY_MAX.toLocaleString('en-IN')}.`, code: 'INVALID_AMOUNT' };
    }
  }
  // Stage 13 · CR3 (Dipak): no app tops — only what the integer column holds.
  const ints: Array<[string, number, number]> = [
    ['match_duration_minutes', 1, 2_147_483_647],
    ['buffer_minutes', 0, 2_147_483_647],
    ['ground_count', 1, 2_147_483_647],
  ];
  for (const [k, min, max] of ints) {
    if (present(body[k])) {
      const n = Number(body[k]);
      if (typeof body[k] === 'boolean' || !Number.isInteger(n) || n < min || n > max) {
        return { error: `${k} must be a whole number, ${min} or more.`, code: 'INVALID_NUMBER' };
      }
    }
  }
  if (present(body.city_id) && !isUuid(body.city_id)) return { error: 'city_id must be a valid city.', code: 'INVALID_CITY' };
  const dw = dayWindowsRefusal(body.day_windows, start, end);
  if (dw) return dw;
  return null;
}

/** BUILD 1.16: the most an entry fee or prize can be. Stage 13 · CR3: no app top — what the money column holds (numeric(10,2)). */
export const MONEY_MAX = 99_999_999;

const YMD_RE = /^\d{4}-\d{2}-\d{2}$/;
const minutesOf = (t: string) => Number(t.slice(0, 2)) * 60 + Number(t.slice(3, 5));
const isRealYmd = (d: string) => {
  const t = Date.parse(`${d}T00:00:00Z`);
  return Number.isFinite(t) && new Date(t).toISOString().slice(0, 10) === d;
};

/**
 * BUILD 1.14 · per-day playing windows. They were stored without a check —
 * only rows missing a field were dropped, silently — so "25:00", an end before
 * the start (a day with no slots), a date outside the tournament or the same
 * day twice all went in. Each is refused now, before anything is saved.
 */
export function dayWindowsRefusal(windows: unknown, start?: unknown, end?: unknown): Refusal | null {
  if (windows === undefined || windows === null) return null;
  const bad = (error: string): Refusal => ({ error, code: 'INVALID_DAY_WINDOWS' });
  if (!Array.isArray(windows)) return bad('day_windows must be a list of days.');
  // Oct 2026: no cap on the days — each must be inside the tournament's dates (below).
  const from = present(start) && isDateLike(start) ? String(start).slice(0, 10) : null;
  const to = present(end) && isDateLike(end) ? String(end).slice(0, 10) : null;
  const seen = new Set<string>();
  for (const w of windows as unknown[]) {
    const r = (w && typeof w === 'object' ? w : {}) as Record<string, unknown>;
    const d = r.day_date;
    if (typeof d !== 'string' || !YMD_RE.test(d) || !isRealYmd(d)) return bad('Each day needs a date like 2026-10-05.');
    if (seen.has(d)) return bad(`${d} is listed twice.`);
    seen.add(d);
    for (const k of ['start_time', 'end_time'] as const) {
      if (!(typeof r[k] === 'string' && TIME_RE.test(r[k] as string))) return bad(`On ${d}, the ${k === 'start_time' ? 'start' : 'end'} must be a time like 09:00.`);
    }
    if (minutesOf(r.end_time as string) <= minutesOf(r.start_time as string)) return bad(`On ${d}, play has to end after it starts.`);
    if ((from && d < from) || (to && d > to)) return bad(`${d} is outside the tournament's dates.`);
  }
  return null;
}
