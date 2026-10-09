/**
 * Stage 12 · CH2 · the FIDE Dutch pairing, checked over whole events:
 * 30 players × 9 rounds (and odd fields), results drawn from the ratings.
 * FIDE C.04.1 absolute rules: no repeat opponents; no player three times the
 * same colour running, nor a colour difference beyond ±2 (topscorers in the
 * last round excepted); nobody gets the pairing's bye twice. Plus: players on
 * the same score meet where they can (floaters only where needed), and nobody
 * floats down two rounds running when it can be avoided.
 */
import { dutchFirstRound, dutchRound, dutchHistory, colourPreference, maxMatching } from '../utils/swissDutch';

type Game = { round: number; white: string | null; black: string | null; bye?: boolean; winner?: string | null; draw?: boolean };

function simulate(n: number, rounds: number, seed: number) {
  let s = seed;
  const rnd = () => { s = (s * 1103515245 + 12345) % 2147483648; return s / 2147483648; };
  const players = Array.from({ length: n }, (_, i) => `p${String(i + 1).padStart(2, '0')}`);
  const strength = new Map(players.map((p, i) => [p, 2400 - i * 25]));
  const games: Game[] = [];
  const points = new Map(players.map((p) => [p, 0]));
  const pointsAfter: Array<Map<string, number>> = [new Map(points)];
  const play = (round: number, r: { pairs: Array<{ white: string; black: string }>; bye: string | null }) => {
    for (const p of r.pairs) {
      const d = (strength.get(p.white)! - strength.get(p.black)!) / 400;
      const e = 1 / (1 + 10 ** -d);
      const x = rnd();
      const res = x < e - 0.15 ? 'w' : x < e + 0.15 ? 'd' : 'b';
      games.push({ round, white: p.white, black: p.black, winner: res === 'w' ? p.white : res === 'b' ? p.black : null, draw: res === 'd' });
      points.set(p.white, points.get(p.white)! + (res === 'w' ? 1 : res === 'd' ? 0.5 : 0));
      points.set(p.black, points.get(p.black)! + (res === 'b' ? 1 : res === 'd' ? 0.5 : 0));
    }
    if (r.bye) { games.push({ round, white: r.bye, black: null, bye: true }); points.set(r.bye, points.get(r.bye)! + 1); }
    pointsAfter.push(new Map(points));
  };
  play(1, dutchFirstRound(players, true));
  const rounds_: Array<ReturnType<typeof dutchRound>> = [];
  for (let r = 2; r <= rounds; r++) {
    const before = pointsAfter[r - 1]!;
    const history = dutchHistory(players, games, (id, round) => pointsAfter[round - 1]!.get(id) ?? 0);
    const next = dutchRound({ players, points: new Map(before), history, colours: true, lastRound: r === rounds, winPoints: 1, roundsPlayed: r - 1 });
    rounds_.push(next);
    play(r, next);
  }
  return { players, games, points, pointsAfter, rounds_ };
}

describe('CH2 · FIDE absolute rules over whole events', () => {
  for (const [n, seed] of [[30, 7], [30, 99], [31, 3], [40, 5], [11, 42]] as const) {
    it(`${n} players × 9 rounds (seed ${seed})`, () => {
      const { players, games, pointsAfter } = simulate(n, 9, seed);
      // every player paired every round (or the bye)
      for (let r = 1; r <= 9; r++) {
        const inRound = games.filter((g) => g.round === r).flatMap((g) => [g.white, g.black]).filter(Boolean);
        expect(new Set(inRound).size).toBe(players.length);
        expect(inRound.length).toBe(players.length);
      }
      // no repeat opponents
      const met = new Set<string>();
      for (const g of games.filter((x) => !x.bye)) {
        const k = [g.white, g.black].sort().join('|');
        expect(met.has(k)).toBe(false);
        met.add(k);
      }
      // byes: at most one each
      const byes = games.filter((g) => g.bye).map((g) => g.white);
      expect(new Set(byes).size).toBe(byes.length);
      // colours: never three running, never beyond ±2 — except a topscorer in the last round
      for (const p of players) {
        const seq: Array<'w' | 'b'> = [];
        for (let r = 1; r <= 9; r++) {
          const g = games.find((x) => x.round === r && !x.bye && (x.white === p || x.black === p));
          if (!g) continue;
          seq.push(g.white === p ? 'w' : 'b');
          const top = r === 9 && (pointsAfter[8]!.get(p) ?? 0) * 2 > 8;
          if (top) continue;
          const diff = seq.filter((c) => c === 'w').length - seq.filter((c) => c === 'b').length;
          expect(Math.abs(diff)).toBeLessThanOrEqual(2);
          if (seq.length >= 3) expect(new Set(seq.slice(-3)).size).toBeGreaterThan(1);
        }
      }
    });
  }

  it('floaters only where needed: most games are between players on the same score, and leaders meet', () => {
    const { games, pointsAfter } = simulate(30, 9, 7);
    let same = 0; let total = 0;
    for (const g of games.filter((x) => !x.bye && x.round > 1)) {
      total++;
      if (pointsAfter[g.round - 1]!.get(g.white!) === pointsAfter[g.round - 1]!.get(g.black!)) same++;
    }
    expect(same / total).toBeGreaterThan(0.6);
    // a score gap of more than 1 point is never needed in a 30-player field before the last two rounds
    for (const g of games.filter((x) => !x.bye && x.round > 1 && x.round < 8)) {
      expect(Math.abs(pointsAfter[g.round - 1]!.get(g.white!)! - pointsAfter[g.round - 1]!.get(g.black!)!)).toBeLessThanOrEqual(1);
    }
  });

  // FIDE ranks colour criteria (C.12, C.13) above float history (C.14–C.17), so a repeat float can be
  // the right pairing; it should still be rare (here: under 5% of the player-rounds).
  it('floating down two rounds running is rare', () => {
    const { games, pointsAfter, players } = simulate(30, 9, 99);
    let repeats = 0;
    for (const p of players) {
      let prevDown = false;
      for (let r = 2; r <= 9; r++) {
        const g = games.find((x) => x.round === r && (x.white === p || x.black === p));
        if (!g) continue;
        const opp = g.white === p ? g.black : g.white;
        const down = g.bye || (opp != null && pointsAfter[r - 1]!.get(p)! > pointsAfter[r - 1]!.get(opp)!);
        if (down && prevDown) repeats++;
        prevDown = !!down;
      }
    }
    expect(repeats).toBeLessThan(30 * 8 * 0.05);
  });
});

describe('CH2 · the pieces', () => {
  it('colour preferences: absolute after two the same or a difference of 2; strong at ±1; mild at 0', () => {
    const h = (c: Array<'w' | 'b'>) => ({ opponents: new Set<string>(), colours: c, noBye: false, lastFloat: null });
    expect(colourPreference(h(['w', 'w']))).toEqual({ colour: 'b', strength: 3 });
    expect(colourPreference(h(['b', 'w', 'b', 'b']))).toEqual({ colour: 'w', strength: 3 });
    expect(colourPreference(h(['w']))).toEqual({ colour: 'b', strength: 2 });
    expect(colourPreference(h(['w', 'b']))).toEqual({ colour: 'w', strength: 1 });
    expect(colourPreference(h([]))).toEqual({ colour: null, strength: 0 });
  });
  it('round 1: 1 v N/2+1, colours alternating from White on board 1', () => {
    expect(dutchFirstRound(['a', 'b', 'c', 'd', 'e'], true)).toEqual({ bye: 'e', pairs: [{ white: 'a', black: 'c' }, { white: 'd', black: 'b' }] });
    expect(dutchFirstRound(['a', 'b', 'c', 'd'], false).pairs).toEqual([{ white: 'a', black: 'c' }, { white: 'b', black: 'd' }]); // no colours: the higher seed listed first
  });
  it('maximum matching finds a perfect pairing when one exists (and says when not)', () => {
    const all = (n: number) => Array.from({ length: n }, (_, i) => Array.from({ length: n }, (_, j) => i !== j));
    expect(maxMatching(6, all(6)).every((m) => m >= 0)).toBe(true);
    const star = Array.from({ length: 4 }, (_, i) => Array.from({ length: 4 }, (_, j) => (i === 0) !== (j === 0)));
    expect(maxMatching(4, star).filter((m) => m >= 0).length).toBe(2);
  });
  it('the bye goes to the lowest-ranked player who hasn’t had one', () => {
    const players = ['a', 'b', 'c'];
    const history = dutchHistory(players, [{ round: 1, white: 'a', black: 'b', winner: 'a' }, { round: 1, white: 'c', black: null, bye: true }], () => 0);
    const r = dutchRound({ players, points: new Map([['a', 1], ['b', 0], ['c', 1]]), history, colours: true, lastRound: false, winPoints: 1, roundsPlayed: 1 });
    expect(r.bye).toBe('b');
    expect(r.pairs).toEqual([{ white: 'c', black: 'a' }]);
  });
  it('keeps the same club apart in the last round when it can', () => {
    const players = ['a', 'b', 'c', 'd'];
    const history = dutchHistory(players, [{ round: 1, white: 'a', black: 'c', winner: 'a' }, { round: 1, white: 'd', black: 'b', winner: 'b' }], () => 0);
    const club = (id: string) => ({ a: 'Pune', b: 'Pune', c: 'Mumbai', d: 'Nagpur' } as Record<string, string>)[id] ?? null;
    const r = dutchRound({ players, points: new Map([['a', 1], ['b', 1], ['c', 0], ['d', 0]]), history, colours: true, lastRound: true, winPoints: 1, roundsPlayed: 1, clubOf: club });
    expect(r.pairs.map((p) => [p.white, p.black].sort().join('|')).sort()).toEqual(['a|d', 'b|c']);
    const r2 = dutchRound({ players, points: new Map([['a', 1], ['b', 1], ['c', 0], ['d', 0]]), history, colours: true, lastRound: true, winPoints: 1, roundsPlayed: 1 });
    expect(r2.pairs.map((p) => [p.white, p.black].sort().join('|')).sort()).toEqual(['a|b', 'c|d']); // without the rule, the leaders meet
  });
});

it('maximum matching agrees with brute force on 300 random graphs', () => {
  let s = 1;
  const rnd = () => { s = (s * 1103515245 + 12345) % 2147483648; return s / 2147483648; };
  const brute = (n: number, adj: boolean[][]): number => {
    let best = 0;
    const used = new Array(n).fill(false);
    const rec = (i: number, c: number) => {
      while (i < n && used[i]) i++;
      if (i >= n) { best = Math.max(best, c); return; }
      used[i] = true;
      rec(i + 1, c);
      for (let j = i + 1; j < n; j++) if (!used[j] && adj[i]![j]) { used[j] = true; rec(i + 1, c + 1); used[j] = false; }
      used[i] = false;
    };
    rec(0, 0); return best;
  };
  for (let t = 0; t < 300; t++) {
    const n = 4 + Math.floor(rnd() * 9);
    const p = rnd();
    const adj = Array.from({ length: n }, () => new Array(n).fill(false));
    for (let i = 0; i < n; i++) for (let j = i + 1; j < n; j++) if (rnd() < p) adj[i]![j] = adj[j]![i] = true;
    expect(maxMatching(n, adj).filter((x) => x >= 0).length / 2).toBe(brute(n, adj));
  }
});
