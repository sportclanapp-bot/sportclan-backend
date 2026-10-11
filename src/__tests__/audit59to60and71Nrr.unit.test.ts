/**
 * Audit #59, #60, #71 (11 Oct 2026) — net run rate by the ICC rules.
 *  #59 a DLS chase is charged its revised overs and the side batting first is
 *      credited target − 1 off the same overs; walkovers, awards and "result
 *      stands" on an unfinished match don't count.
 *  #60 a team with no NRR ranks below a negative one.
 *  #71 a 12-a-side side with 10 down isn't all out.
 */
import { computeStats, rankTeams, inningsOf } from '../utils/standings';

const pts = { win: 2, draw: 1, loss: 0 } as never;
const cm = (a: string, b: string, w: string | null, ss: object, overs = 20) => ({ team_a_id: a, team_b_id: b, winner_team_id: w, status: 'completed', overs, score_summary: ss });

describe('#59 DLS and unfinished results', () => {
  it('DLS: chase charged its 15 revised overs; first side credited target − 1 off 15', () => {
    // A made 180 in 20; rain; B set 140 off 15, made 141/3 in 13.2 overs.
    const m = cm('A', 'B', 'B', { A: { runs: 180, balls: 120, all_out: false }, B: { runs: 141, balls: 80, all_out: false }, dls_applied: true, dls_target: 140, dls_overs: 15, dls_chaser: 'B' });
    const inn = inningsOf(m as never);
    expect(inn.a).toEqual({ runs: 139, overs: 15 });
    expect(inn.b.runs).toBe(141);
    expect(inn.b.overs).toBeCloseTo(80 / 6);
  });
  it('an awarded chase or a walkover adds nothing to NRR', () => {
    const t = computeStats(['A', 'B'], [
      cm('A', 'B', 'A', { A: { runs: 150, balls: 120 }, B: { runs: 20, balls: 30 }, awarded: true }),
      cm('A', 'B', 'A', { A: { runs: 150, balls: 120 }, B: { runs: 20, balls: 30 }, walkover: true }),
    ] as never[], undefined, pts);
    expect(t.get('A')!.nrr ?? null).toBeNull();
    expect(t.get('A')!.points).toBe(4);
  });
});

describe('#60 no NRR ranks below a negative NRR', () => {
  it('W (walkover wins only) is below N (negative NRR) on equal points', () => {
    const ms = [
      cm('W', 'X', 'W', { walkover: true }),
      cm('N', 'Y', 'N', { A: { runs: 100, balls: 120 }, B: { runs: 99, balls: 120 } }),
      cm('N', 'Z', 'Z', { A: { runs: 100, balls: 120 }, B: { runs: 160, balls: 120 } }),
      cm('W', 'Z', 'Z', { walkover: true }),
    ];
    const ids = ['W', 'N', 'X', 'Y', 'Z'];
    const o = rankTeams(ids, ms as never[], ['score_rate'] as never[], pts);
    expect(o.indexOf('N')).toBeLessThan(o.indexOf('W'));
  });
});

describe('#71 all out by the side’s own count', () => {
  it('12-a-side, 10 down in 15 overs: charged 15 overs, not 20', () => {
    const inn = inningsOf(cm('A', 'B', 'A', { A: { runs: 120, balls: 90, wickets: 10, all_out: false, all_out_at: 11 }, B: { runs: 100, balls: 120 } }) as never);
    expect(inn.a.overs).toBe(15);
  });
  it('older rows that don’t say: 10 wickets is still all out', () => {
    const inn = inningsOf(cm('A', 'B', 'A', { A: { runs: 120, balls: 90, wickets: 10 }, B: { runs: 100, balls: 120 } }) as never);
    expect(inn.a.overs).toBe(20);
  });
});
