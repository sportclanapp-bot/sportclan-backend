/**
 * Audit #80 (11 Oct 2026, Dipak): a football shoot-out win earns 2 and a
 * shoot-out loss 1 in NEW tournaments; cricket keeps a full win for a super
 * over (IPL). Old football tournaments keep their points — proved on an
 * old-style league that already has shoot-out results: its table is the same.
 */
import { computeStats, pointsFor, rankTeams } from '../utils/standings';
import { pointsPresetFor, storedPoints } from '../utils/tournamentSettings';
import { withNewPoints } from '../controllers/tournaments.controller';

const so = (a: string, b: string, w: string, sa: number, sb: number) => ({ team_a_id: a, team_b_id: b, winner_team_id: w, status: 'completed', score_summary: { A: { score: 1 }, B: { score: 1 }, shootout: { A: sa, B: sb } } });
const win = (a: string, b: string, w: string | null) => ({ team_a_id: a, team_b_id: b, winner_team_id: w, status: 'completed', score_summary: { A: { score: w === a ? 2 : w ? 0 : 1 }, B: { score: w === b ? 2 : w ? 0 : 1 } } });
const league = [so('A', 'B', 'A', 4, 3), so('C', 'D', 'D', 2, 4), win('A', 'C', 'C'), win('B', 'D', 'B'), win('A', 'D', null), so('B', 'C', 'C', 3, 5)];
const table = (settings: unknown) => {
  const pts = pointsFor('football', settings);
  const t = computeStats(['A', 'B', 'C', 'D'], league as never[], undefined, pts);
  const order = rankTeams(['A', 'B', 'C', 'D'], league as never[], [] as never[], pts);
  return order.map((id) => `${id}:${t.get(id)!.points}`).join(' ');
};

describe('old football leagues keep their points (no table changes)', () => {
  // The two shapes an older football tournament can have on live: its template
  // stored as the form sent it (3/1/0, no shoot-out points), or nothing stored.
  const before = 'C:6 A:4 D:4 B:3'; // a shoot-out win counts as a full win (3), as it always has
  it('stored 3/1/0 template: same table', () => expect(table({ points: { win: 3, draw: 1, loss: 0 } })).toBe(before));
  it('no stored points: same table', () => expect(table(null)).toBe(before));
  it('reading an old tournament never applies the new default', () => {
    expect(pointsFor('football', null).shootoutWin ?? null).toBeNull();
  });
});

describe('new football tournaments: 2 for a shoot-out win, 1 for a loss', () => {
  it('the form’s template', () => expect(pointsPresetFor('football')).toMatchObject({ win: 3, draw: 1, loss: 0, shootoutWin: 2, shootoutLoss: 1 }));
  it('written down when a league is made with no points of its own', () => {
    const s = withNewPoints('football', 'league', null)!;
    expect(s.points).toMatchObject({ shootoutWin: 2, shootoutLoss: 1 });
    expect(table(s)).toBe('C:6 B:5 A:3 D:3'); // the same results, the new points
  });
  it('an organiser’s own points are kept; a knockout gets nothing added', () => {
    expect(withNewPoints('football', 'league', { v: 1, points: storedPoints({ win: 3, draw: 1, loss: 0 }) })!.points!.shootoutWin ?? null).toBeNull();
    expect(withNewPoints('football', 'knockout', null)).toBeNull();
  });
});

describe('cricket keeps a full win for a super over (IPL)', () => {
  it('no super-over points in the template', () => {
    expect(pointsPresetFor('cricket').shootoutWin ?? null).toBeNull();
    expect(withNewPoints('cricket', 'league', null)).toBeNull();
  });
});
