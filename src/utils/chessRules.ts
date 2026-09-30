/**
 * Chess results — ONE rule for the app and the server (decision A3).
 *
 * This file is byte-identical in both repos:
 *   app     src/scoring/chessRules.ts
 *   server  src/utils/chessRules.ts
 * and both repos run the same fixture table against it (chessRules test).
 * Edit both, or neither.
 *
 * How a game can end. A decisive result is a checkmate, a resignation or a win
 * on time; a draw is by agreement, stalemate, repetition, insufficient material
 * or the 50-move rule. A clock reaching 0:00 is a flag fall: the app asks
 * whether to record a timeout rather than ending the game itself, because the
 * scorer may know it is a draw (the opponent cannot mate).
 */

export type ChessResult = 'white' | 'black' | 'draw';

export const CHESS_RESULT_REASONS: Record<'decisive' | 'draw', Array<{ id: string; label: string }>> = {
  decisive: [
    // V203: one style — words only. The sheet mixed 🤝, a plain "½", 🔁, ♟
    // and keycap digits.
    { id: 'checkmate', label: 'Checkmate' },
    { id: 'resignation', label: 'Resignation' },
    { id: 'timeout', label: 'Timeout' },
  ],
  draw: [
    { id: 'draw_agreement', label: 'By agreement' },
    { id: 'stalemate', label: 'Stalemate' },
    { id: 'repetition', label: 'Repetition' },
    { id: 'insufficient_material', label: 'Insufficient material' },
    { id: 'fifty_move', label: '50-move rule' },
  ],
};

/** Is `reason` a way this result can happen? (A missing reason is allowed.) */
export function isValidChessReason(result: ChessResult, reason: unknown): boolean {
  if (reason == null) return true;
  const list = CHESS_RESULT_REASONS[result === 'draw' ? 'draw' : 'decisive'];
  return list.some((r) => r.id === reason);
}

/** A clock at (or past) 0:00 has fallen. */
export function flagFallen(remainingSeconds: number): boolean {
  return remainingSeconds <= 0;
}

/**
 * BUILD 3.69 · a drawn knockout game decided by a tie-break (builds on 1.5).
 *   armageddon  one game, White more time (e.g. 5 v 4 minutes); a DRAW sends
 *               Black through — so White must win it.
 *   organiser   the organiser names who goes through.
 */
export type ChessTiebreakMethod = 'armageddon' | 'organiser';
export type ArmageddonResult = 'white' | 'black' | 'draw';

/** Who goes through after Armageddon: White (side A) only on a White win. */
export function armageddonWinner(result: ArmageddonResult): 'A' | 'B' {
  return result === 'white' ? 'A' : 'B';
}

/** The result line: "Magnus won the Armageddon", "… goes through (organiser's call)". */
export function chessTiebreakText(winnerName: string, method: ChessTiebreakMethod | null, result?: ArmageddonResult | null): string {
  if (method === 'armageddon') return result === 'draw' ? `${winnerName} went through on the Armageddon draw` : `${winnerName} won the Armageddon`;
  if (method === 'organiser') return `${winnerName} goes through (organiser's call)`;
  return `${winnerName} won on tie-break`;
}
