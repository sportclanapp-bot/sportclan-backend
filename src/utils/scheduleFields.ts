/**
 * Badminton 7.12 (Oct 2026) · the schedule settings — day hours, match length,
 * gap, courts / grounds and their names — can be changed after a tournament is
 * made. Checked here when they're edited (create is unchanged, so an older
 * app's form keeps working). Sport-neutral.
 */
import type { Refusal } from './tournamentSettings';
import { isCount } from './validation';

const refuse = (error: string, field: string): Refusal & { field: string } => ({ error, code: 'BAD_SCHEDULE', field } as Refusal & { field: string });
const TIME = /^([01]\d|2[0-3]):[0-5]\d(:\d\d)?$/;
const minutes = (t: string) => Number(t.slice(0, 2)) * 60 + Number(t.slice(3, 5));
const isInt = (x: unknown, lo: number, hi: number) => typeof x === 'number' && Number.isInteger(x) && x >= lo && x <= hi;

/** A worded problem with the schedule fields in an edit, or null. `cur` fills what isn't sent. */
export function scheduleRefusal(body: Record<string, unknown>, cur: Record<string, unknown> = {}): (Refusal & { field: string }) | null {
  const has = (k: string) => k in body && body[k] !== null && body[k] !== '';
  for (const k of ['daily_start_time', 'daily_end_time']) {
    if (has(k) && (typeof body[k] !== 'string' || !TIME.test(body[k] as string))) return refuse('Day hours are HH:MM, e.g. 08:00.', k);
  }
  const start = (k: string) => (k in body ? body[k] : cur[k]) as string | null | undefined;
  const s = start('daily_start_time'); const e = start('daily_end_time');
  if (('daily_start_time' in body || 'daily_end_time' in body) && s && e && TIME.test(s) && TIME.test(e) && minutes(e) <= minutes(s)) {
    return refuse('The day ends after it starts.', 'daily_end_time');
  }
  if (has('match_duration_minutes') && !isInt(body.match_duration_minutes, 5, 600)) return refuse('A match is 5 to 600 minutes.', 'match_duration_minutes');
  if (has('buffer_minutes') && !isInt(body.buffer_minutes, 0, 240)) return refuse('The gap between matches is 0 to 240 minutes.', 'buffer_minutes');
  // Oct 2026: no cap on courts — at least one.
  if (has('ground_count') && !isCount(body.ground_count, 1)) return refuse('At least one court or ground.', 'ground_count');
  if ('ground_names' in body && body.ground_names !== null) {
    const n = body.ground_names;
    if (!Array.isArray(n) || n.some((x) => typeof x !== 'string' || !x.trim() || x.trim().length > 40)) {
      return refuse('Each name is 1 to 40 characters.', 'ground_names');
    }
    if (new Set(n.map((x: string) => x.trim().toLowerCase())).size !== n.length) return refuse('Two courts have the same name.', 'ground_names');
  }
  return null;
}
