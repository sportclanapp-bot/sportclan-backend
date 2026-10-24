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
