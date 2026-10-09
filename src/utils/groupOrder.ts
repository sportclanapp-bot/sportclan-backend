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

/**
 * Stage 12 · CH9 · FIDE's Berger tables (C.05 Annex 1): the rounds of a round
 * robin of `n` players (by pairing number, 0-based), each pair [first, second]
 * — first is White in chess, the first-named (home) side elsewhere. Round 1 is
 * 1–n, 2–(n−1)…; each next round adds n/2 to every number (mod n−1) and the
 * last player's colour alternates, so every player's colours alternate as far
 * as a round robin allows. An odd field adds a "bye" number that sits out.
 *
 * `double`: the second cycle is the first with colours / sides reversed; the
 * first cycle's last two rounds swap (FIDE's advice) so nobody has the same
 * colour three times across the join.
 */
export function bergerRounds(n: number, double = false): Array<Array<[number, number]>> {
  if (n < 2) return [];
  const size = n % 2 === 0 ? n : n + 1;
  const last = size - 1; // the fixed number (0-based)
  const m = size - 1;
  let round: Array<[number, number]> = Array.from({ length: size / 2 }, (_, i) => [i, last - i] as [number, number]);
  const rounds: Array<Array<[number, number]>> = [];
  for (let r = 0; r < m; r++) {
    rounds.push(round);
    const shift = (k: number) => (k === last ? last : (k + size / 2) % m);
    round = round.map(([a, b], i) => {
      const x = shift(a); const y = shift(b);
      // Board 1 holds the fixed player: their colour alternates round by round.
      if (i === 0) return (r % 2 === 0 ? [last, x === last ? y : x] : [x === last ? y : x, last]) as [number, number];
      return [x, y] as [number, number];
    });
  }
  const drop = (rs: Array<Array<[number, number]>>) => rs.map((rd) => rd.filter(([a, b]) => a < n && b < n));
  if (!double) return drop(rounds);
  const first = rounds.length >= 2 ? [...rounds.slice(0, -2), rounds[rounds.length - 1]!, rounds[rounds.length - 2]!] : rounds;
  return drop([...first, ...first.map((rd) => rd.map(([a, b]) => [b, a] as [number, number]))]);
}
