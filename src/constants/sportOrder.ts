/**
 * The one order sports are listed in — the app's Home order, Cricket first
 * (app: src/utils/sportOrder.ts). GET /sports returns sports in it, whatever
 * `display_order` holds (migration 117 aligns that column too).
 */
export const SPORT_ORDER = [
  'cricket', 'badminton', 'football', 'tennis', 'table-tennis', 'pickleball',
  'chess', 'carrom', 'volleyball', 'basketball', 'hockey',
] as const;

const norm = (s: string): string => s.toLowerCase().replace(/[-_\s]/g, '');
const RANK = new Map(SPORT_ORDER.map((s, i) => [norm(s), i]));

/** Sorts sport rows into SPORT_ORDER; unknown sports after, by display_order. */
export function sortSports<T extends { slug?: string | null; display_order?: number | null }>(rows: readonly T[]): T[] {
  const rank = (r: T) => RANK.get(norm(r.slug ?? '')) ?? SPORT_ORDER.length;
  return [...rows].sort((a, b) => rank(a) - rank(b) || (a.display_order ?? 0) - (b.display_order ?? 0));
}
