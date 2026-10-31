/**
 * N-R7-79 (Step 2 · Batch 5, SPP1-TEN-053): a singles code violation read
 * '⚠️ Code violation — P3 Rahul (P3 Rahul) · time · warning' — the side is named after its player.
 */
import { sportCommentary } from '../utils/commentary';

const ctx = { sport: 'tennis', teamA: 'P3 Rahul', teamB: 'P3 Vikram', period: 0, move: 0, clockSeconds: null, regulation: 2, periodMinutes: null } as never;
test('the player is named once when the side is the player', () => {
  expect(sportCommentary('note', { kind: 'violation', team_side: 'A', offence: 'time', penalty: 'warning', player_name: 'P3 Rahul' }, ctx)).toBe('⚠️ Code violation — P3 Rahul · time · warning');
  expect(sportCommentary('note', { kind: 'violation', team_side: 'A', offence: 'abuse', penalty: 'game', player_name: 'Ravi' }, ctx)).toBe('⚠️ Code violation — Ravi (P3 Rahul) · racket or ball abuse · game penalty');
});
