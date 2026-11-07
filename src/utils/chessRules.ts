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
    // Stage 12 · CH8: the arbiter's — a second illegal move, a phone or device on the player, misconduct.
    { id: 'illegal_move', label: 'Two illegal moves' },
    { id: 'device', label: 'Phone or device' },
    { id: 'conduct', label: 'Arbiter decision' },
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

/**
 * Who goes through after Armageddon: White only on a White win, Black on a Black win or a draw.
 * N-R7-183 (SPP1-CHS-099, Dipak 7 Nov): the arbiter draws the Armageddon's colours, so `white` says
 * which side had White (the sheet asks); left out it is side A, as before.
 */
export type ArmageddonWhite = 'A' | 'B';
export function armageddonWinner(result: ArmageddonResult, white: ArmageddonWhite = 'A'): 'A' | 'B' {
  const black: ArmageddonWhite = white === 'A' ? 'B' : 'A';
  return result === 'white' ? white : black;
}

/** The result line: "Magnus won the Armageddon", "… goes through (organiser's call)". */
/** N-R7-150 (SP-CHS-F04): nobody "goes through" from the final or the third-place game — it says what they won. */
export function chessTiebreakText(winnerName: string, method: ChessTiebreakMethod | null, result?: ArmageddonResult | null, stage: 'final' | 'third_place' | null = null): string {
  const won = stage === 'final' ? 'wins the final' : stage === 'third_place' ? 'takes third place' : null;
  if (method === 'armageddon') return result === 'draw' ? (won ? `${winnerName} ${won} on the Armageddon draw` : `${winnerName} went through on the Armageddon draw`) : `${winnerName} won the Armageddon`;
  if (method === 'organiser') return `${winnerName} ${won ?? 'goes through'} (organiser's call)`;
  return won ? `${winnerName} ${won} on tie-break` : `${winnerName} won on tie-break`;
}

/**
 * N-R7-150 (SP-CHS-F04): which knockout game a drawn game is — the third-place game, the final (no
 * next match, as the server's koStage), or one whose winner goes through. The row must carry
 * next_match_id to be called the final.
 */
export function chessKoStage(m: { third_place?: boolean | null; next_match_id?: string | null } | null | undefined): 'final' | 'third_place' | null {
  if (!m) return null;
  if (m.third_place) return 'third_place';
  return 'next_match_id' in m && !m.next_match_id ? 'final' : null;
}

/** N-R7-150: the pad's decider sheets say what the game decides ('Who takes third place?', not 'Who goes through?'). */
export function chessDeciderWords(stage: 'final' | 'third_place' | null): { title: string; message: string; through: string } {
  const through = stage === 'final' ? 'wins the final' : stage === 'third_place' ? 'takes third place' : 'goes through';
  const who = stage === 'final' ? 'Who wins the final?' : stage === 'third_place' ? 'Who takes third place?' : 'Who goes through?';
  return { title: who, message: `The game stays a draw; this decides who ${through}.`, through };
}

/**
 * N-R7-166 (OBS-C5-3): a level team match's decider names the teams — a team has no colour in a team
 * match (its boards alternate). N-R7-183: who has White in the Armageddon is asked next
 * (armageddonAskWords), so the choice only says a draw goes to the team with Black.
 */
export function chessTeamDeciderWords(stage: 'final' | 'third_place' | null, nameA: string, nameB: string): {
  choice: string; organiser: Record<'A' | 'B', string>;
} {
  const { through } = chessDeciderWords(stage);
  return {
    choice: `Armageddon game · one player from each team; a draw means the team with Black ${through}`,
    organiser: { A: nameA, B: nameB },
  };
}

/**
 * N-R7-183 (SPP1-CHS-099, Dipak 7 Nov): the Armageddon sheet ASKS who has White (the arbiter draws
 * the colours; White has more time, a draw goes to Black). `team`: a team match, one player from each team.
 */
export function armageddonAskWords(stage: 'final' | 'third_place' | null, nameA: string, nameB: string, team = false): {
  title: string; message: string; ask: Record<ArmageddonWhite, string>;
} {
  const { through } = chessDeciderWords(stage);
  if (team) {
    return {
      title: 'Armageddon · whose player has White?',
      message: `One player from each team. White has more time (say 5 v 4 minutes); a draw means the team with Black ${through}.`,
      ask: { A: `${nameA}'s player has White`, B: `${nameB}'s player has White` },
    };
  }
  return {
    title: 'Armageddon · who has White?',
    message: `White has more time (say 5 v 4 minutes); a draw means Black ${through}.`,
    ask: { A: `${nameA} has White`, B: `${nameB} has White` },
  };
}

/** N-R7-183: then how it ended, by player — the lines name who had White and who had Black. */
export function armageddonResultWords(stage: 'final' | 'third_place' | null, nameA: string, nameB: string, white: ArmageddonWhite, team = false): {
  message: string; result: Record<ArmageddonResult, string>;
} {
  const { through } = chessDeciderWords(stage);
  const w = white === 'A' ? nameA : nameB;
  const b = white === 'A' ? nameB : nameA;
  return {
    message: team
      ? `${w}'s player has White and more time, ${b}'s has Black; a draw means ${b} ${through}.`
      : `${w} has White and more time, ${b} has Black; a draw means ${b} ${through}.`,
    result: {
      white: `${w} won with White · ${w} ${through}`,
      black: `${b} won with Black · ${b} ${through}`,
      draw: `Drawn · ${b} had Black · ${b} ${through}`,
    },
  };
}

/**
 * Stage 12 · CH8 · FIDE Laws 7.5.5, 9.5.3 and Appendix A.3 / B: the time an
 * arbiter gives the opponent for an illegal move or a wrong draw claim — 2
 * minutes in a standard game, 1 in rapid and blitz. A second illegal move by
 * the same player loses (in every kind of game since the 2023 Laws).
 */
export function chessPenaltySeconds(clockLabel: string): number {
  return clockLabel === 'Classical' ? 120 : 60;
}
