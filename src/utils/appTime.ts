// SC-90/91/92/93: single source of truth for the app's calendar boundaries.
// SportClan's audience is India (IST, UTC+5:30), so "today" and "this month"
// mean the IST calendar day/month everywhere — check-in, the free-tier post cap,
// the post→coin daily bucket, and the monthly leaderboard must all agree.
//
// All helpers are timezone-EXPLICIT (Asia/Kolkata) and therefore independent of
// the host/process tz (Render runs UTC) and the DB session tz — they return the
// same result no matter where the code runs.

const IST_OFFSET_MS = 5.5 * 60 * 60 * 1000; // +05:30

/** IST-shifted Date whose UTC getters read as the IST wall-clock. */
function istParts(d: Date): { y: number; m: number; day: number } {
  const shifted = new Date(d.getTime() + IST_OFFSET_MS);
  return { y: shifted.getUTCFullYear(), m: shifted.getUTCMonth(), day: shifted.getUTCDate() };
}

/** Calendar day in IST as `YYYY-MM-DD` (the app's day). */
export function istDay(d: Date = new Date()): string {
  return d.toLocaleDateString('en-CA', { timeZone: 'Asia/Kolkata' });
}

/**
 * UTC instant (ISO string) of the START of the current IST calendar day —
 * i.e. IST 00:00 today, expressed as the UTC timestamp to compare `created_at`
 * (timestamptz) against. e.g. IST 2026-07-07 00:00 → 2026-07-06T18:30:00.000Z.
 */
export function istDayStartIso(d: Date = new Date()): string {
  const { y, m, day } = istParts(d);
  return new Date(Date.UTC(y, m, day) - IST_OFFSET_MS).toISOString();
}

/**
 * UTC instant (ISO string) of the START of the current IST calendar month —
 * IST 00:00 on the 1st, as a UTC timestamp. e.g. IST 2026-07-01 00:00 →
 * 2026-06-30T18:30:00.000Z. Matches
 * `date_trunc('month', now() AT TIME ZONE 'Asia/Kolkata') AT TIME ZONE 'Asia/Kolkata'`.
 */
export function istMonthStartIso(d: Date = new Date()): string {
  const { y, m } = istParts(d);
  return new Date(Date.UTC(y, m, 1) - IST_OFFSET_MS).toISOString();
}
