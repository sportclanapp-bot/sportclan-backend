/**
 * N-R7-S114 (SPP1-CHS-133, Step 2 B8) · on a team chess match the timeline's move lines said
 * their board ('♟️ White moved · Board 2 · move 3') but a board's result line did not:
 * '🏁 Black wins — checkmate (P3 S2B8 Knights Board 2)' (the board only inside a player's name).
 */
import { timelineLine, type CommentaryContext } from '../utils/commentary';

const ctx = (extra: Partial<CommentaryContext> = {}): CommentaryContext => ({ sport: 'chess', teamA: 'Knights', teamB: 'Rooks', ...extra } as CommentaryContext);

describe('N-R7-S114 · a team board result line names its board', () => {
  it('a win says the board', () => {
    expect(timelineLine('result', { winner: 'white', reason: 'checkmate', player_name: 'Bala', board: 'B2' }, ctx({ board: 'Board 2' })).text)
      .toBe('🏁 White wins — checkmate (Bala) · Board 2');
  });
  it('a draw says the board', () => {
    expect(timelineLine('result', { winner: 'draw', reason: 'agreement', board: 'B3' }, ctx({ board: 'Board 3' })).text)
      .toMatch(/^🤝 Draw — .* · Board 3$/);
  });
  it('a single game (no board) is unchanged', () => {
    expect(timelineLine('result', { winner: 'black', reason: 'checkmate', player_name: 'Bala' }, ctx()).text).toBe('🏁 Black wins — checkmate (Bala)');
  });
});

import { timelineBoardIndex } from '../utils/chessTimelineBoard';
import fs from 'fs';
import path from 'path';

describe('N-R7-S114 · a result sent without its board goes to the board in play', () => {
  const spec = { rubbers: [{ key: 'B1', label: 'Board 1' }, { key: 'B2', label: 'Board 2' }, { key: 'B3', label: 'Board 3' }], win: 'all' } as never;
  it('results one after another take boards 1, 2, … ; a keyed result takes its own board', () => {
    const d = new Set<string>();
    expect(timelineBoardIndex(spec, 'move', { board: 'B2' }, d)).toBe(1);
    expect(timelineBoardIndex(spec, 'result', { board: 'B2' }, d)).toBe(1);
    expect(timelineBoardIndex(spec, 'result', {}, d)).toBe(0);
    expect(timelineBoardIndex(spec, 'result', {}, d)).toBe(2);
    expect(timelineBoardIndex(spec, 'result', {}, d)).toBe(-1); // every board decided
  });
  it('a mini-match (G1, G2 … same two players) has no boards; a single game has no spec', () => {
    const mini = { rubbers: [{ key: 'G1', label: 'Game 1' }, { key: 'G2', label: 'Game 2' }], repeatPlayers: true, win: 'games' } as never;
    expect(timelineBoardIndex(mini, 'result', {}, new Set())).toBe(-1);
    expect(timelineBoardIndex(null, 'result', {}, new Set())).toBe(-1);
  });
  it('the match timeline reads boards through it', () => {
    const src = fs.readFileSync(path.join(__dirname, '../controllers/matches.controller.ts'), 'utf8');
    expect(src).toMatch(/const boardIdx = timelineBoardIndex\(chessSpec, ev\.event_type as string, p, decidedBoards\)/);
  });
});
