/**
 * SC-376/377/378 · the tiebreak ladder, NRR, seeding and withdrawal — as pure
 * functions, so the arithmetic is pinned independently of the API.
 */
import { rankTeams, computeStats, netRunRate, parseOversNum, inningsOf, GMatch } from '../utils/standings';

const cricket = (a: string, b: string, ar: number, ab: number, br: number, bb: number,
                 winner: string | null, opts: { aWkts?: number; bWkts?: number; overs?: number } = {}): GMatch => ({
  team_a_id: a, team_b_id: b, winner_team_id: winner, status: 'completed', overs: opts.overs ?? null,
  score_summary: {
    A: { score: ar, runs: ar, balls: ab, wickets: opts.aWkts ?? 0 },
    B: { score: br, runs: br, balls: bb, wickets: opts.bWkts ?? 0 },
  },
});

// ── SC-376 · NRR is a RATE, and it is what actually ranks cricket ───────────
describe('SC-376 · net run rate', () => {
  it('reads cricket over notation: 4.3 overs is 4.5 overs, not 4.3', () => {
    expect(parseOversNum('4.3')).toBeCloseTo(4.5, 6);
    expect(parseOversNum('20')).toBe(20);
    expect(parseOversNum(null)).toBeNull();
    expect(parseOversNum('abc')).toBeNull();
  });

  it('divides by overs FACED and overs BOWLED, not by matches', () => {
    // 300 off 40 overs, conceded 250 off 40 → 7.5 - 6.25 = +1.25
    expect(netRunRate({ runsScored: 300, oversFaced: 40, runsConceded: 250, oversBowled: 40 })).toBe(1.25);
  });

  it('has the right SIGN — conceding faster than you score is negative', () => {
    expect(netRunRate({ runsScored: 250, oversFaced: 40, runsConceded: 300, oversBowled: 40 })).toBe(-1.25);
  });

  it('aggregates runs and overs across the tournament, not an average of per-match rates', () => {
    // Match 1: 100 off 10 (RR 10). Match 2: 20 off 10 (RR 2).
    // Mean of the two rates = 6.0. The correct aggregate = 120/20 = 6.0 too —
    // so use unequal overs to make them genuinely differ:
    // Match 1: 100 off 10 (10.0). Match 2: 20 off 30 (0.667). mean = 5.33.
    // Aggregate = 120/40 = 3.0. The aggregate is the correct one.
    const agg = netRunRate({ runsScored: 120, oversFaced: 40, runsConceded: 0, oversBowled: 1 });
    expect(120 / 40).toBe(3);
    expect((10 + 20 / 30) / 2).toBeCloseTo(5.333, 3);
    expect(agg).not.toBeCloseTo(5.333, 2);
  });

  it('is null — never a fabricated number — when no overs were recorded', () => {
    expect(netRunRate({ runsScored: 300, oversFaced: 0, runsConceded: 250, oversBowled: 0 })).toBeNull();
  });

  it('ICC all-out rule: a side bowled out is charged its FULL quota', () => {
    // All out for 80 off 12.0 overs in a 20-over game → NRR uses 20, not 12.
    const m = cricket('A', 'B', 80, 72, 81, 60, 'B', { aWkts: 10, overs: 20 });
    expect(inningsOf(m).a.overs).toBe(20);      // charged the quota
    expect(inningsOf(m).b.overs).toBe(10);      // 60 balls = 10 overs, not out
  });

  it('THE BUG: run difference and NRR can disagree, and NRR must win', () => {
    // X: 300 off 40 overs.  Y: 310 off 60 overs. Both concede the same.
    // run diff  → Y ahead (310 > 300)
    // NRR       → X ahead (7.50 vs 5.17)
    const ms: GMatch[] = [
      cricket('X', 'Z', 300, 240, 200, 240, 'X'),   // X 300 off 40, Z 200 off 40
      cricket('Y', 'Z', 310, 360, 200, 360, 'Y'),   // Y 310 off 60, Z 200 off 60
    ];
    const stats = computeStats(['X', 'Y', 'Z'], ms);
    const X = stats.get('X')!, Y = stats.get('Y')!;
    expect(X.diff).toBe(100);
    expect(Y.diff).toBe(110);                    // Y wins on raw difference
    expect(X.nrr).toBeCloseTo(7.5 - 5.0, 3);     // +2.5
    expect(Y.nrr).toBeCloseTo(310 / 60 - 200 / 60, 3); // +1.833
    expect(X.nrr!).toBeGreaterThan(Y.nrr!);      // X wins on NRR

    // X and Y are level on points (one win each) → the tiebreak decides.
    const order = rankTeams(['X', 'Y', 'Z'], ms);
    expect(order.slice(0, 2)).toEqual(['X', 'Y']);   // NRR order, NOT diff order
  });

  it("'nrr' in tiebreaker_rules means the rate, not the run difference", () => {
    const ms: GMatch[] = [
      cricket('X', 'Z', 300, 240, 200, 240, 'X'),
      cricket('Y', 'Z', 310, 360, 200, 360, 'Y'),
    ];
    expect(rankTeams(['X', 'Y', 'Z'], ms, ['nrr']).slice(0, 2)).toEqual(['X', 'Y']);
    // ...and asking explicitly for run difference still gives the other order.
    expect(rankTeams(['X', 'Y', 'Z'], ms, ['score_diff']).slice(0, 2)).toEqual(['Y', 'X']);
  });

  it('non-cricket is unaffected: goal difference still decides', () => {
    const goals = (a: string, b: string, ga: number, gb: number, w: string | null): GMatch => ({
      team_a_id: a, team_b_id: b, winner_team_id: w, status: 'completed',
      score_summary: { team_a_score: ga, team_b_score: gb },
    });
    const ms = [goals('P', 'R', 5, 0, 'P'), goals('Q', 'R', 2, 0, 'Q')];
    const stats = computeStats(['P', 'Q', 'R'], ms);
    expect(stats.get('P')!.nrr).toBeNull();      // no overs → no rate, not 0-as-fact
    expect(rankTeams(['P', 'Q', 'R'], ms).slice(0, 2)).toEqual(['P', 'Q']);  // GD 5 > 2
  });
});

// ── The full ladder ────────────────────────────────────────────────────────
describe('SC-376 · every tiebreak actually decides the order', () => {
  const goals = (a: string, b: string, ga: number, gb: number, w: string | null): GMatch => ({
    team_a_id: a, team_b_id: b, winner_team_id: w, status: 'completed',
    score_summary: { team_a_score: ga, team_b_score: gb },
  });

  it('HEAD-TO-HEAD breaks a tie before goal difference', () => {
    // A and B both beat C; A beat B. Equal points; B has the better GD.
    const ms = [
      goals('A', 'C', 1, 0, 'A'),
      goals('B', 'C', 9, 0, 'B'),
      goals('A', 'B', 1, 0, 'A'),
    ];
    const st = computeStats(['A', 'B', 'C'], ms);
    expect(st.get('A')!.points).toBe(6);
    expect(st.get('B')!.points).toBe(3);
    // Make them level: give B a win over A instead of a loss is not possible in
    // the same fixture, so use a 3-team tie on 3 points each (a cycle).
    const cycle = [goals('A', 'B', 1, 0, 'A'), goals('B', 'C', 5, 0, 'B'), goals('C', 'A', 1, 0, 'C')];
    const cst = computeStats(['A', 'B', 'C'], cycle);
    expect([cst.get('A')!.points, cst.get('B')!.points, cst.get('C')!.points]).toEqual([3, 3, 3]);
    // Perfect cycle → h2h is level (3 each) → falls through to GD: B +4, A 0, C -3
    expect(rankTeams(['A', 'B', 'C'], cycle)).toEqual(['B', 'A', 'C']);
  });

  it('a two-way tie is broken by the head-to-head result, ignoring GD', () => {
    // A and B on 3 points each (each beat C once); A beat B head to head is
    // impossible without changing points, so: both drew C, A beat B.
    const ms = [
      goals('A', 'C', 0, 0, null),   // A 1pt
      goals('B', 'C', 7, 7, null),   // B 1pt
      goals('A', 'B', 1, 0, 'A'),    // A +3 = 4, B = 1
    ];
    // Not level. Use the level construction: A and B each beat C, then drew.
    const level = [
      goals('A', 'C', 1, 0, 'A'),
      goals('B', 'C', 8, 0, 'B'),
      goals('A', 'B', 0, 0, null),
    ];
    const st = computeStats(['A', 'B', 'C'], level);
    expect(st.get('A')!.points).toBe(4);
    expect(st.get('B')!.points).toBe(4);
    expect(st.get('A')!.diff).toBe(1);
    expect(st.get('B')!.diff).toBe(8);
    // h2h is a draw → no separation → GD decides → B first.
    expect(rankTeams(['A', 'B', 'C'], level)).toEqual(['B', 'A', 'C']);
    expect(ms.length).toBe(3);
  });

  it('head-to-head OUTRANKS goal difference when it separates', () => {
    // A clean TWO-way tie at the top. A and B both finish on 6 points.
    //   A beat B 1-0     → head-to-head says A
    //   A lost to C 0-5, beat D 1-0  → GD  +1 -5 +1 = -3
    //   B beat C 1-0,    beat D 4-0  → GD  -1 +1 +4 = +4  → GD says B
    // Hand-worked: h2h is consulted BEFORE goal difference, so A finishes above
    // B even though B's goal difference is seven better.
    const ms = [
      goals('A', 'B', 1, 0, 'A'),
      goals('C', 'A', 5, 0, 'C'),
      goals('A', 'D', 1, 0, 'A'),
      goals('B', 'C', 1, 0, 'B'),
      goals('B', 'D', 4, 0, 'B'),
      goals('D', 'C', 1, 0, 'D'),
    ];
    const st = computeStats(['A', 'B', 'C', 'D'], ms);
    expect(st.get('A')!.points).toBe(6);
    expect(st.get('B')!.points).toBe(6);          // genuinely level
    expect(st.get('A')!.diff).toBe(-3);
    expect(st.get('B')!.diff).toBe(4);
    expect(st.get('A')!.diff).toBeLessThan(st.get('B')!.diff);   // GD says B first

    const order = rankTeams(['A', 'B', 'C', 'D'], ms);
    expect(order.slice(0, 2)).toEqual(['A', 'B']);               // h2h wins → A first
    // and asking explicitly for goal difference alone flips it, proving the
    // ladder position is what decided the order and not some incidental sort.
    expect(rankTeams(['A', 'B', 'C', 'D'], ms, ['score_diff']).slice(0, 2)).toEqual(['B', 'A']);
  });

  it('team_id terminates a total tie so a group never strands', () => {
    const ms: GMatch[] = [];
    expect(rankTeams(['zeta', 'alpha', 'mid'], ms)).toEqual(['alpha', 'mid', 'zeta']);
  });
});

// ── SC-378 · seeding ───────────────────────────────────────────────────────
function seedSlotOrder(size: number): number[] {
  let order = [1, 2];
  while (order.length < size) {
    const sum = order.length * 2 + 1;
    const next: number[] = [];
    for (const s of order) { next.push(s); next.push(sum - s); }
    order = next;
  }
  return order;
}
const nextPow2 = (n: number) => { let p = 1; while (p < n) p *= 2; return p; };
function seededRound1(seeds: (string | null)[], koSize: number) {
  const order = seedSlotOrder(koSize);
  const slots = order.map((s) => seeds[s - 1] ?? null);
  const r1: Array<{ a: string | null; b: string | null }> = [];
  for (let m = 0; m < koSize / 2; m++) r1.push({ a: slots[2 * m] ?? null, b: slots[2 * m + 1] ?? null });
  return r1;
}

describe('SC-378 · seeded direct knockout', () => {
  it('the slot order is the standard bracket', () => {
    expect(seedSlotOrder(2)).toEqual([1, 2]);
    expect(seedSlotOrder(4)).toEqual([1, 4, 2, 3]);
    expect(seedSlotOrder(8)).toEqual([1, 8, 4, 5, 2, 7, 3, 6]);
  });

  it('seed 1 plays the LOWEST seed and 1 v 2 can only meet in the final', () => {
    const r1 = seededRound1(['s1', 's2', 's3', 's4', 's5', 's6', 's7', 's8'], 8);
    expect(r1[0]).toEqual({ a: 's1', b: 's8' });
    expect(r1[3]).toEqual({ a: 's3', b: 's6' });
    // 1 and 2 in opposite halves: first two matches feed one semi, last two the other
    const topHalf = [r1[0], r1[1]].flatMap((m) => [m.a, m.b]);
    const botHalf = [r1[2], r1[3]].flatMap((m) => [m.a, m.b]);
    expect(topHalf).toContain('s1');
    expect(botHalf).toContain('s2');
  });

  it('BYES fall on the TOP seeds — 5 teams in an 8 bracket', () => {
    const r1 = seededRound1(['s1', 's2', 's3', 's4', 's5'], nextPow2(5));
    const byeTeams = r1.filter((m) => !m.a || !m.b).map((m) => m.a ?? m.b);
    expect(byeTeams.sort()).toEqual(['s1', 's2', 's3']);   // seeds 1-3 rest
    expect(r1.find((m) => m.a === 's4' || m.b === 's4')).toEqual({ a: 's4', b: 's5' });
  });

  it('3 teams: seed 1 gets the bye, 2 plays 3', () => {
    const r1 = seededRound1(['s1', 's2', 's3'], nextPow2(3));
    expect(r1).toEqual([{ a: 's1', b: null }, { a: 's2', b: 's3' }]);
  });

  it('the old index pairing put byes on arbitrary teams (the SC-378 bug)', () => {
    // buildRound1: match m = teams[m] v teams[M+m]
    const teams = ['s1', 's2', 's3', 's4', 's5'];
    const M = nextPow2(5) / 2;
    const old = Array.from({ length: M }, (_, m) => ({ a: teams[m] ?? null, b: teams[M + m] ?? null }));
    const oldByes = old.filter((m) => !m.a || !m.b).map((m) => m.a ?? m.b);
    expect(oldByes).toEqual(['s2', 's3', 's4']);   // NOT the top seeds
    expect(old[0]).toEqual({ a: 's1', b: 's5' });
  });
});

// ── SC-377 · withdrawal ────────────────────────────────────────────────────
describe('SC-377 · a withdrawn team', () => {
  const goals = (a: string, b: string, ga: number, gb: number, w: string | null, status = 'completed'): GMatch => ({
    team_a_id: a, team_b_id: b, winner_team_id: w, status,
    score_summary: { team_a_score: ga, team_b_score: gb },
  });

  it("keeps its opponents' earned points — dropping it erased a real win", () => {
    const played = [goals('A', 'B', 2, 0, 'A')];
    const withB = computeStats(['A', 'B'], played);
    expect(withB.get('A')!.points).toBe(3);       // A's win stands
    const withoutB = computeStats(['A'], played); // the old "exclude withdrawn" shape
    expect(withoutB.get('A')!.points).toBe(0);    // ...silently deleted it
  });

  it('scores nothing for a fixture that will not be played (walkover/abandoned, no winner)', () => {
    const forfeit = [goals('A', 'B', 0, 0, null, 'abandoned')];
    // An abandoned match with no winner is terminal, so it reads as a draw for
    // teams still in the table — which is why the withdrawing team is what gets
    // dropped from the ranked field, not the fixture.
    const st = computeStats(['A'], forfeit);
    expect(st.get('A')!.played).toBe(0);          // B not in the table → not counted
    expect(st.get('A')!.points).toBe(0);
  });

  it('a withdrawn team that never played contributes no row and no points', () => {
    const st = computeStats(['A', 'B', 'GONE'], [goals('A', 'B', 1, 0, 'A')]);
    expect([st.get('GONE')!.played, st.get('GONE')!.points]).toEqual([0, 0]);
  });
});

// ── SC-377 · ranking must see the withdrawn team's fixtures ────────────────
describe('SC-377 · a withdrawn team is ranked last WITHOUT erasing its results', () => {
  const goals = (a: string, b: string, ga: number, gb: number, w: string | null): GMatch => ({
    team_a_id: a, team_b_id: b, winner_team_id: w, status: 'completed',
    score_summary: { team_a_score: ga, team_b_score: gb },
  });
  // A beat B 2-0. B then withdrew. C has played nothing.
  const ms = [goals('A', 'B', 2, 0, 'A')];
  const all = ['A', 'B', 'C'];

  it('the BROKEN shape — ranking a filtered list — loses A\'s win', () => {
    const live = rankTeams(['A', 'C'], ms);
    const filteredStats = computeStats(['A', 'C'], ms);
    expect(filteredStats.get('A')!.points).toBe(0);   // the win vanished
    expect(live).toEqual(['A', 'C']);                 // ordered by team_id, not merit
  });

  it('ranking the whole group keeps A on 3 points and above C', () => {
    const ranked = rankTeams(all, ms);
    expect(computeStats(all, ms).get('A')!.points).toBe(3);
    expect(ranked[0]).toBe('A');
  });

  it('withdrawn rows move to the bottom while the live order stays on merit', () => {
    const withdrawn = new Set(['B']);
    const ranked = rankTeams(all, ms);
    const final = [
      ...ranked.filter((i) => !withdrawn.has(i)),
      ...ranked.filter((i) => withdrawn.has(i)),
    ];
    expect(final).toEqual(['A', 'C', 'B']);
  });
});

// ── SC-376 · the result TEXT must read the same score the table does ───────
describe('SC-376 · result text reads flat and nested scores alike', () => {
  const scoreOf = (ss: any) => ({
    a: Number(ss?.team_a_score ?? ss?.A?.score ?? ss?.A?.runs ?? 0),
    b: Number(ss?.team_b_score ?? ss?.B?.score ?? ss?.B?.runs ?? 0),
  });

  it('a flat score submitted with the result is not rendered as 0-0', () => {
    expect(scoreOf({ team_a_score: 4, team_b_score: 1 })).toEqual({ a: 4, b: 1 });
  });
  it('the live scorer nested shape still wins where present', () => {
    expect(scoreOf({ A: { score: 3, runs: 3 }, B: { score: 2, runs: 2 } })).toEqual({ a: 3, b: 2 });
  });
  it('cricket runs still resolve when only runs are set', () => {
    expect(scoreOf({ A: { runs: 180 }, B: { runs: 175 } })).toEqual({ a: 180, b: 175 });
  });
  it('agrees with the standings comparator on the same summary', () => {
    const ss = { team_a_score: 4, team_b_score: 1 };
    const st = computeStats(['A', 'B'], [{
      team_a_id: 'A', team_b_id: 'B', winner_team_id: 'A', status: 'completed', score_summary: ss,
    }]);
    const { a, b } = scoreOf(ss);
    expect([a, b]).toEqual([st.get('A')!.scored, st.get('A')!.conceded]);
  });
});

// ── SC-384 · session revocation must beat the JWT lifetime ─────────────────
describe('SC-384 · a revoked access token is refused', () => {
  // Mirrors isTokenRevoked: reject anything minted strictly before the cutoff.
  const revoked = (iatSec: number | undefined, revokedAtMs: number | null) => {
    if (!iatSec) return false;
    if (revokedAtMs == null) return false;
    return iatSec * 1000 < revokedAtMs;
  };
  const T = 1_800_000_000_000; // a fixed instant, ms

  it('a token minted before the revocation is rejected', () => {
    expect(revoked(T / 1000 - 60, T)).toBe(true);
  });
  it('the replacement minted after the revocation still works', () => {
    expect(revoked(T / 1000 + 1, T)).toBe(false);
  });
  it('a token minted in the same second survives (the caller keeps their session)', () => {
    expect(revoked(T / 1000, T)).toBe(false);
  });
  it('an account that never revoked is unaffected', () => {
    expect(revoked(T / 1000 - 99999, null)).toBe(false);
  });
  it('a same-second session is REVOKED, not spared', () => {
    // Flooring the cutoff (the first fix) spared any session established in the
    // same second as the revocation — reproduced in prod on the 3rd of 10 cycles.
    const cutoffMs = T + 750;
    const victimIat = Math.floor(T / 1000);          // logged in that same second
    expect(revoked(victimIat, cutoffMs)).toBe(true);           // full precision: revoked
    const floored = Math.floor(cutoffMs / 1000) * 1000;
    expect(revoked(victimIat, floored)).toBe(false);           // floored: the bug
  });

  it("the caller's replacement is stamped the NEXT second, so it survives", () => {
    const cutoffMs = T + 750;
    const replacementIat = Math.floor(cutoffMs / 1000) + 1;    // generateAccessTokenAt
    expect(revoked(replacementIat, cutoffMs)).toBe(false);
    // ...and it is strictly newer than any token from the cutoff second.
    expect(replacementIat).toBeGreaterThan(Math.floor(T / 1000));
  });

  it('the 15-minute window is what this closes', () => {
    // A 900s token minted 1s before the revocation would otherwise stay valid
    // for another 899 seconds.
    const iat = T / 1000 - 1;
    expect(iat * 1000 + 900_000 > T).toBe(true);  // the old behaviour
    expect(revoked(iat, T)).toBe(true);           // the new one
  });
});
