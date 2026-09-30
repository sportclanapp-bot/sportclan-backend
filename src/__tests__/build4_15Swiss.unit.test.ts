/**
 * BUILD 4.15 · Swiss pairing for chess: round 1 top half v bottom half with
 * alternating colours; later rounds paired on score with no repeats; a bye to
 * the lowest-placed player who hasn't had one, worth a win in the table; and
 * Buchholz / Sonneborn-Berger from the shared ladder.
 */
import { swissFirstRound, swissNextRound, type SwissGame } from '../utils/swiss';
import { computeStats, rankTeams, CHESS_POINTS, type GMatch } from '../utils/standings';
import { swissCreateRefusal, settingsRefusal, swissRoundsFor, changedDrawKey } from '../utils/tournamentSettings';

const P = ['p1', 'p2', 'p3', 'p4', 'p5', 'p6', 'p7', 'p8'];

test('round 1: 1 v 5, 2 v 6 … with colours alternating down the board', () => {
  expect(swissFirstRound(P)).toEqual({
    bye: null,
    pairs: [{ white: 'p1', black: 'p5' }, { white: 'p6', black: 'p2' }, { white: 'p3', black: 'p7' }, { white: 'p8', black: 'p4' }],
  });
  expect(swissFirstRound(P.slice(0, 5)).bye).toBe('p5');
});

/** Play a whole Swiss with the higher seed always winning; check no pairing repeats. */
test('five rounds of 8: nobody meets twice, colours stay balanced, byes go round', () => {
  const games: SwissGame[] = [];
  const results: GMatch[] = [];
  const seedIdx = new Map(P.map((p, i) => [p, i]));
  const play = (pairs: Array<{ white: string; black: string }>) => {
    for (const p of pairs) {
      games.push(p);
      const w = seedIdx.get(p.white)! < seedIdx.get(p.black)! ? p.white : p.black;
      results.push({ team_a_id: p.white, team_b_id: p.black, winner_team_id: w, status: 'completed', score_summary: {} });
    }
  };
  play(swissFirstRound(P).pairs);
  for (let r = 2; r <= 5; r++) {
    const ranked = rankTeams(P, results, ['buchholz'], CHESS_POINTS);
    const next = swissNextRound(ranked, games);
    expect(next.bye).toBeNull();
    play(next.pairs);
  }
  const seen = new Set<string>();
  for (const g of games) {
    const k = [g.white, g.black].sort().join('|');
    expect(seen.has(k)).toBe(false);
    seen.add(k);
  }
  for (const p of P) {
    const w = games.filter((g) => g.white === p).length;
    const b = games.filter((g) => g.black === p).length;
    expect(Math.abs(w - b)).toBeLessThanOrEqual(1);
  }
  // p1 won all five, and leads
  expect(rankTeams(P, results, ['buchholz', 'sonneborn_berger'], CHESS_POINTS)[0]).toBe('p1');
});

test('an odd field: each round’s bye goes to someone who hasn’t had one', () => {
  const five = P.slice(0, 5);
  const games: SwissGame[] = [];
  const r1 = swissFirstRound(five);
  games.push(...r1.pairs, { white: r1.bye, black: null, bye: true });
  const r2 = swissNextRound(['p5', 'p1', 'p2', 'p3', 'p4'], games);
  expect(r2.bye).not.toBe('p5');
  expect(r2.bye).toBe('p4');
});

test('score groups meet: the two leaders on 2/2 play each other in round 3', () => {
  const games: SwissGame[] = [
    { white: 'p1', black: 'p5' }, { white: 'p6', black: 'p2' }, { white: 'p3', black: 'p7' }, { white: 'p8', black: 'p4' },
    { white: 'p3', black: 'p1' }, { white: 'p2', black: 'p4' }, { white: 'p5', black: 'p6' }, { white: 'p7', black: 'p8' },
  ];
  // after two rounds: p1 and p2 on 2, the rest lower
  const next = swissNextRound(['p1', 'p2', 'p3', 'p4', 'p5', 'p6', 'p7', 'p8'], games);
  const k = next.pairs.map((p) => [p.white, p.black].sort().join('|'));
  expect(k).toContain('p1|p2');
});

test('a bye is a win’s points and a game played in the table', () => {
  const bye: GMatch = { team_a_id: 'p5', team_b_id: null, winner_team_id: 'p5', status: 'completed', score_summary: { bye: true } };
  const s = computeStats(['p5'], [bye], undefined, CHESS_POINTS);
  expect(s.get('p5')).toMatchObject({ played: 1, won: 1, points: 1 });
  // a knockout bye (unmarked) still isn't counted
  const ko = computeStats(['p5'], [{ ...bye, score_summary: {} }], undefined, CHESS_POINTS);
  expect(ko.get('p5')!.played).toBe(0);
});

test('rules: chess only, with rounds; the rounds are fixed after the draw, the server’s own count isn’t an edit', () => {
  expect(swissCreateRefusal('football', { swiss: { rounds: 5 } })?.error).toBe('Swiss is for chess.');
  expect(swissCreateRefusal('chess', {})?.error).toBe('A Swiss needs its number of rounds.');
  expect(settingsRefusal('chess', 'swiss', { swiss: { rounds: 12 } })?.error).toBe('A Swiss has 2 to 11 rounds.');
  expect(settingsRefusal('chess', 'knockout', { swiss: { rounds: 5 } })?.error).toBe('Swiss rounds are for a Swiss tournament.');
  expect(swissRoundsFor(8)).toBe(4);
  expect(swissRoundsFor(64)).toBe(7);
  expect(changedDrawKey({ v: 1, swiss: { rounds: 5, paired: 3 } }, { swiss: { rounds: 5 } })).toBeNull();
  expect(changedDrawKey({ v: 1, swiss: { rounds: 5, paired: 3 } }, { swiss: { rounds: 6 } })).toBe('swiss');
});
