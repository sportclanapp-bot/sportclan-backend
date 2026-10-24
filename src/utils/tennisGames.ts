/**
 * N-R7-S11 (Step 2, SP-TEN-177): a tennis match that ended inside a set (a retirement, a default,
 * time called mid-set) keeps that set's games as the current games, outside `sets`. They were
 * played: the profile, the table's games and the Games board count them. A tennis summary is the
 * one with `set_tiebreaks`; a walkover played nothing. (Server-only: tennisCore.ts stays the
 * byte-identical copy of the app's.)
 */
export function unfinishedSetGames(ss: unknown): { a: number; b: number } {
  const x = (ss ?? {}) as { set_tiebreaks?: unknown; walkover?: unknown; A?: { games?: unknown }; B?: { games?: unknown } };
  if (!Array.isArray(x.set_tiebreaks) || x.walkover === true) return { a: 0, b: 0 };
  const g = (v: unknown) => (Number.isFinite(Number(v)) && Number(v) > 0 ? Number(v) : 0);
  return { a: g(x.A?.games), b: g(x.B?.games) };
}

/**
 * N-R7-S16 (Step 2, SPP1-TTN-151): a rally-sport match (table tennis, badminton, pickleball,
 * volleyball…) that ended inside a game — a retirement, a disqualification — keeps that game's
 * points as the current points, outside `sets`. They were played: the table's points, the
 * Points difference board and the profile count them. Not tennis (its points are inside a game,
 * counted as games: unfinishedSetGames), not a walkover.
 */
export function unfinishedGamePoints(ss: unknown): { a: number; b: number } {
  const x = (ss ?? {}) as { set_tiebreaks?: unknown; walkover?: unknown; A?: { sets?: unknown; points?: unknown }; B?: { sets?: unknown; points?: unknown } };
  if (Array.isArray(x.set_tiebreaks) || x.walkover === true || !Array.isArray(x.A?.sets) || !Array.isArray(x.B?.sets)) return { a: 0, b: 0 };
  const g = (v: unknown) => (Number.isFinite(Number(v)) && Number(v) > 0 ? Number(v) : 0);
  return { a: g(x.A?.points), b: g(x.B?.points) };
}
