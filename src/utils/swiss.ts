/**
 * BUILD 4.15 · Swiss pairing for chess.
 *
 * Round 1: the top half of the seeding plays the bottom half (1 v N/2+1, …),
 * colours alternating down the board. Each later round is paired from the
 * standings — points, then the seeding — top-down, so players on the same
 * score meet: each player takes the highest-placed opponent they haven't
 * already played, backtracking when that leaves the rest unpairable. An odd
 * player out gets a bye (a win's points), the lowest-placed one who hasn't had
 * one. Colours: the player who has had white fewer times takes it; level,
 * the one who had black last; level again, the higher-placed.
 *
 * This is a practical Dutch-style system, not the full FIDE C.04 rules (no
 * floaters' downfloat history, no absolute colour criteria); it never
 * repeats a pairing while a fresh one exists, which is what a club Swiss
 * needs. The standings and the Buchholz / Sonneborn-Berger tie-breaks are the
 * shared ladder's (standings.ts).
 */

export type SwissPair = { white: string; black: string };
export type SwissRound = { pairs: SwissPair[]; bye: string | null };
export type SwissGame = { white: string | null; black: string | null; bye?: boolean };

const key = (a: string, b: string) => (a < b ? `${a}|${b}` : `${b}|${a}`);

/** Round 1 from the seeding (best first). */
export function swissFirstRound(seeded: string[]): SwissRound {
  const players = seeded.slice();
  let bye: string | null = null;
  if (players.length % 2 === 1) bye = players.pop()!; // the lowest seed
  const half = players.length / 2;
  const pairs: SwissPair[] = [];
  for (let i = 0; i < half; i++) {
    const top = players[i]!;
    const bottom = players[i + half]!;
    // Alternate down the board: board 1 top seed white, board 2 top seed black, …
    pairs.push(i % 2 === 0 ? { white: top, black: bottom } : { white: bottom, black: top });
  }
  return { pairs, bye };
}

/**
 * A later round. `ranked` is the standings order (best first); `games` every
 * game so far (white / black, or a bye).
 */
export function swissNextRound(ranked: string[], games: SwissGame[]): SwissRound {
  const played = new Set<string>();
  const hadBye = new Set<string>();
  const whites = new Map<string, number>();
  const blacks = new Map<string, number>();
  const last = new Map<string, 'w' | 'b'>();
  for (const g of games) {
    if (g.bye) { if (g.white) hadBye.add(g.white); continue; }
    if (!g.white || !g.black) continue;
    played.add(key(g.white, g.black));
    whites.set(g.white, (whites.get(g.white) ?? 0) + 1);
    blacks.set(g.black, (blacks.get(g.black) ?? 0) + 1);
    last.set(g.white, 'w');
    last.set(g.black, 'b');
  }
  const place = new Map(ranked.map((id, i) => [id, i]));

  const pairUp = (pool: string[], allowRepeat: boolean): Array<[string, string]> | null => {
    let steps = 0;
    const rec = (rest: string[]): Array<[string, string]> | null => {
      if (rest.length === 0) return [];
      if (++steps > 200_000) return null; // a pathological field: give up this pass
      const [p, ...others] = rest;
      for (let i = 0; i < others.length; i++) {
        const q = others[i]!;
        if (!allowRepeat && played.has(key(p!, q))) continue;
        const tail = rec([...others.slice(0, i), ...others.slice(i + 1)]);
        if (tail) return [[p!, q], ...tail];
      }
      return null;
    };
    return rec(pool);
  };

  let bye: string | null = null;
  let pool = ranked.slice();
  let pairs: Array<[string, string]> | null = null;
  if (pool.length % 2 === 1) {
    // The lowest-placed player without a bye whose leaving lets the rest pair.
    const candidates = [...ranked].reverse().filter((id) => !hadBye.has(id));
    for (const c of (candidates.length ? candidates : [...ranked].reverse())) {
      const rest = ranked.filter((id) => id !== c);
      const p = pairUp(rest, false);
      if (p) { bye = c; pool = rest; pairs = p; break; }
    }
    if (!pairs) { bye = (candidates[0] ?? ranked[ranked.length - 1])!; pool = ranked.filter((id) => id !== bye); }
  }
  pairs = pairs ?? pairUp(pool, false) ?? pairUp(pool, true) ?? [];

  const balance = (id: string) => (whites.get(id) ?? 0) - (blacks.get(id) ?? 0);
  return {
    bye,
    pairs: pairs.map(([p, q]) => {
      const bp = balance(p);
      const bq = balance(q);
      let pWhite: boolean;
      if (bp !== bq) pWhite = bp < bq;
      else if (last.get(p) !== last.get(q)) pWhite = last.get(p) === 'b';
      else pWhite = (place.get(p) ?? 0) < (place.get(q) ?? 0);
      return pWhite ? { white: p, black: q } : { white: q, black: p };
    }),
  };
}
