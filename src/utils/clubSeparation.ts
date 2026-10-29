/**
 * BUILD 4.13 · keep entries from the same club (or state, institution — the
 * organiser's label on each entry, tournament_entries.club) apart in the draw,
 * as the Indian Carrom Federation separates players by state.
 *
 * Both are best-effort: when there are more same-club entries than groups (or
 * pairs), some must meet, and the draw goes ahead with as few meetings as the
 * swaps can reach. Seeding is kept: a team only swaps with one in the same pot
 * (its position in its group, or the lower seed of a first-round pair).
 */

type ClubOf = (teamId: string) => string | null | undefined;
const norm = (c: string | null | undefined) => (c ?? '').trim().toLowerCase() || null;

/** How many same-club pairs a set of teams holds. */
function clashes(ids: string[], clubOf: ClubOf): number {
  const count = new Map<string, number>();
  for (const id of ids) {
    const c = norm(clubOf(id));
    if (c) count.set(c, (count.get(c) ?? 0) + 1);
  }
  let n = 0;
  for (const k of count.values()) n += (k * (k - 1)) / 2;
  return n;
}

/**
 * Groups (each a list of team ids, in pot order) with same-club entries spread
 * across them. `fixed` teams (placed in a group by the organiser) never move.
 */
export function separateClubsInGroups(groups: string[][], clubOf: ClubOf, fixed: ReadonlySet<string> = new Set()): string[][] {
  const out = groups.map((g) => g.slice());
  const total = () => out.reduce((n, g) => n + clashes(g, clubOf), 0);
  for (let pass = 0; pass < 50; pass++) {
    const before = total();
    if (before === 0) break;
    let improved = false;
    for (let gi = 0; gi < out.length && !improved; gi++) {
      for (let pi = 0; pi < out[gi]!.length && !improved; pi++) {
        const a = out[gi]![pi]!;
        if (fixed.has(a) || !norm(clubOf(a))) continue;
        for (let gj = 0; gj < out.length && !improved; gj++) {
          if (gj === gi || pi >= out[gj]!.length) continue;
          const b = out[gj]![pi]!; // same pot
          if (fixed.has(b)) continue;
          out[gi]![pi] = b;
          out[gj]![pi] = a;
          if (total() < before) improved = true;
          else { out[gi]![pi] = a; out[gj]![pi] = b; }
        }
      }
    }
    if (!improved) break;
  }
  return out;
}

type Pair<T> = { a: T | null; b: T | null };

/**
 * First-round pairs with same-club meetings broken up by swapping lower seeds
 * (the b side) between pairs. `alsoApart` (e.g. same group) is kept too: a
 * swap that makes such a pair isn't taken.
 */
export function separateClubsInRound1<T extends { id: string }>(
  pairs: Array<Pair<T>>, clubOf: ClubOf, alsoApart: (x: string, y: string) => boolean = () => false,
  seedOf?: (teamId: string) => number | undefined,
): Array<Pair<T>> {
  const out = pairs.map((p) => ({ ...p }));
  const bad = (p: Pair<T>) => (p.a && p.b ? (norm(clubOf(p.a.id)) !== null && norm(clubOf(p.a.id)) === norm(clubOf(p.b.id)) ? 1 : 0) : 0);
  const worse = (p: Pair<T>) => (p.a && p.b ? alsoApart(p.a.id, p.b.id) : false);
  for (let i = 0; i < out.length; i++) {
    if (!bad(out[i]!)) continue;
    // N-R7-53: try the pairs farthest away first (the other half of the draw), so the
    // clubmates can only meet as late as possible — not in the next round.
    const order = out.map((_, j) => j).sort((x, y) => Math.abs(y - i) - Math.abs(x - i) || x - y);
    for (const j of order) {
      if (j === i || !out[j]!.b || !out[i]!.b) continue;
      const pi = { a: out[i]!.a, b: out[j]!.b };
      const pj = { a: out[j]!.a, b: out[i]!.b };
      if (bad(pi) + bad(pj) < bad(out[i]!) + bad(out[j]!) && !worse(pi) && !worse(pj)) {
        out[i] = pi;
        out[j] = pj;
        break;
      }
    }
  }
  // N-R7-S2 (SPP2-FOO-041): clubmates not paired can still meet in the next round —
  // spread them as far apart in the tree as swapping lower seeds can (opposite halves
  // for two of a club), never making a first-round clash or an `alsoApart` pair.
  // Pairs i and j meet in round 1 + bit length of (i ^ j); a clash in the first round is round 1.
  const meet = (i: number, j: number) => (i === j ? 1 : 1 + Math.floor(Math.log2(i ^ j)) + 1);
  const top = meet(0, Math.max(1, out.length - 1) | 0) + 1;
  const cost = () => {
    const at: Array<{ id: string; c: string | null; i: number }> = [];
    out.forEach((p, i) => { for (const x of [p.a, p.b]) if (x) at.push({ id: x.id, c: norm(clubOf(x.id)), i }); });
    let n = 0;
    // clubmates, and the pairs the caller keeps apart (a group's qualifiers), each as early as they could meet
    for (let x = 0; x < at.length; x++) for (let y = x + 1; y < at.length; y++) {
      const k = (at[x]!.c !== null && at[x]!.c === at[y]!.c ? 1 : 0) + (alsoApart(at[x]!.id, at[y]!.id) ? 1 : 0);
      if (k) n += k * 4 ** (top - meet(at[x]!.i, at[y]!.i));
    }
    return n;
  };
  for (let guard = 0, improved = true; improved && guard < out.length * out.length; guard++) {
    improved = false;
    const now = cost();
    for (let i = 0; i < out.length && !improved; i++) {
      if (!out[i]!.b) continue;
      for (let j = 0; j < out.length && !improved; j++) {
        if (j === i || !out[j]!.b) continue;
        const pi = { a: out[i]!.a, b: out[j]!.b };
        const pj = { a: out[j]!.a, b: out[i]!.b };
        if (bad(pi) || bad(pj) || worse(pi) || worse(pj)) continue;
        const [oi, oj] = [out[i]!, out[j]!];
        out[i] = pi; out[j] = pj;
        if (cost() < now) improved = true; else { out[i] = oi; out[j] = oj; }
      }
    }
    // N-R7-S4 re-run (SPP2-FOO-041): two clubmates can both be the higher seed of their pair.
    // With seed numbers known, a higher seed may swap with another of its own seeding pot
    // (3–4, 5–8, …; seeds 1 and 2 never move) when both pairs hold the same bye, so seeding is kept.
    if (!seedOf) continue;
    const pot = (x: T | null) => { const s = x ? seedOf(x.id) : undefined; return s && s > 2 ? Math.ceil(Math.log2(s)) : null; };
    for (let i = 0; i < out.length && !improved; i++) {
      const p = pot(out[i]!.a);
      if (p == null) continue;
      for (let j = i + 1; j < out.length && !improved; j++) {
        if (pot(out[j]!.a) !== p || !out[i]!.b !== !out[j]!.b) continue;
        const pi = { a: out[j]!.a, b: out[i]!.b };
        const pj = { a: out[i]!.a, b: out[j]!.b };
        if (bad(pi) || bad(pj) || worse(pi) || worse(pj)) continue;
        const [oi, oj] = [out[i]!, out[j]!];
        out[i] = pi; out[j] = pj;
        if (cost() < now) improved = true; else { out[i] = oi; out[j] = oj; }
      }
    }
  }
  return out;
}
