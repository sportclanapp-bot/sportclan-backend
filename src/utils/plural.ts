/** "1 match" / "2 matches" — a count with its noun agreeing (V-7). Mirrors the app's utils/plural. */
export function plural(n: number, one: string, many: string): string {
  return `${n} ${n === 1 ? one : many}`;
}
