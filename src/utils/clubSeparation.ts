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
): Array<Pair<T>> {
  const out = pairs.map((p) => ({ ...p }));
  const bad = (p: Pair<T>) => (p.a && p.b ? (norm(clubOf(p.a.id)) !== null && norm(clubOf(p.a.id)) === norm(clubOf(p.b.id)) ? 1 : 0) : 0);
  const worse = (p: Pair<T>) => (p.a && p.b ? alsoApart(p.a.id, p.b.id) : false);
  for (let i = 0; i < out.length; i++) {
    if (!bad(out[i]!)) continue;
    for (let j = 0; j < out.length; j++) {
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
  return out;
}
