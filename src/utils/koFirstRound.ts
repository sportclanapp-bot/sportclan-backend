/**
 * Groups → knockout: no same-group rematch in the first knockout round.
 *
 * The qualifiers are seeded strongest-first by tier (every group winner, then
 * every runner-up, each tier ordered by points) and paired seed k against seed
 * (size + 1 − k). With two groups that pairs the better winner with the weaker
 * runner-up, and when that runner-up came from the winner's own group, the two
 * teams that had just played each other met again straight away (FORMATS,
 * 28 Sep, live). The comment on maybeSeedKnockout always promised
 * cross-pairing; this keeps that promise.
 *
 * A repair pass over the seeded round: where a match pairs two teams from one
 * group, its lower seed (the `b` side) is swapped with another match's lower
 * seed when that leaves both matches cross-group. The top seeds (`a` side) keep
 * their slots, so byes still fall on them. When no swap helps (for example one
 * group supplies every qualifier), the round is left as it was.
 */
export type Slot = { id: string; name: string } | null;

export function crossGroupFirstRound<T extends { a: Slot; b: Slot }>(
  round1: T[],
  groupOf: (teamId: string) => string | undefined,
): T[] {
  const out = round1.map((m) => ({ ...m }));
  const clash = (a: Slot, b: Slot) => !!a && !!b && groupOf(a.id) !== undefined && groupOf(a.id) === groupOf(b.id);
  for (let i = 0; i < out.length; i++) {
    if (!clash(out[i]!.a, out[i]!.b)) continue;
    for (let j = 0; j < out.length; j++) {
      if (j === i || !out[j]!.b) continue;
      if (!clash(out[i]!.a, out[j]!.b) && !clash(out[j]!.a, out[i]!.b)) {
        const tmp = out[i]!.b;
        out[i]!.b = out[j]!.b;
        out[j]!.b = tmp;
        break;
      }
    }
  }
  return out;
}

/** The standard bracket's slot order for seeds 1…size (1 v size, 1 and 2 in opposite halves). */
function slotOrder(size: number): number[] {
  let order = [1, 2];
  while (order.length < size) {
    const sum = order.length * 2 + 1;
    const next: number[] = [];
    for (const s of order) { next.push(s); next.push(sum - s); }
    order = next;
  }
  return order.slice(0, Math.max(size, 1));
}

/**
 * Stage 10 · TT2 · the seeds in order, the group stage's qualifiers placed so a
 * group's runner-up (and its third, …) lands in the other half — then quarter —
 * of the draw from its group-mates (ITTF / BWF: group winner and runner-up in
 * opposite halves). `fixed` go first (seeds straight into the knockout, then
 * anyone already placed); each tier (the winners, the runners-up, …) keeps its
 * seed numbers, only who takes which number within the tier changes. Best
 * effort when the groups can't all be kept apart. Any size.
 */
export function placeGroupTiersApart(fixed: string[], tiers: string[][], groupOf: (id: string) => string | undefined, size: number): string[] {
  const order = slotOrder(size);
  const posOfSeed = new Map(order.map((s, i) => [s, i])); // seed number → bracket position
  const regionOf = (seed: number, parts: number) => Math.floor((posOfSeed.get(seed) ?? 0) / (size / parts));
  const placed: Array<{ id: string; seed: number }> = fixed.map((id, i) => ({ id, seed: i + 1 }));
  const out = [...fixed];
  for (const tier of tiers) {
    const left = [...tier];
    for (let k = 0; k < tier.length; k++) {
      const seed = out.length + 1;
      // The candidate that shares the fewest regions (half, then quarter) with its group-mates already placed.
      const cost = (id: string) => {
        const g = groupOf(id);
        if (g === undefined) return 0;
        const mates = placed.filter((p) => groupOf(p.id) === g);
        let c = 0;
        for (const p of mates) {
          if (regionOf(p.seed, 2) === regionOf(seed, 2)) c += 100;
          if (size >= 8 && regionOf(p.seed, 4) === regionOf(seed, 4)) c += 1;
        }
        return c;
      };
      let best = 0;
      for (let i = 1; i < left.length; i++) if (cost(left[i]!) < cost(left[best]!)) best = i;
      const id = left.splice(best, 1)[0]!;
      out.push(id);
      placed.push({ id, seed });
    }
  }
  return out;
}
