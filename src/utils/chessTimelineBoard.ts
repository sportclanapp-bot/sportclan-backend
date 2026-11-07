/**
 * N-R7-S114 (SPP1-CHS-133, Step 2 B8): the board a team chess timeline event is on. An event with
 * a board key is on that board. A board result sent without one (results entered one after another,
 * from an older pad or the API) belongs to the board in play — the first one not yet decided, as the
 * app's tie split reads it (app src/scoring/teamChessBoards.ts) — so its line can name the board.
 * A mini-match (games G1, G2 … between the same two players) has no boards. Returns the rubber's
 * index, or -1; `decided` collects the boards whose result has been read.
 */
import type { TieSpec } from './tieCore';

export function isChessMiniMatchSpec(spec: TieSpec | null | undefined): boolean {
  const s = spec as (TieSpec & { repeatPlayers?: boolean; boardOrder?: unknown }) | null | undefined;
  return !!s?.repeatPlayers && !s.boardOrder && s.rubbers[0]?.key === 'G1';
}

export function timelineBoardIndex(spec: TieSpec | null | undefined, eventType: string, payload: { board?: unknown }, decided: Set<string>): number {
  if (!spec) return -1;
  let idx = typeof payload.board === 'string' ? spec.rubbers.findIndex((r) => r.key === payload.board) : -1;
  if (eventType === 'result' && !isChessMiniMatchSpec(spec)) {
    if (idx < 0 && payload.board == null) idx = spec.rubbers.findIndex((r) => !decided.has(r.key));
    if (idx >= 0) decided.add(spec.rubbers[idx]!.key);
  }
  return idx;
}
