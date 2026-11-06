/**
 * N-R7-147 (SP-CHS-F02, SP-CHS-059/060): the chess table shows each player's tie-break values
 * (the server sends them with the standings rows), and a bye row says which bye it was.
 */
import { rankTeamsDetailed, pointsFor, type GMatch } from '../utils/standings';
import { fixtureBye } from '../controllers/tournaments.controller';

const pts = pointsFor('chess');
const g = (round: number, w: string, b: string, res: 'w' | 'b' | 'd'): GMatch => ({
  round, team_a_id: w, team_b_id: b, winner_team_id: res === 'w' ? w : res === 'b' ? b : null, status: 'completed', score_summary: {},
});

describe('N-R7-147 · chess tie-break values', () => {
  // SP-CHS-059: A bt B, A drew C, D bt A, B bt C, B bt D, C bt D → B 2, A 1½, C 1½, D 1.
  const rr = [g(1, 'A', 'B', 'w'), g(1, 'C', 'D', 'w'), g(2, 'A', 'C', 'd'), g(2, 'B', 'D', 'w'), g(3, 'D', 'A', 'w'), g(3, 'B', 'C', 'w')];
  it('SB and Buchholz per player, in the order of the steps', () => {
    const d = rankTeamsDetailed(['A', 'B', 'C', 'D'], rr, ['points', 'sonneborn_berger', 'buchholz', 'head_to_head'], pts);
    expect(d.order).toEqual(['B', 'A', 'C', 'D']);
    expect(d.tiebreaks.get('A')).toEqual([{ key: 'sonneborn_berger', value: 2.75 }, { key: 'buchholz', value: 4.5 }]);
    expect(d.tiebreaks.get('C')).toEqual([{ key: 'sonneborn_berger', value: 1.75 }, { key: 'buchholz', value: 4.5 }]);
  });
  it('a table with no chess tie-break sends none', () => {
    expect(rankTeamsDetailed(['A', 'B', 'C', 'D'], rr, ['points', 'head_to_head', 'wins'], pts).tiebreaks.size).toBe(0);
  });
  it("a bye row says which bye it is", () => {
    expect(fixtureBye({ team_b_id: null, score_summary: { bye: true } })).toEqual({ bye: 'pairing' });
    expect(fixtureBye({ team_b_id: null, score_summary: { bye: true, bye_kind: 'half', requested: true } })).toEqual({ bye: 'half' });
    expect(fixtureBye({ team_b_id: null, score_summary: { bye: true, bye_kind: 'zero', absent: true } })).toEqual({ bye: 'zero', absent: true });
    expect(fixtureBye({ team_b_id: 'X', score_summary: {} })).toEqual({});
  });
});
