/**
 * Match length — ONE rule for the app and the server.
 *
 * This file is byte-identical in both repos:
 *   app     src/scoring/matchLength.ts
 *   server  src/utils/matchLength.ts
 * and both repos run the same fixture table against it (matchLength test), so
 * the two copies cannot drift without a test failing. Edit both, or neither.
 *
 * The one per-match setting the best-of sports take (decision B, 25 Sep 2026):
 * how many games / sets / games-of-carrom the match is "best of". Every other
 * rule (points to win, win by 2, caps, tiebreaks) stays fixed.
 *
 * Stored on the match in `format` as "bo1" / "bo3" / "bo5" / "bo7". A match
 * created before this (format = the sport slug, or null) is the sport's
 * standard length, so old matches keep scoring exactly as they did.
 */

export type BestOf = 1 | 3 | 5 | 7;

export interface MatchLengthRule {
  /** The presets the create form offers, shortest first. */
  options: BestOf[];
  /** The standard length — and what a match without a preset plays. */
  standard: BestOf;
  /** What one unit is called: "1 game", "Best of 3 sets". */
  unit: 'game' | 'set';
}

export const MATCH_LENGTHS: Record<string, MatchLengthRule> = {
  badminton: { options: [1, 3], standard: 3, unit: 'game' },
  tabletennis: { options: [1, 3, 5, 7], standard: 5, unit: 'game' },
  pickleball: { options: [1, 3], standard: 3, unit: 'game' },
  volleyball: { options: [3, 5], standard: 5, unit: 'set' },
  tennis: { options: [1, 3], standard: 3, unit: 'set' },
  carrom: { options: [1, 3], standard: 3, unit: 'game' },
};

/** 'table-tennis' → 'tabletennis': the key form used above. */
export function lengthKey(sport: string | null | undefined): string {
  return (sport ?? '').toLowerCase().replace(/[-_\s]/g, '');
}

export function formatForBestOf(n: BestOf): string {
  return `bo${n}`;
}

/**
 * The match's best-of. A preset the sport does not offer, or no preset at all,
 * is the sport's standard length. Null for a sport that is not best-of.
 */
export function bestOfFor(sport: string | null | undefined, format: string | null | undefined): BestOf | null {
  const rule = MATCH_LENGTHS[lengthKey(sport)];
  if (!rule) return null;
  const m = /^bo([1357])$/.exec(String(format ?? '').trim());
  const n = m ? (Number(m[1]) as BestOf) : null;
  return n !== null && rule.options.includes(n) ? n : rule.standard;
}

/** Games / sets needed to win a best-of-n match. */
export function winsNeeded(bestOf: number): number {
  return Math.floor(bestOf / 2) + 1;
}

/**
 * Is this `format` acceptable at creation for this sport? A preset must be one
 * the sport offers; anything that is not a preset (an older app sends the sport
 * slug) is accepted and means the standard length.
 */
export function isAcceptableMatchLength(sport: string | null | undefined, format: string | null | undefined): boolean {
  const rule = MATCH_LENGTHS[lengthKey(sport)];
  if (!rule) return true;
  const m = /^bo(\d+)$/.exec(String(format ?? '').trim());
  if (!m) return true;
  return rule.options.includes(Number(m[1]) as BestOf);
}

/** "1 game", "1 set", "Best of 3", "Best of 5 sets". */
export function matchLengthLabel(sport: string | null | undefined, format: string | null | undefined): string | null {
  const rule = MATCH_LENGTHS[lengthKey(sport)];
  const n = bestOfFor(sport, format);
  if (!rule || n === null) return null;
  if (n === 1) return `1 ${rule.unit}`;
  return rule.unit === 'set' ? `Best of ${n} sets` : `Best of ${n}`;
}
