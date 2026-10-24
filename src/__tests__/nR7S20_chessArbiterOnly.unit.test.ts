/** N-R7-S20 · a plain scorer can't send the chess arbiter's calls through the API. */
import fs from 'fs';
import path from 'path';
import { chessArbiterOnly } from '../controllers/scoring.controller';

test('illegal move and wrong claim notes, and a game lost for two illegal moves / a phone / misconduct, are the arbiter’s', () => {
  expect(chessArbiterOnly('note', { kind: 'illegal_move', side: 'A', seconds: 60 })).toBe(true);
  expect(chessArbiterOnly('note', { kind: 'wrong_claim', side: 'B', seconds: 60 })).toBe(true);
  expect(chessArbiterOnly('result', { winner: 'white', reason: 'device' })).toBe(true);
  expect(chessArbiterOnly('result', { winner: 'black', reason: 'illegal_move' })).toBe(true);
  expect(chessArbiterOnly('result', { winner: 'black', reason: 'conduct' })).toBe(true);
});
test('moves, ordinary results, added time (the ladder’s time step) and warnings stay open to the scorer', () => {
  expect(chessArbiterOnly('move', { side: 'A' })).toBe(false);
  expect(chessArbiterOnly('result', { winner: 'white', reason: 'checkmate' })).toBe(false);
  expect(chessArbiterOnly('result', { winner: 'draw', reason: 'repetition' })).toBe(false);
  expect(chessArbiterOnly('note', { kind: 'add_time', side: 'A', seconds: 60 })).toBe(false);
  expect(chessArbiterOnly('note', { kind: 'violation', team_side: 'A' })).toBe(false);
});
test('the event checks use it with the sender', () => {
  const src = fs.readFileSync(path.join(__dirname, '../controllers/scoring.controller.ts'), 'utf8');
  expect(src).toContain("if (userId && chessArbiterOnly(ev.event_type, ev.payload) && !(await canDefault(match as never, userId))) {");
  expect(src).toContain('await validateScoringEvent(matchId, match, { event_type, period, clock_seconds, payload }, userId);');
});
