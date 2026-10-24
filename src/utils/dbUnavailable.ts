/**
 * N-R7-S7 · a database that cannot be reached is not a missing row.
 *
 * Reads like `const { data: match } = await supabase…maybeSingle()` dropped the
 * error, so with the database down a match read as "not there" and the answer was
 * 404 "Match not found". The scoring outbox treats a 4xx as a refusal and drops
 * the point; a 5xx it keeps and sends again. So a failed read answers 503.
 */
export const DB_UNAVAILABLE_STATUS = 503;
export const DB_UNAVAILABLE = {
  error: "Can't reach the database right now. Try again in a moment.",
  code: 'DB_UNAVAILABLE',
} as const;
