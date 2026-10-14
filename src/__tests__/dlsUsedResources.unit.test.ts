/**
 * F138 (launch test plan, Round 1) · a chase interrupted part-way through.
 *
 * The revised target used only the resources Team 2 had LEFT after the stoppage
 * and ignored the overs it had already batted, so a side on 100/2 after 10 of 20
 * overs, with 5 overs lost to rain, was set 60 (below what it had already scored)
 * and "won" at once; with no overs lost at all the target came out 107, not 201.
 * DLS charges Team 2 only the resources the interruption took away:
 *   R2 = R(full innings) − [R(overs left at the stoppage, w) − R(overs left after it, w)].
 */
import { calculateDLSTarget, dlsInputProblem } from '../utils/dls';

describe('F138 · DLS counts the overs Team 2 already batted', () => {
  it('no overs lost mid-chase → the target is unchanged (201 to win after 200)', () => {
    expect(calculateDLSTarget(200, 20, 10, 2, 10).revisedTarget).toBe(201);
  });

  it('100/2 after 10 of 20, 5 overs lost → a reduced target that is still above the 100 already scored', () => {
    const t = calculateDLSTarget(200, 20, 5, 2, 10).revisedTarget;
    expect(t).toBeGreaterThan(100);
    expect(t).toBeLessThan(201);
  });

  it('worked example: 200 in 20; 100/2 after 10; 5 lost → R2 = R(20,0) − (R(10,2) − R(5,2))', () => {
    const R = (o: number, wf: number) => 100 * (1 - Math.pow(0.96, o)) * wf;
    const r1 = R(20, 1); const r2 = r1 - (R(10, 0.88) - R(5, 0.88));
    expect(calculateDLSTarget(200, 20, 5, 2, 10).revisedTarget).toBe(Math.ceil(200 * (r2 / r1)) + 1);
  });

  it('an innings shortened before Team 2 bats is unchanged (faced 0)', () => {
    const before = calculateDLSTarget(180, 20, 12, 0, 0).revisedTarget;
    expect(before).toBe(calculateDLSTarget(180, 20, 12, 0).revisedTarget);
    expect(before).toBeLessThan(181);
  });

  it('refuses more overs left after the stoppage than were left before it', () => {
    expect(dlsInputProblem({ team1Score: 200, totalOvers: 20, team2OversLeft: 12, team2Wickets: 2, team2OversFaced: 10 }))
      .toBe('Team 2 has batted 10 overs, so at most 10 can be left.');
  });
});
