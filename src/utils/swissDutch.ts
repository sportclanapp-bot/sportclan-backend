/**
 * Stage 12 · CH2 · Swiss pairing the FIDE way (C.04.1 basic rules, C.04.3 the
 * Dutch system, revised 1 Feb 2026), for every sport that offers a Swiss.
 *
 * What it does, in FIDE's order of importance:
 * - Absolute: nobody meets the same opponent twice; nobody gets the pairing's
 *   bye twice (nor after a forfeit win); where the sport has colours, two
 *   players who both MUST have the same colour (colour difference beyond ±1, or
 *   the same colour the last two games) never meet — so nobody plays a colour
 *   three times running or reaches a difference of 3. Topscorers (over 50% of
 *   the possible points) are exempt when the last round is paired, as FIDE
 *   allows.
 * - The pairing's bye goes to the lowest-ranked eligible player whose leaving
 *   lets everyone else be paired.
 * - Score groups are paired from the top. Each bracket (the group plus anyone
 *   who floated down into it) makes as many pairs as it can while the rest of
 *   the field stays pairable; the rest float down to the next group.
 * - Within a bracket, the top half meets the bottom half by pairing number
 *   (the Dutch S1 v S2), with transpositions and exchanges tried in that order;
 *   among the pairings found, the best by FIDE's quality criteria is kept:
 *   fewest floaters → (last round, if asked) fewest same-club pairs → most
 *   colour preferences granted (absolute, then strong) → fewest players
 *   floating down (or up) two rounds running.
 * - Colours: both preferences granted; else the stronger one; else alternate
 *   from the last round they differed; else the higher-ranked player's; else
 *   the higher-ranked takes the initial colour on an odd pairing number.
 *
 * Feasibility ("can the rest still be paired?") is a maximum matching on the
 * compatibility graph (Edmonds' blossom), so a bracket never paints the field
 * into a corner. The search inside a bracket is bounded; on a pathological
 * field it keeps the best pairing found so far, which still meets every
 * absolute rule.
 */

export type DutchHistory = {
  /** Opponents met over the board (forfeits don't count as meetings). */
  opponents: Set<string>;
  /** Colours of games played, in order ('w' | 'b'); unplayed rounds are left out. */
  colours: Array<'w' | 'b'>;
  /** Had the pairing's bye, or won by forfeit (either bars a pairing bye). */
  noBye: boolean;
  /** Floated down / up in the previous round. */
  lastFloat: 'down' | 'up' | null;
};

export type DutchInput = {
  /** Everyone to pair this round, in pairing-number order (best seed first). */
  players: string[];
  points: Map<string, number>;
  history: Map<string, DutchHistory>;
  /** Pairing numbers (1 = top seed); defaults to the order of `players`. */
  tpn?: Map<string, number>;
  /** The sport has colours (chess). Elsewhere sides are only listed. */
  colours: boolean;
  /** The last round is being paired (topscorers' colour exemption; same-club avoidance). */
  lastRound: boolean;
  /** Points for a win (1 in chess), and rounds played so far, for "topscorer". */
  winPoints: number;
  roundsPlayed: number;
  /** Keep the same club / state apart in the last round (a quality criterion). */
  clubOf?: (id: string) => string | null;
  /** The colour board 1's top player takes when nothing else decides (default White). */
  initialColour?: 'w' | 'b';
};

export type DutchPair = { white: string; black: string };
export type DutchRound = { pairs: DutchPair[]; bye: string | null };

type Pref = { colour: 'w' | 'b' | null; strength: 0 | 1 | 2 | 3 }; // 3 absolute, 2 strong, 1 mild

export function colourPreference(h: DutchHistory | undefined): Pref {
  const cs = h?.colours ?? [];
  if (!cs.length) return { colour: null, strength: 0 };
  const diff = cs.filter((c) => c === 'w').length - cs.filter((c) => c === 'b').length;
  const last = cs[cs.length - 1]!;
  const twoSame = cs.length >= 2 && cs[cs.length - 2] === last;
  if (diff < -1 || (twoSame && last === 'b')) return { colour: 'w', strength: 3 };
  if (diff > 1 || (twoSame && last === 'w')) return { colour: 'b', strength: 3 };
  if (diff === -1) return { colour: 'w', strength: 2 };
  if (diff === 1) return { colour: 'b', strength: 2 };
  return { colour: last === 'w' ? 'b' : 'w', strength: 1 };
}

/** Edmonds' blossom: a maximum matching on a general graph (n ≤ a few hundred). Returns mate[] (−1 unmatched). */
export function maxMatching(n: number, adj: boolean[][]): number[] {
  const mate = new Array<number>(n).fill(-1);
  const p = new Array<number>(n);
  const base = new Array<number>(n);
  const used = new Array<boolean>(n);
  const blossom = new Array<boolean>(n);
  const q: number[] = [];
  const lca = (a0: number, b0: number): number => {
    const seen = new Array<boolean>(n).fill(false);
    let a = a0; let b = b0;
    for (;;) { a = base[a]!; seen[a] = true; if (mate[a] === -1) break; a = p[mate[a]!]!; }
    for (;;) { b = base[b]!; if (seen[b]) return b; b = p[mate[b]!]!; }
  };
  const markPath = (v0: number, b: number, child0: number) => {
    let v = v0; let child = child0;
    while (base[v] !== b) {
      blossom[base[v]!] = blossom[base[mate[v]!]!] = true;
      p[v] = child; child = mate[v]!; v = p[mate[v]!]!;
    }
  };
  const findPath = (root: number): number => {
    used.fill(false); p.fill(-1);
    for (let i = 0; i < n; i++) base[i] = i;
    used[root] = true; q.length = 0; q.push(root);
    let qh = 0;
    while (qh < q.length) {
      const v = q[qh++]!;
      for (let to = 0; to < n; to++) {
        if (!adj[v]![to] || base[v] === base[to] || mate[v] === to) continue;
        if (to === root || (mate[to] !== -1 && p[mate[to]!] !== -1)) {
          const cur = lca(v, to);
          blossom.fill(false);
          markPath(v, cur, to); markPath(to, cur, v);
          for (let i = 0; i < n; i++) {
            if (blossom[base[i]!]) { base[i] = cur; if (!used[i]) { used[i] = true; q.push(i); } }
          }
        } else if (p[to] === -1) {
          p[to] = v;
          if (mate[to] === -1) return to;
          used[mate[to]!] = true; q.push(mate[to]!);
        }
      }
    }
    return -1;
  };
  for (let i = 0; i < n; i++) {
    if (mate[i] !== -1) continue;
    const v = findPath(i);
    if (v === -1) continue;
    let u = v;
    while (u !== -1) { const pv = p[u]!; const ppv = mate[pv]!; mate[u] = pv; mate[pv] = u; u = ppv; }
  }
  return mate;
}

/**
 * Pair a Swiss round (not round 1 — see dutchFirstRound). In the last round,
 * with clubs to keep apart, same-club pairs are first ruled out entirely
 * (AICF nationals' rule); only if the round can't be paired that way are
 * they allowed again (and then kept as few as possible).
 */
export function dutchRound(inp: DutchInput): DutchRound {
  if (inp.lastRound && inp.clubOf) {
    const strict = pairOnce(inp, true);
    if (!strict.relaxed) return strict.round;
  }
  return pairOnce(inp, false).round;
}

function pairOnce(inp: DutchInput, hardClub: boolean): { round: DutchRound; relaxed: boolean } {
  const tpn = inp.tpn ?? new Map(inp.players.map((id, i) => [id, i + 1]));
  const pts = (id: string) => inp.points.get(id) ?? 0;
  const hist = (id: string) => inp.history.get(id);
  const maxPts = inp.roundsPlayed * inp.winPoints;
  const topscorer = (id: string) => inp.lastRound && pts(id) * 2 > maxPts;
  const pref = new Map(inp.players.map((id) => [id, colourPreference(hist(id))]));

  const compatible = (a: string, b: string): boolean => {
    if (a === b) return false;
    if (hist(a)?.opponents.has(b)) return false;
    if (hardClub) { const ca = inp.clubOf!(a); if (ca && ca === inp.clubOf!(b)) return false; }
    if (inp.colours) {
      const pa = pref.get(a)!; const pb = pref.get(b)!;
      if (pa.strength === 3 && pb.strength === 3 && pa.colour === pb.colour && !(topscorer(a) || topscorer(b))) return false;
    }
    return true;
  };
  const feasible = (ids: string[]): boolean => {
    if (ids.length % 2 === 1) return false;
    if (!ids.length) return true;
    const adj = ids.map((a) => ids.map((b) => compatible(a, b)));
    const mate = maxMatching(ids.length, adj);
    return mate.every((m) => m !== -1);
  };

  // Ranking: points, then pairing number.
  const ranked = inp.players.slice().sort((a, b) => pts(b) - pts(a) || tpn.get(a)! - tpn.get(b)!);

  // The pairing's bye: the lowest-ranked eligible player whose leaving lets the rest pair.
  let bye: string | null = null;
  let pool = ranked;
  if (ranked.length % 2 === 1) {
    const order = ranked.slice().reverse();
    const eligible = order.filter((id) => !hist(id)?.noBye);
    for (const c of [...eligible, ...order.filter((id) => !eligible.includes(id))]) {
      const rest = ranked.filter((id) => id !== c);
      if (feasible(rest)) { bye = c; pool = rest; break; }
    }
    if (bye == null) { bye = eligible[0] ?? order[0]!; pool = ranked.filter((id) => id !== bye); }
  }
  // If nothing pairs without a repeat or a colour clash (a tiny field late on), relax in FIDE's order:
  // colours first, then repeats — the round is still made.
  const relaxed = !feasible(pool);

  const groups: string[][] = [];
  for (const id of pool) {
    const g = groups[groups.length - 1];
    if (g && pts(g[0]!) === pts(id)) g.push(id); else groups.push([id]);
  }

  const pairs: Array<[string, string]> = [];
  let carry: string[] = [];
  for (let gi = 0; gi < groups.length; gi++) {
    const residents = groups[gi]!;
    const bracket = [...carry, ...residents];
    const lower = groups.slice(gi + 1).flat();
    const isLast = gi === groups.length - 1;
    const best = pairBracket(bracket, carry, lower, isLast);
    pairs.push(...best.pairs);
    carry = best.left;
  }
  if (carry.length) {
    // Shouldn't happen (the last bracket pairs everyone); pair the leftovers as they come.
    for (let i = 0; i + 1 < carry.length; i += 2) pairs.push([carry[i]!, carry[i + 1]!]);
  }
  return { round: { bye, pairs: pairs.map(([a, b]) => colourPair(a, b)) }, relaxed };

  function pairBracket(bracket: string[], mdps: string[], lower: string[], isLast: boolean): { pairs: Array<[string, string]>; left: string[] } {
    const ok = (a: string, b: string) => relaxed || compatible(a, b);
    const restFeasible = (left: string[]) => relaxed || feasible([...left, ...lower]);
    const n = bracket.length;
    // Most pairs first; the last bracket must pair everyone.
    for (let want = Math.floor(n / 2); want >= 0; want--) {
      if (isLast && want * 2 !== n) continue;
      const found = searchBracket(bracket, mdps, want, ok, restFeasible);
      if (found) return found;
    }
    return { pairs: [], left: bracket };
  }

  function searchBracket(bracket: string[], mdps: string[], want: number, ok: (a: string, b: string) => boolean, restFeasible: (left: string[]) => boolean): { pairs: Array<[string, string]>; left: string[] } | null {
    // S1 = the top `want` players (MDPs first, as ranked), S2 the rest — Dutch order.
    const s1 = bracket.slice(0, want);
    const s2 = bracket.slice(want);
    let best: { pairs: Array<[string, string]>; left: string[]; q: number[] } | null = null;
    let tries = 0;
    const LIMIT = 400;
    const quality = (ps: Array<[string, string]>, left: string[]): number[] => {
      const sameClub = inp.lastRound && inp.clubOf ? ps.filter(([a, b]) => { const ca = inp.clubOf!(a); return !!ca && ca === inp.clubOf!(b); }).length : 0;
      let absMiss = 0; let strongMiss = 0; let mildMiss = 0;
      if (inp.colours) {
        for (const [a, b] of ps) {
          const c = colourPair(a, b);
          for (const [id, got] of [[c.white, 'w'], [c.black, 'b']] as const) {
            const pr = pref.get(id)!;
            if (pr.colour && pr.colour !== got) { if (pr.strength === 3) absMiss++; else if (pr.strength === 2) strongMiss++; else mildMiss++; }
          }
        }
      }
      // Floaters down again (left now, floated down last round) and up again (an MDP's opponent floated up last round).
      const downAgain = left.filter((id) => hist(id)?.lastFloat === 'down').length;
      const upAgain = ps.filter(([a, b]) => mdps.includes(a) && hist(b)?.lastFloat === 'up').length;
      // Score difference of MDP pairings (pair an MDP with the highest resident possible).
      const mdpGap = ps.reduce((sum, [a, b]) => sum + Math.abs(pts(a) - pts(b)), 0);
      return [sameClub, mdpGap, absMiss, strongMiss, downAgain, upAgain, mildMiss];
    };
    const better = (x: number[], y: number[]) => { for (let i = 0; i < x.length; i++) if (x[i] !== y[i]) return x[i]! < y[i]!; return false; };

    // Backtracking in Dutch order: the highest unpaired player is paired next. An S1 player
    // tries S2 from its own position onwards (transpositions), then the rest of S2, then
    // (exchanges) the lower S1 players; an S2 player the players below it. As a last resort
    // the player is left to float down (when fewer than all can pair here).
    const used = new Set<string>();
    const floated = new Set<string>();
    const cur: Array<[string, string]> = [];
    let nodes = 0;
    const s1Index = new Map(s1.map((id, k) => [id, k]));
    const rec = (): boolean => {
      if (tries > LIMIT || nodes > LIMIT * 10) return true;
      nodes++;
      // Everyone not yet paired or floated must still be pairable — here or below.
      if (!restFeasible(bracket.filter((id) => !used.has(id)))) return false;
      if (cur.length === want) {
        tries++;
        const left = bracket.filter((id) => !used.has(id));
        const q = quality(cur, left);
        if (!best || better(q, best.q)) best = { pairs: cur.slice(), left, q };
        return q.every((v) => v === 0); // perfect: stop
      }
      const a = bracket.find((id) => !used.has(id) && !floated.has(id));
      if (!a) return false;
      const k = s1Index.get(a);
      const order = k != null
        ? [...s2.slice(k), ...s2.slice(0, k), ...s1.slice(k + 1)]
        : bracket.slice(bracket.indexOf(a) + 1);
      for (const b of order) {
        if (used.has(b) || floated.has(b) || !ok(a, b)) continue;
        used.add(a); used.add(b); cur.push([a, b]);
        const stop = rec();
        cur.pop(); used.delete(a); used.delete(b);
        if (stop) return true;
      }
      // Float `a` down instead (only while enough players remain to make the pairs wanted).
      const free = bracket.filter((id) => !used.has(id) && !floated.has(id)).length - 1;
      if (free >= 2 * (want - cur.length)) {
        floated.add(a);
        const stop = rec();
        floated.delete(a);
        if (stop) return true;
      }
      return false;
    };
    rec();
    // S1 members paired to each other (exchanges) can leave fewer than `want` pairs: count them.
    if (!best) return null;
    const b = best as { pairs: Array<[string, string]>; left: string[] };
    if (b.pairs.length !== want) return null;
    return { pairs: b.pairs, left: b.left };
  }

  function colourPair(a: string, b: string): DutchPair {
    if (!inp.colours) return tpn.get(a)! <= tpn.get(b)! ? { white: a, black: b } : { white: b, black: a };
    const pa = pref.get(a)!; const pb = pref.get(b)!;
    const higher = pts(a) > pts(b) || (pts(a) === pts(b) && tpn.get(a)! < tpn.get(b)!) ? a : b;
    const give = (whiteId: string): DutchPair => (whiteId === a ? { white: a, black: b } : { white: b, black: a });
    // E.1 both granted.
    if (pa.colour && pb.colour && pa.colour !== pb.colour) return give(pa.colour === 'w' ? a : b);
    if (pa.colour && !pb.colour) return give(pa.colour === 'w' ? a : b);
    if (pb.colour && !pa.colour) return give(pb.colour === 'w' ? b : a);
    if (pa.colour && pb.colour) {
      // E.2 the stronger preference (two absolutes: the wider colour difference).
      if (pa.strength !== pb.strength) return give((pa.strength > pb.strength ? pa : pb).colour === 'w' ? (pa.strength > pb.strength ? a : b) : (pa.strength > pb.strength ? b : a));
      if (pa.strength === 3) {
        const d = (id: string) => { const cs = hist(id)?.colours ?? []; return Math.abs(cs.filter((c) => c === 'w').length - cs.filter((c) => c === 'b').length); };
        if (d(a) !== d(b)) { const s = d(a) > d(b) ? a : b; return give(pref.get(s)!.colour === 'w' ? s : (s === a ? b : a)); }
      }
      // E.3 alternate from the most recent round their colours differed.
      const ca = hist(a)?.colours ?? []; const cb = hist(b)?.colours ?? [];
      for (let k = 1; k <= Math.min(ca.length, cb.length); k++) {
        const x = ca[ca.length - k]!; const y = cb[cb.length - k]!;
        if (x !== y) return give(x === 'b' ? a : b);
      }
      // E.4 the higher-ranked player's preference.
      return give(pref.get(higher)!.colour === 'w' ? higher : (higher === a ? b : a));
    }
    // E.5 nobody has a preference: the higher-ranked takes the initial colour on an odd pairing number.
    const init = inp.initialColour ?? 'w';
    const takesInit = tpn.get(higher)! % 2 === 1;
    const higherWhite = (init === 'w') === takesInit;
    return give(higherWhite ? higher : (higher === a ? b : a));
  }
}

/** Round 1: top half v bottom half by pairing number; board 1's top player takes the initial colour, alternating down the boards. */
export function dutchFirstRound(players: string[], colours: boolean, initialColour: 'w' | 'b' = 'w'): DutchRound {
  const ps = players.slice();
  let bye: string | null = null;
  if (ps.length % 2 === 1) bye = ps.pop()!;
  const half = ps.length / 2;
  const pairs: DutchPair[] = [];
  for (let i = 0; i < half; i++) {
    const top = ps[i]!; const bottom = ps[i + half]!;
    const topWhite = !colours || ((i % 2 === 0) === (initialColour === 'w'));
    pairs.push(topWhite ? { white: top, black: bottom } : { white: bottom, black: top });
  }
  return { pairs, bye };
}

/**
 * Each player's history from the games so far (side A White). `games` are in
 * round order; byes and forfeits are unplayed (no colour, no meeting); a
 * pairing bye or a forfeit win bars another pairing bye. Floats: a player
 * paired with someone on fewer points floated down that round (and the other
 * up); the pairing bye counts as floating down.
 */
export function dutchHistory(
  players: string[],
  games: Array<{ round: number; white: string | null; black: string | null; bye?: boolean; byeKind?: string | null; forfeit?: boolean; winner?: string | null }>,
  pointsBefore: (id: string, round: number) => number,
): Map<string, DutchHistory> {
  const h = new Map<string, DutchHistory>(players.map((id) => [id, { opponents: new Set(), colours: [], noBye: false, lastFloat: null }]));
  const lastRound = Math.max(0, ...games.map((g) => g.round));
  const sorted = games.slice().sort((x, y) => x.round - y.round);
  for (const g of sorted) {
    if (g.bye) {
      const x = g.white ? h.get(g.white) : null;
      // The pairing's own bye (no kind) bars another; a bye asked for doesn't.
      if (x && !g.byeKind) { x.noBye = true; if (g.round === lastRound) x.lastFloat = 'down'; }
      continue;
    }
    if (!g.white || !g.black) continue;
    const w = h.get(g.white); const b = h.get(g.black);
    if (g.forfeit) {
      if (g.winner && h.get(g.winner)) h.get(g.winner)!.noBye = true;
      continue;
    }
    w?.opponents.add(g.black); b?.opponents.add(g.white);
    w?.colours.push('w'); b?.colours.push('b');
    if (g.round === lastRound) {
      const pw = pointsBefore(g.white, g.round); const pb = pointsBefore(g.black, g.round);
      if (w && b && pw !== pb) {
        (pw > pb ? w : b).lastFloat = 'down';
        (pw > pb ? b : w).lastFloat = 'up';
      }
    }
  }
  return h;
}
