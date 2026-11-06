/**
 * N-R7-S109 (Step 2 · Batch 8, OBS-B12-3): a Swiss of 7 after two rounds, one player on a ½ bye in
 * round 3, leaves P23 alone on 2 points, four players on 1 and P27 on 0. The draft paired the
 * 1-pointers among themselves and floated P23 two score groups down to P27 (2 v 0), though P23
 * could meet P25 or P28 (2 v 1) and a 1-pointer then meets P27 (1 v 0). FIDE C.04.3 C.7: with the
 * same number of downfloaters, the downfloaters' scores (highest first) are kept as low as
 * possible — ahead of colour preferences. The bracket's quality now counts the floaters' scores.
 */
import { dutchHistory, dutchRound } from '../utils/swissDutch';

test("the 2-pointer meets a 1-pointer; the 1-pointer floats to the 0, not the 2-pointer", () => {
  const all = ['p23', 'p24', 'p25', 'p26', 'p27', 'p28', 'p29'];
  const games = [
    { round: 1, white: 'p23', black: 'p26', winner: 'p23' }, { round: 1, white: 'p27', black: 'p24', winner: 'p24' },
    { round: 1, white: 'p25', black: 'p28', winner: 'p25' }, { round: 1, white: 'p29', black: null, bye: true },
    { round: 2, white: 'p29', black: 'p23', winner: 'p23' }, { round: 2, white: 'p24', black: 'p25', winner: 'p24' },
    { round: 2, white: 'p26', black: 'p27', winner: 'p26' }, { round: 2, white: 'p28', black: null, bye: true },
  ];
  const pts = new Map([['p23', 2], ['p24', 2], ['p25', 1], ['p26', 1], ['p27', 0], ['p28', 1], ['p29', 1]]);
  const history = dutchHistory(all, games, () => 0);
  const players = all.filter((p) => p !== 'p24'); // p24 takes a ½ bye in round 3
  const tpn = new Map(all.map((id, i) => [id, i + 1]));
  const r = dutchRound({ players, points: pts, history, colours: true, lastRound: false, winPoints: 1, roundsPlayed: 2, tpn });
  expect(r.bye).toBeNull();
  const opp = (id: string) => { const p = r.pairs.find((x) => x.white === id || x.black === id)!; return p.white === id ? p.black : p.white; };
  expect(['p25', 'p28']).toContain(opp('p23'));
  expect(pts.get(opp('p27'))).toBe(1);
  const gaps = r.pairs.map((p) => Math.abs(pts.get(p.white)! - pts.get(p.black)!)).sort();
  expect(gaps).toEqual([0, 1, 1]);
});
