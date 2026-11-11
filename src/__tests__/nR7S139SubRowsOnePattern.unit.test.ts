/**
 * N-R7-S139 (SIDE-C6b-2): a hockey timeline worded its sub rows two ways: a full sub
 * '🔁 Lions: X on for Y' (no label) next to '🔁 Substitution — Lions: Y off' and '🩹 Injury sub — …'.
 * Every sub row now reads '<icon> <label> — <team>: …'.
 */
import { sportCommentary } from '../utils/commentary';

const ctx = (sport: string) => ({ sport, teamA: 'Lions', teamB: 'Tigers', period: 0, move: 0, clockSeconds: null, regulation: 4, periodMinutes: null }) as never;

test.each(['hockey', 'football', 'basketball', 'volleyball'])('%s: a full sub has the label', (sport) => {
  const full = sportCommentary('sub', { team_side: 'A', player_name: 'Player 2', off_name: 'Player 3' }, ctx(sport));
  expect(full).toMatch(/^🔁 Substitution — .+: Player 2 on for Player 3$/);
  const off = sportCommentary('sub', { team_side: 'A', off_name: 'Player 3' }, ctx(sport));
  expect(off).toMatch(/^🔁 Substitution — .+: Player 3 off$/);
  expect(sportCommentary('sub', { team_side: 'A', player_name: 'Player 2', off_name: 'Player 3', injury: true }, ctx(sport))).toMatch(/^🩹 Injury sub — .+: Player 2 on for Player 3$/);
  expect(full!.replace(/^🔁 Substitution — /, '').split(':')[0]).toBe(off!.replace(/^🔁 Substitution — /, '').split(':')[0]);
});
