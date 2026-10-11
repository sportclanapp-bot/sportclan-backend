/** Audit #69 (11 Oct 2026): a Swiss half-point bye counted a draw but not a game played (W + D + L ≠ P). */
import { computeStats } from '../utils/standings';

describe('audit #69', () => {
  it('a half-point bye: P 1, D 1, ½ point', () => {
    const t = computeStats(['A'], [{ team_a_id: 'A', team_b_id: null, winner_team_id: null, status: 'completed', score_summary: { bye: true, bye_kind: 'half' } }] as never[], undefined, { win: 1, draw: 0.5, loss: 0 } as never);
    const r = t.get('A')!;
    expect([r.played, r.won, r.drawn, r.lost, r.points]).toEqual([1, 0, 1, 0, 0.5]);
  });
});
