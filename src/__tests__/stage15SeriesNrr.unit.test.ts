/**
 * Stage 15 follow-up (Oct 2026): a cricket best-of-N series in a league / group
 * table — net run rate from every game's runs and overs, an all-out side charged
 * its full overs; not only the last game's.
 */
import { computeStats, inningsOf, rankTeams } from '../utils/standings';

// Three cricket best-of-3 series, 2 overs a side, each team winning one (level on points): net run rate decides.
const g = (rA: number, bA: number, rB: number, bB: number, outB = false) => ({ runsA: rA, ballsA: bA, wicketsA: 0, allOutA: false, runsB: rB, ballsB: bB, wicketsB: outB ? 2 : 0, allOutB: outB });
const series = (a: string, b: string, w: string, games: ReturnType<typeof g>[]) => {
  const last = games[games.length - 1]!;
  return { team_a_id: a, team_b_id: b, winner_team_id: w, status: 'completed', overs: 2,
    score_summary: { tie: { series: true, rubbersA: 0, rubbersB: 0, decided: w === a ? 'A' : 'B' }, rubbers: games,
      A: { runs: last.runsA, balls: last.ballsA, wickets: 0 }, B: { runs: last.runsB, balls: last.ballsB, wickets: last.wicketsB, ...(last.allOutB ? { all_out: true } : {}) } } };
};
export const NRR_SERIES = [
  series('X', 'Y', 'X', [g(10, 12, 40, 12), g(30, 12, 20, 12), g(30, 12, 29, 12)]),
  series('Y', 'Z', 'Y', [g(30, 12, 20, 12), g(24, 12, 20, 6, true)]), // Z all out in 1 over: charged the full 2
  series('Z', 'X', 'Z', [g(30, 12, 25, 12), g(26, 12, 25, 12)]),
];

describe('a cricket series in the table', () => {
  it('every game counts: runs, overs, an all-out side’s full overs', () => {
    const yz = inningsOf(NRR_SERIES[1] as never);
    expect(yz.a).toEqual({ runs: 54, overs: 4 });
    expect(yz.b).toEqual({ runs: 40, overs: 4 }); // 2 overs + all out in 1 over, charged 2
  });
  it('the order changes: Y, Z, X (last game only would have read Y, X, Z)', () => {
    const st = computeStats(['X', 'Y', 'Z'], NRR_SERIES as never);
    expect(['X', 'Y', 'Z'].map((t) => st.get(t)!.points)).toEqual([3, 3, 3]); // a win each
    expect(['X', 'Y', 'Z'].map((t) => st.get(t)!.nrr)).toEqual([-2.5, 3.3, -1]);
    expect(rankTeams(['X', 'Y', 'Z'], NRR_SERIES as never, ['points', 'nrr'])).toEqual(['Y', 'Z', 'X']);
  });
  it('a single cricket match reads as before', () => {
    const one = { team_a_id: 'X', team_b_id: 'Y', winner_team_id: 'X', status: 'completed', overs: 2, score_summary: { A: { runs: 20, balls: 12, wickets: 1 }, B: { runs: 10, balls: 6, wickets: 9, all_out: true } } };
    expect(inningsOf(one as never)).toEqual({ a: { runs: 20, overs: 2 }, b: { runs: 10, overs: 2 } });
  });
});
