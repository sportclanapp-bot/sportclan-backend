import { sportTerms } from './sportTerms';

/**
 * Audit #86 (11 Oct 2026) · how a stored tournament-official role reads in this
 * sport — the app's officialRoleLabel (src/sport/officialRoles.ts). The
 * "you're an official" notice said "assigned as chief_referee".
 */
export function officialRoleLabel(sport: string | null | undefined, role: string): string {
  const t = sportTerms(sport);
  const main = t.official === 'Umpire' ? 'umpire' : 'referee';
  if (role === main) return t.official;
  if (role === 'umpire') return 'Umpire';
  if (role === 'referee') return 'Referee';
  if (role === 'assistant') return t.assistant;
  if (role === 'chief_referee') return t.referee;
  if (role === 'deputy_referee') return t.deputyReferee ?? `Deputy ${t.referee.toLowerCase()}`;
  if (role === 'pairings' || role === 'sector' || role === 'fair_play') return t.deskRoles[role] ?? { pairings: 'Pairings official', sector: 'Sector official', fair_play: 'Fair-play official' }[role];
  if (role === 'scorer') return 'Scorer';
  if (role === 'commentator') return 'Commentator';
  return t.assistants.find((a) => a.key === role)?.label ?? role;
}
