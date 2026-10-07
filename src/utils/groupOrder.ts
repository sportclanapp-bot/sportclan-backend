/**
 * Stage 10 · TT7 (Oct 2026) · the order a group's matches are played in, any
 * sport: the round-robin rounds (circle method; an odd group sits one out each
 * round), ordered so the rounds where the top seeds meet come last — ITTF's
 * order: a group of 3 plays 2–3, 1–3, 1–2; a group of 4 plays 1–4 & 2–3,
 * 1–3 & 2–4, 1–2 & 3–4. Players are given by position (0 = the group's top
 * seed). No top on a group's size.
 */
export function seededGroupRounds(n: number): Array<Array<[number, number]>> {
  if (n < 2) return [];
  const size = n % 2 === 0 ? n : n + 1; // an odd group: a "bye" position
  const bye = size - 1 >= n ? size - 1 : -1;
  const rest = Array.from({ length: size - 1 }, (_, i) => i + 1);
  const rounds: Array<Array<[number, number]>> = [];
  for (let r = 0; r < size - 1; r++) {
    const pairs: Array<[number, number]> = [];
    const line = [0, ...rest];
    for (let i = 0; i < size / 2; i++) {
      const a = line[i]!; const b = line[size - 1 - i]!;
      if (a === bye || b === bye) continue;
      pairs.push(a < b ? [a, b] : [b, a]);
    }
    rounds.push(pairs);
    rest.unshift(rest.pop()!); // rotate everyone but position 0
  }
  // The round whose strongest meeting (lowest seeds' sum) is lowest goes last.
  const strongest = (round: Array<[number, number]>) => Math.min(...round.map(([a, b]) => a + b));
  return rounds
    .map((round, i) => ({ round: round.sort((x, y) => x[0] + x[1] - (y[0] + y[1])), i }))
    .sort((x, y) => strongest(y.round) - strongest(x.round) || x.i - y.i)
    .map((x) => x.round);
}

/**
 * Every group's matches in play order: round 1 of every group, then round 2…
 * (so a player rests while the other groups play). `groups[g]` lists the
 * group's entries top seed first.
 */
export function seededGroupFixtures<T>(groups: T[][]): Array<{ group: number; a: T; b: T; round: number }> {
  const perGroup = groups.map((g) => seededGroupRounds(g.length));
  const most = Math.max(0, ...perGroup.map((r) => r.length));
  const out: Array<{ group: number; a: T; b: T; round: number }> = [];
  for (let r = 0; r < most; r++) {
    for (let g = 0; g < groups.length; g++) {
      for (const [i, j] of perGroup[g]![r] ?? []) out.push({ group: g, a: groups[g]![i]!, b: groups[g]![j]!, round: r + 1 });
    }
  }
  return out;
}
