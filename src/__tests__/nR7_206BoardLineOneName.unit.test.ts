/**
 * N-R7-206 (SP-CRM-011): a carrom singles board read '⚪ Board to P3 · +6 (P3)' — the pad credits the
 * side's only player, and the line named it twice. The plain line every sport falls back to did the same.
 */
import { sportCommentary, timelineLine } from '../utils/commentary';

const ctx = (sport: string, teamA = 'P3 Player C', teamB = 'P4 Player D') => ({ sport, teamA, teamB, period: 1 } as never);
test('carrom singles board names the side once', () => {
  expect(sportCommentary('score', { kind: 'board', team_side: 'A', value: 6, player_name: 'P3 Player C' }, ctx('carrom'))).toBe('⚪ Board to P3 Player C · +6');
});
test('carrom doubles board still names who pocketed it', () => {
  expect(sportCommentary('score', { kind: 'board', team_side: 'A', value: 6, player_name: 'Asha' }, ctx('carrom', 'Asha / Chitra'))).toBe('⚪ Board to Asha / Chitra · +6 (Asha)');
});
test('the plain fallback line names a singles side once', () => {
  const line = timelineLine('note', { kind: 'let_call', team_side: 'B', player_name: 'P4 Player D' }, ctx('table_tennis')).text;
  expect(line).not.toContain('(P4 Player D)');
  expect(line).toContain('P4 Player D');
});
