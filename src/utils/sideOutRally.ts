/**
 * N-R7-S17 · may a match take a side-out 'rally' event? A side-out pickleball
 * match — or a pickleball team tie with a side-out match in it (MLP: four
 * doubles side-out to 11, then the rally DreamBreaker). The app's tie pad
 * sends every action of such a tie as a 'rally' (its first match's payload),
 * so a tie whose own top-level scoring is rally refused them all: an MLP tie
 * could not be scored from the pad.
 */
import type { MatchRules } from './matchRules';

export function takesSideOutRally(slug: string, rules: Partial<MatchRules> | null | undefined): boolean {
  if (slug !== 'pickleball' || !rules) return false;
  if (rules.scoring === 'sideout') return true;
  const tie = rules.tie as { rubbers?: Array<{ rules?: { scoring?: unknown } | null }> } | null | undefined;
  return !!tie?.rubbers?.some((r) => r?.rules?.scoring === 'sideout');
}

/**
 * N-R7-S19 · a team tie with a timed match in it (WPBL: five 15-minute rally
 * matches) takes the pad's TIME CALLED — the time limit is that match's own
 * rule, not the tie's, so the buzzer was refused and a WPBL match could never
 * end at time (nor level).
 */
export function tieHasTimedMatch(rules: Partial<MatchRules> | null | undefined): boolean {
  const tie = rules?.tie as { rubbers?: Array<{ rules?: { timeLimitMinutes?: unknown } | null }> } | null | undefined;
  return !!tie?.rubbers?.some((r) => typeof r?.rules?.timeLimitMinutes === 'number' && r.rules.timeLimitMinutes > 0);
}
