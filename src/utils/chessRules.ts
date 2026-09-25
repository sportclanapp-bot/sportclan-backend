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
    { id: 'checkmate', label: '♚ Checkmate' },
    { id: 'resignation', label: '🏳 Resignation' },
    { id: 'timeout', label: '⏱ Timeout' },
  ],
  draw: [
    { id: 'draw_agreement', label: '🤝 By agreement' },
    { id: 'stalemate', label: '½ Stalemate' },
    { id: 'repetition', label: '🔁 Repetition' },
    { id: 'insufficient_material', label: '♟ Insufficient material' },
    { id: 'fifty_move', label: '5️⃣0️⃣ 50-move rule' },
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
