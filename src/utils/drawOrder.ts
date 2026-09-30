/**
 * BUILD 4.6 · the order approved entries go into the draw (1 = strongest seed:
 * a knockout's seeding, the order a groups draw deals them round the groups).
 *
 *   absent        the organiser's seeds when set, then entry time (SC-378, as before)
 *   registration  entry time only
 *   manual        the organiser's seeds, then entry time for any without one
 *   random        a random draw — the caller stores the order as seeds, so the
 *                 draw can be seen and explained afterwards
 * The team id settles anything left level, so the order is always total.
 */
import type { SeedingMode } from './tournamentSettings';

export type DrawEntry = { team_id: string; seed?: number | null; entered_at?: string | null };

const byTime = (a: DrawEntry, b: DrawEntry) =>
  String(a.entered_at ?? '').localeCompare(String(b.entered_at ?? '')) || (a.team_id < b.team_id ? -1 : a.team_id > b.team_id ? 1 : 0);
const bySeed = (a: DrawEntry, b: DrawEntry) => {
  const sa = a.seed ?? Infinity;
  const sb = b.seed ?? Infinity;
  return sa !== sb ? (sa < sb ? -1 : 1) : byTime(a, b);
};

export function drawOrder<T extends DrawEntry>(entries: T[], mode: SeedingMode | null | undefined, random: () => number = Math.random): T[] {
  const list = entries.slice();
  if (mode === 'registration') return list.sort(byTime);
  if (mode === 'random') {
    list.sort(byTime); // a fixed start, so only the shuffle decides
    for (let i = list.length - 1; i > 0; i--) {
      const j = Math.floor(random() * (i + 1));
      [list[i], list[j]] = [list[j]!, list[i]!];
    }
    return list;
  }
  return list.sort(bySeed);
}
