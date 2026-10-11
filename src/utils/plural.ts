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

/** Audit #138: "1st", "2nd", "3rd", "4th", "11th", "12th", "13th", "21st", "22nd", "23rd", "101st", "111th". */
export function ordinal(n: number): string {
  const t = Math.abs(n) % 100;
  const suf = t >= 11 && t <= 13 ? 'th' : ({ 1: 'st', 2: 'nd', 3: 'rd' } as Record<number, string>)[Math.abs(n) % 10] ?? 'th';
  return `${n}${suf}`;
}
