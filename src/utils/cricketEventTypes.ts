/**
 * Closed lists for cricket scoring events (B06-F6). Server-only: cricketRules
 * is a byte-identical copy of the app's file, so these live beside it.
 */
/** The extras a scorer can record (B06-F6): wide, no-ball, bye, leg bye. */
export const CRICKET_EXTRA_TYPES: ReadonlySet<string> = new Set(['Wd', 'Nb', 'B', 'Lb']);

/**
 * Ways a batter can leave the crease (B06-F6) — the app's sheet plus the rare
 * Laws dismissals and `other`, compared the way isDismissal compares them
 * (case and punctuation ignored: `run_out` = `runout`).
 */
const WICKET_TYPES = new Set([
  'bowled', 'caught', 'lbw', 'runout', 'stumped', 'hitwicket', 'hitroof', 'retiredhurt', 'retiredout', 'retirednotout',
  'obstructingthefield', 'handledtheball', 'hittheballtwice', 'timedout', 'other',
]);
export function isKnownWicketType(wicketType: unknown): boolean {
  return typeof wicketType === 'string' && WICKET_TYPES.has(wicketType.toLowerCase().replace(/[^a-z]/g, ''));
}
