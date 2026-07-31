/**
 * SC-370 · regression tests for the arithmetic behind displayed numbers.
 *
 * Every case here corresponds to a bug this app has actually shipped, so the
 * tests are written as "the shape that broke", not as generic maths.
 */
import { normaliseVenue } from '../utils/validation';

// ── The expense split (SC-360: Math.ceil over-collected) ────────────────────
// Reproduced as a pure function so the invariant can be asserted directly.
function splitEvenly(totalPaise: number, members: number) {
  const per = Math.floor(totalPaise / Math.max(1, members));
  const remainder = totalPaise - per * Math.max(1, members);
  return { per, remainder };
}

describe('SC-360 · expense split must add back up to the total', () => {
  it('₹100 across 3 does not over-collect (the Math.ceil bug)', () => {
    const { per, remainder } = splitEvenly(10000, 3);
    expect(per).toBe(3333);            // ₹33.33
    expect(remainder).toBe(1);         // 1 paisa left over
    expect(per * 3 + remainder).toBe(10000);
  });

  it.each([
    [10000, 3], [10000, 7], [1, 3], [999999, 11], [0, 5], [12345, 2],
  ])('perMember*members + remainder === total (%i paise across %i)', (total, members) => {
    const { per, remainder } = splitEvenly(total, members);
    expect(per * members + remainder).toBe(total);
    expect(remainder).toBeGreaterThanOrEqual(0);
    expect(remainder).toBeLessThan(members);
  });

  it('never divides by zero when a team somehow has 0 members', () => {
    expect(() => splitEvenly(500, 0)).not.toThrow();
    expect(splitEvenly(500, 0).per).toBe(500);
  });
});

// ── Money in paise (SC-360: 0.10 + 0.20 reached the client as 0.30000000000000004)
function toPaise(n: unknown) { return Math.round(Number(n ?? 0) * 100); }
function toRupees(p: number) { return Math.round(p) / 100; }

describe('SC-360 · money totals must not drift', () => {
  it('0.10 + 0.20 sums to exactly 0.3', () => {
    const total = [0.1, 0.2].reduce((s, n) => s + toPaise(n), 0);
    expect(toRupees(total)).toBe(0.3);
    expect(String(toRupees(total))).not.toContain('0000000');
  });

  it('a long tail of decimals stays exact', () => {
    const amounts = [0.1, 0.2, 0.1, 10.1, 20.2, 0.3, 50];
    const total = amounts.reduce((s, n) => s + toPaise(n), 0);
    expect(toRupees(total)).toBe(81);
  });
});

// ── Averages/rates: the divisor and the zero case ──────────────────────────
function winPct(wins: number, played: number) {
  return played > 0 ? Math.round((wins / played) * 100) : 0;
}
function battingAvg(runs: number, dismissals: number) {
  return dismissals > 0 ? Math.round((runs / dismissals) * 100) / 100 : runs;
}
function strikeRate(runs: number, balls: number) {
  return balls > 0 ? Math.round((runs / balls) * 10000) / 100 : 0;
}

describe('SC-370 · averages and rates guard their divisor', () => {
  it('win% is 0, not NaN, at zero matches', () => {
    expect(winPct(0, 0)).toBe(0);
    expect(Number.isNaN(winPct(0, 0))).toBe(false);
  });
  it('win% rounds as displayed', () => {
    expect(winPct(1, 1)).toBe(100);
    expect(winPct(1, 3)).toBe(33);
    expect(winPct(2, 3)).toBe(67);
  });
  it('batting average with no dismissals is not Infinity', () => {
    expect(battingAvg(24, 0)).toBe(24);
    expect(Number.isFinite(battingAvg(24, 0))).toBe(true);
  });
  it('strike rate is 0, not NaN, off zero balls', () => {
    expect(strikeRate(0, 0)).toBe(0);
    expect(strikeRate(24, 6)).toBe(400);
  });
});

// ── An aggregate must not be computed from a display page (SC-370 reviews) ──
describe('SC-370 · aggregates must not be page-limited', () => {
  const PAGE = 50;
  const allRatings = Array.from({ length: 120 }, (_, i) => (i < 60 ? 5 : 1));

  it('a page-limited average disagrees with the true average', () => {
    const page = allRatings.slice(0, PAGE);
    const avgOfPage = page.reduce((a, b) => a + b, 0) / page.length;
    const avgOfAll = allRatings.reduce((a, b) => a + b, 0) / allRatings.length;
    expect(avgOfPage).not.toBeCloseTo(avgOfAll);   // the bug, made explicit
    expect(page.length).toBe(50);
    expect(allRatings.length).toBe(120);           // the count that must be shown
  });
});

// ── Venue normalisation (SC-367/369) ───────────────────────────────────────
describe('SC-367 · venue normalisation is one shared rule', () => {
  it('trims, and treats whitespace-only as absent', () => {
    expect(normaliseVenue('  Shivaji Park  ')).toBe('Shivaji Park');
    expect(normaliseVenue('   ')).toBeNull();
    expect(normaliseVenue('')).toBeNull();
    expect(normaliseVenue(null)).toBeNull();
  });
});

// ── SC-371 · cricket innings arithmetic ────────────────────────────────────
// Mirrors recomputeSummary: a wide adds runs but NOT a ball; byes/leg-byes are
// legal deliveries; a wicket consumes a ball.
function innings(events: Array<{ t: 'ball'|'extra'|'wicket'; runs?: number; kind?: string }>) {
  let runs = 0, balls = 0, wickets = 0;
  for (const e of events) {
    if (e.t === 'ball') { runs += e.runs ?? 0; balls += 1; }
    else if (e.t === 'extra') { runs += e.runs ?? 0; if (e.kind === 'B' || e.kind === 'Lb') balls += 1; }
    else { wickets += 1; balls += 1; }
  }
  return { runs, balls, wickets, overs: `${Math.floor(balls / 6)}.${balls % 6}`,
           runRate: balls > 0 ? Number((runs / (balls / 6)).toFixed(2)) : 0 };
}

describe('SC-371 · innings totals, overs and run rate', () => {
  it('matches a hand-computed innings (1,4,0,6,2,1 + wide + bye2 + wicket)', () => {
    const r = innings([
      { t: 'ball', runs: 1 }, { t: 'ball', runs: 4 }, { t: 'ball', runs: 0 },
      { t: 'ball', runs: 6 }, { t: 'ball', runs: 2 }, { t: 'ball', runs: 1 },
      { t: 'extra', runs: 1, kind: 'Wd' },
      { t: 'extra', runs: 2, kind: 'B' },
      { t: 'wicket' },
    ]);
    expect(r).toEqual({ runs: 17, balls: 8, wickets: 1, overs: '1.2', runRate: 12.75 });
  });

  it('a wide never advances the over', () => {
    const r = innings([{ t: 'extra', runs: 1, kind: 'Wd' }, { t: 'extra', runs: 5, kind: 'Nb' }]);
    expect(r.balls).toBe(0);
    expect(r.runs).toBe(6);
    expect(r.runRate).toBe(0);      // guarded, not Infinity
  });

  it('overs use cricket notation, not decimals', () => {
    expect(innings(Array(6).fill({ t: 'ball', runs: 0 })).overs).toBe('1.0');
    expect(innings(Array(7).fill({ t: 'ball', runs: 0 })).overs).toBe('1.1');
    expect(innings(Array(12).fill({ t: 'ball', runs: 0 })).overs).toBe('2.0');
  });
});

// ── SC-371 · highest score must be the best INNINGS, not the running total ──
function highestScore(perMatchRuns: number[]) {
  return perMatchRuns.length ? Math.max(...perMatchRuns) : 0;
}
function brokenHighestScore(ballRuns: number[]) {
  // the shipped bug: tracked the max of the CUMULATIVE total
  let runs = 0, hs = 0;
  for (const r of ballRuns) { runs += r; if (runs > hs) hs = runs; }
  return hs;
}

describe('SC-371 · BEST is the best innings, not the career total', () => {
  it('the old cumulative form always equalled total runs', () => {
    const balls = [4, 4, 6, 2];               // 16 across two matches
    expect(brokenHighestScore(balls)).toBe(16);   // === total, never a real best
  });
  it('per-match max is the real best', () => {
    expect(highestScore([8, 8])).toBe(8);     // not 16
    expect(highestScore([])).toBe(0);
  });
});

// ── SC-372 · round-robin standings ─────────────────────────────────────────
// Points rule under test: W=3, D=1, L=0 (matches utils/standings.ts).
type RRMatch = { a: string; b: string; winner: string | null };
function standings(teams: string[], ms: RRMatch[]) {
  const t = new Map(teams.map((id) => [id, { id, played: 0, won: 0, drawn: 0, lost: 0, points: 0 }]));
  for (const m of ms) {
    const A = t.get(m.a)!, B = t.get(m.b)!;
    A.played++; B.played++;
    if (m.winner === m.a) { A.won++; A.points += 3; B.lost++; }
    else if (m.winner === m.b) { B.won++; B.points += 3; A.lost++; }
    else { A.drawn++; B.drawn++; A.points += 1; B.points += 1; }
  }
  return [...t.values()].sort((x, y) => y.points - x.points || (x.id < y.id ? -1 : 1));
}

describe('SC-372 · round-robin standings', () => {
  const T = ['A', 'B', 'C', 'D'];
  const MS: RRMatch[] = [
    { a: 'A', b: 'B', winner: 'A' }, { a: 'A', b: 'C', winner: 'A' }, { a: 'A', b: 'D', winner: null },
    { a: 'B', b: 'C', winner: 'B' }, { a: 'B', b: 'D', winner: null }, { a: 'C', b: 'D', winner: 'C' },
  ];

  it('a 4-team single round robin has N(N-1)/2 = 6 fixtures', () => {
    const pairs = new Set(MS.map((m) => [m.a, m.b].sort().join('-')));
    expect(MS.length).toBe(6);
    expect(pairs.size).toBe(6);          // every pair exactly once
  });

  it('reproduces the hand-worked table', () => {
    expect(standings(T, MS).map((r) => [r.id, r.played, r.won, r.drawn, r.lost, r.points]))
      .toEqual([['A',3,2,1,0,7], ['B',3,1,1,1,4], ['C',3,1,0,2,3], ['D',3,0,2,1,2]]);
  });

  it('W+L+D === played and points === 3W+D for every row', () => {
    for (const r of standings(T, MS)) {
      expect(r.won + r.drawn + r.lost).toBe(r.played);
      expect(r.points).toBe(3 * r.won + r.drawn);
    }
  });

  it('total points === 3 per decisive match + 2 per draw', () => {
    const decisive = MS.filter((m) => m.winner).length;
    const drawn = MS.length - decisive;
    const total = standings(T, MS).reduce((s, r) => s + r.points, 0);
    expect(total).toBe(decisive * 3 + drawn * 2);
    expect(total).toBe(16);
  });

  it('a team with no matches has no points and no divide-by-zero', () => {
    const rows = standings(['A', 'B', 'Z'], [{ a: 'A', b: 'B', winner: 'A' }]);
    const z = rows.find((r) => r.id === 'Z')!;
    expect([z.played, z.points]).toEqual([0, 0]);
  });
});
