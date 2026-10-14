/**
 * N-SPP1-CHS-2 / CHS-3 (launch test plan, Round 2) · a team chess match on clocks, on the timeline:
 * an arbiter's note on boards 2 and 4 (where the second team has White) named the wrong team — the
 * board pad sends the COLOUR; and move lines didn't say which board, numbered across all boards.
 */
import { timelineLine } from '../utils/commentary';

const ctx = (extra: object) => ({ sport: 'chess', teamA: 'Knights', teamB: 'Rooks', period: 0, ...extra } as never);
test('board 2 (Rooks White): White’s illegal move is the Rooks’, the time to the Knights', () => {
  expect(timelineLine('note', { kind: 'illegal_move', side: 'A', seconds: 60, board: 'B2' }, ctx({ board: 'Board 2', boardWhiteTeam: 'B' })).text)
    .toBe('♟️ Illegal move — Rooks (board 2) · 1 min to Knights');
  expect(timelineLine('note', { kind: 'add_time', side: 'A', seconds: 120, board: 'B2' }, ctx({ board: 'Board 2', boardWhiteTeam: 'B' })).text).toMatch(/^⏱ Rooks: \+2 min/);
});
test('board 1 (Knights White): as before', () => {
  expect(timelineLine('note', { kind: 'illegal_move', side: 'A', seconds: 60, board: 'B1' }, ctx({ board: 'Board 1', boardWhiteTeam: 'A' })).text)
    .toBe('♟️ Illegal move — Knights (board 1) · 1 min to Rooks');
});
test('a move says its board and that board’s move number', () => {
  expect(timelineLine('move', { side: 'B', board: 'B2' }, ctx({ board: 'Board 2', move: 2, boardWhiteTeam: 'B' })).text).toBe('♟️ Black moved · Board 2 · move 2');
  expect(timelineLine('move', { side: 'A' }, ctx({ move: 5 })).text).toBe('♟️ White moved · move 5'); // one game: as before
});
