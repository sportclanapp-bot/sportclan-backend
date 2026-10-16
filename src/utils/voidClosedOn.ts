/**
 * N-RWG3-2 (launch test plan) · a void deadline, written one way everywhere: in India
 * time and the app's date style — "Wed, 21 Oct · 2:00 am". The server's late-void
 * refusal said "Tue Oct 20 2026" (the server's own UTC day, in another style), so for a
 * match that ended between midnight and 5:30 am IST it named the day before the one the
 * app showed.
 *
 * Byte-for-byte the same file in the app (src/utils/voidClosedOn.ts) and the backend
 * (src/utils/voidClosedOn.ts) — a test checks it. No imports.
 */

const IST_OFFSET_MS = 330 * 60_000; // UTC+5:30, no daylight saving
const DAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

/** The IST wall clock of an instant (read it with the UTC getters). */
const ist = (d: Date): Date => new Date(d.getTime() + IST_OFFSET_MS);

/** "2:00 am", in India time. */
export function istTime12(d: Date): string {
  const t = ist(d);
  const h = t.getUTCHours();
  return `${h % 12 === 0 ? 12 : h % 12}:${String(t.getUTCMinutes()).padStart(2, '0')} ${h < 12 ? 'am' : 'pm'}`;
}

/** "Wed, 21 Oct", in India time. */
export function istDayAndShortDate(d: Date): string {
  const t = ist(d);
  return `${DAYS[t.getUTCDay()]}, ${t.getUTCDate()} ${MONTHS[t.getUTCMonth()]}`;
}

/** "Wed, 21 Oct · 2:00 am" — when a void window closes (or closed). */
export function voidClosedOn(d: Date): string {
  return `${istDayAndShortDate(d)} · ${istTime12(d)}`;
}
