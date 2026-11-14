/**
 * N-R7-475 (SIDE-XS1-1): the void / restore refusal names who really can do it. canVoidMatch lets the
 * umpire, an admin and — on a casual match — the match's creator, on a tournament match the organiser.
 */
export function voidRefusal(match: { tournament_id?: string | null }, verb: 'void' | 'restore'): string {
  const who = match.tournament_id ? 'an organiser' : 'the match’s creator';
  return `Only ${who}, the umpire or an admin can ${verb} a match.`;
}
