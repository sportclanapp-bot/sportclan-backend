/**
 * "1 match" / "2 matches" — a count with its noun agreeing (V-7).
 *
 * `plural(1, 'match', 'matches')` → "1 match". The plural form is spelled out
 * when it isn't just an added "s" (match → matches, person → people); English
 * plurals are not worth guessing at. `pluralWord` gives the noun alone, for
 * labels that print the number separately.
 *
 * Audit #141 / #142 (11 Oct 2026): one helper on the server and one in the app —
 * byte-for-byte the same file (app src/utils/plural.ts, server
 * src/utils/plural.ts). −1 is singular too ("−1 fair-play point").
 */
export function plural(n: number, one: string, many: string = `${one}s`): string {
  return `${n} ${pluralWord(n, one, many)}`;
}

export function pluralWord(n: number, one: string, many: string = `${one}s`): string {
  return Math.abs(n) === 1 ? one : many;
}
