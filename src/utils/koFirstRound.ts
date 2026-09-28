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
