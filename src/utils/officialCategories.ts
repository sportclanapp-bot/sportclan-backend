/**
 * Profile & Settings tidy-up (12 Oct 2026) · which Services card an official is in.
 *
 * The directory had "Umpires" (account type `umpire`, labelled "Umpire / Referee",
 * described "for cricket") and "Referees" (type `official`, "Official (other
 * sports)"). A football referee picks "Umpire / Referee", so they sat under the
 * cricket umpires and Referees stayed empty; and "Referees" and "Officials (other
 * sports)" were one list twice. Now an official is placed by the word their
 * sports use for one (sportTerms — the same file as the app's): Umpires (cricket,
 * hockey, badminton, tennis, table tennis, carrom), Referees (football,
 * basketball, volleyball, pickleball, kabaddi), Arbiters (chess). Someone who
 * officiates two kinds of sport is in both. Fix list 25 Nov 2026, item 1: the two
 * types are one role (Umpire / Referee / Official), so an official with no sports
 * listed is in one group, Umpires, whichever of the two is stored.
 */
import { sportTerms } from './sportTerms';

export const OFFICIAL_TYPES = ['umpire', 'official'] as const;
/** Either stored value of the one officials' role. */
export function isOfficialType(t: string): boolean {
  return (OFFICIAL_TYPES as readonly string[]).includes(t);
}
export type OfficialCategory = 'umpires' | 'referees' | 'arbiters';
export const OFFICIAL_CATEGORIES: readonly OfficialCategory[] = ['umpires', 'referees', 'arbiters'];

const BY_WORD: Record<string, OfficialCategory> = { Umpire: 'umpires', Referee: 'referees', Arbiter: 'arbiters' };

export function officialCategoriesOf(sportSlugs: readonly string[], accountTypes: readonly string[]): Set<OfficialCategory> {
  const out = new Set<OfficialCategory>();
  for (const s of sportSlugs) {
    const c = BY_WORD[sportTerms(s).official];
    if (c) out.add(c);
  }
  if (out.size === 0) {
    if (accountTypes.some((t) => (OFFICIAL_TYPES as readonly string[]).includes(t))) out.add('umpires');
  }
  return out;
}

export function isOfficialCategory(x: unknown): x is OfficialCategory {
  return typeof x === 'string' && (OFFICIAL_CATEGORIES as readonly string[]).includes(x);
}
