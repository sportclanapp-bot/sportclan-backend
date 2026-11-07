/**
 * N-R7-185 · Step 2 · Batch 8 · OBS-Q2d-2: a team chess board's misconduct note now names the
 * offender's TEAM (team_side) and keeps the colour they play on the board (colour: 'white'/'black');
 * the ladder's time step (add_time) still goes to the other COLOUR's clock. On board 2 (team B has
 * White) White's time step was refused (team_side 'B' vs add_time side 'B'). The ladder check
 * reads the colour when the note has one; the timeline names the offender's team and player.
 */
import { ladderTimePenaltyOk } from '../controllers/scoring.controller';
import { standardRules } from '../utils/matchRules';
import { sportCommentary } from '../utils/commentary';

const rapid = { ...standardRules('chess'), baseMinutes: 15, incrementSeconds: 10 };
const m = { rules: rapid };
const v = (payload: Record<string, unknown>) => ({ event_type: 'note', payload: { kind: 'violation', offence: 'talking', penalty: 'time', n: 2, ...payload } });

test("board 2: White (team B) gets the time step → +1 min on Black's clock (side B) is the ladder's", () => {
  expect(ladderTimePenaltyOk(m, { kind: 'add_time', side: 'B', seconds: 60 }, v({ team_side: 'B', colour: 'white' }))).toBe(true);
  expect(ladderTimePenaltyOk(m, { kind: 'add_time', side: 'A', seconds: 60 }, v({ team_side: 'B', colour: 'white' }))).toBe(false);
});

test('a note without a colour (a single game) still reads team_side as the colour side', () => {
  expect(ladderTimePenaltyOk(m, { kind: 'add_time', side: 'B', seconds: 60 }, v({ team_side: 'A' }))).toBe(true);
  expect(ladderTimePenaltyOk(m, { kind: 'add_time', side: 'A', seconds: 60 }, v({ team_side: 'A' }))).toBe(false);
});

test("the timeline names the offender's team, player and board", () => {
  const ctx = { sport: 'chess', teamA: 'P3 S2B8 Knights', teamB: 'P3 S2B8 Rooks', period: 0 };
  const line = sportCommentary('note', { kind: 'violation', team_side: 'B', colour: 'white', player_name: 'P3 S2B8 Rooks Board 2', offence: 'talking', penalty: 'warning', n: 1, board: 'B2' }, ctx as never);
  expect(line).toBe('⚠️ Misconduct — P3 S2B8 Rooks Board 2 (P3 S2B8 Rooks) · board 2 · talked or analysed in play · warning');
  expect(sportCommentary('note', { kind: 'violation', team_side: 'A', offence: 'talking', penalty: 'warning', n: 1 }, ctx as never)).toBe('⚠️ Misconduct — P3 S2B8 Knights · talked or analysed in play · warning');
});
