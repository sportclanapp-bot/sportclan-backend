/**
 * Stage 8 · F4 / F9 / F10 · the football timeline: penalty goals, assists,
 * substitutions (who on for whom), a second yellow's red, the clock stopped and
 * restarted, the added time, and the shoot-out kick by kick — with the minute
 * when the clock runs. Player rollups count assists and both cards.
 */
import { sportCommentary } from '../utils/commentary';
import { aggregateGoalPlayers } from '../controllers/scoring.controller';

const ctx = (sport: string, extra: object = {}) => ({ sport, teamA: 'Lions', teamB: 'Tigers', period: 0, move: 0, clockSeconds: null, regulation: 2, periodMinutes: null, ...extra });

test('the new lines', () => {
  expect(sportCommentary('score', { team_side: 'A', kind: 'goal', penalty: true, player_name: 'Ravi' }, ctx('football'))).toBe('⚽ GOAL! Lions — Ravi (penalty)');
  expect(sportCommentary('assist', { team_side: 'A', kind: 'assist', player_name: 'Amit' }, ctx('football'))).toBe('🅰️ Assist — Amit (Lions)');
  expect(sportCommentary('sub', { team_side: 'B', kind: 'sub', player_name: 'Kiran', off_name: 'Dev' }, ctx('football'))).toBe('🔁 Tigers: Kiran on for Dev');
  expect(sportCommentary('sub', { team_side: 'B', kind: 'sub', off_name: 'Dev' }, ctx('football'))).toBe('🔁 Substitution — Tigers: Dev off');
  expect(sportCommentary('card', { team_side: 'A', kind: 'red', second_yellow: true, player_name: 'Ravi' }, ctx('football'))).toBe('🟨🟥 Second yellow, sent off — Ravi (Lions)');
  expect(sportCommentary('note', { kind: 'clock_pause' }, ctx('football'))).toBe('⏸ Clock stopped');
  expect(sportCommentary('note', { kind: 'clock_resume' }, ctx('football'))).toBe('▶ Clock restarted');
  expect(sportCommentary('note', { kind: 'added_time', minutes: 4 }, ctx('football'))).toBe('⏱ +4 min added time');
  expect(sportCommentary('note', { kind: 'shootout_kick', team_side: 'A', scored: true, player_name: 'Ravi' }, ctx('football'))).toBe('✅ Scored — penalty by Ravi (Lions)');
  expect(sportCommentary('note', { kind: 'shootout_kick', team_side: 'B', scored: false }, ctx('hockey'))).toBe('❌ Missed — shoot-out by Tigers');
  // the shoot-out starts / is backed out of: no minute either
  expect(sportCommentary('note', { kind: 'shootout_start' }, ctx('football', { clockSeconds: 352, periodMinutes: 25 }))).toBe('🥅 Penalty shoot-out');
  expect(sportCommentary('note', { kind: 'shootout_start' }, ctx('hockey'))).toBe('🥅 Shoot-out');
  expect(sportCommentary('note', { kind: 'shootout_cancel' }, ctx('football', { clockSeconds: 352, periodMinutes: 25 }))).toBe('↩ Back to the match — no penalties yet');
  // on the match clock still: a kick has no minute (found on the device: "6' ✅ Scored…")
  expect(sportCommentary('note', { kind: 'shootout_kick', team_side: 'A', scored: true, player_name: 'Ravi' }, ctx('football', { clockSeconds: 352, periodMinutes: 25 }))).toBe('✅ Scored — penalty by Ravi (Lions)');
});

test('with the clock running, the minute leads', () => {
  expect(sportCommentary('assist', { team_side: 'A', kind: 'assist', player_name: 'Amit' }, ctx('football', { clockSeconds: 1330, periodMinutes: 45 }))).toBe("23' 🅰️ Assist — Amit (Lions)");
});

test('rollups: assists counted; a second yellow is a yellow and a red', () => {
  const lines = aggregateGoalPlayers([
    { event_type: 'score', payload: { team_side: 'A', kind: 'goal', value: 1, penalty: true, player_id: 'p1' } },
    { event_type: 'assist', payload: { team_side: 'A', kind: 'assist', player_id: 'p2' } },
    { event_type: 'card', payload: { team_side: 'A', kind: 'yellow', player_id: 'p1' } },
    { event_type: 'card', payload: { team_side: 'A', kind: 'yellow', player_id: 'p1' } },
    { event_type: 'card', payload: { team_side: 'A', kind: 'red', second_yellow: true, player_id: 'p1' } },
    { event_type: 'sub', payload: { team_side: 'A', kind: 'sub', player_id: 'p3', off_id: 'p2' } },
  ]);
  expect(lines.p1).toMatchObject({ goals: 1, yellow_cards: 2, red_cards: 1 });
  expect(lines.p2).toMatchObject({ assists: 1, goals: 0 });
  expect(lines.p3).toBeUndefined(); // a sub isn't a stat
});

// Stage 9 · T10: the warm-up and a medical time-out on the timeline (any sport); a receiver swap isn't said.
test('warm-up, medical time-out; receiver swap silent', () => {
  expect(sportCommentary('note', { kind: 'warmup' }, ctx('tennis'))).toBe('⏱ Warm-up');
  expect(sportCommentary('note', { kind: 'medical_timeout', team_side: 'B' }, ctx('pickleball'))).toBe('🩺 Medical time-out — Tigers');
  expect(sportCommentary('note', { kind: 'receiver_swap', team_side: 'A' }, ctx('tennis'))).toBeNull();
});

