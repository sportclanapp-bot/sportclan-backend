/**
 * N-R7-301 (Step 2 · Batch 12 · SIDE-B6b-1): hockey's 'FIH (wins first)' order
 * ['wins', 'score_diff', 'score_scored', 'head_to_head'] ranked matches won ABOVE points (F160's
 * lead, meant for old FIVB / ATP orders), while the editor shows '1. Points, 2. Wins' and FIH ranks
 * on points first. An order with goal difference keeps points on top; FIVB legacy, ATP and FIBA 3x3 unchanged.
 */
import { buildOrder, rankTeams } from '../utils/standings';

test('FIH: points, then wins, goal difference, goals, head-to-head', () => {
  expect(buildOrder(['wins', 'score_diff', 'score_scored', 'head_to_head'])).toEqual(['points', 'wins', 'score_diff', 'score_scored', 'head_to_head']);
});
test('unchanged: legacy FIVB, ATP, FIBA 3x3', () => {
  expect(buildOrder(['wins', 'score_ratio', 'head_to_head'])).toEqual(['wins', 'points', 'score_ratio', 'head_to_head']);
  expect(buildOrder(['wins', 'played', 'head_to_head', 'score_ratio', 'points_pct'])[0]).toBe('wins');
  expect(buildOrder(['win_ratio', 'head_to_head', 'avg_points_capped'])[0]).toBe('win_ratio');
});
test('a team with more points but fewer wins ranks higher under FIH', () => {
  const P = { win: 3, draw: 2, loss: 0, noResult: null, walkoverWin: null, walkoverLoss: null, sets: null } as never;
  const m = [
    { team_a_id: 'X', team_b_id: 'Z', winner_team_id: 'X', status: 'completed', score_summary: { team_a_score: 1, team_b_score: 0 } },
    { team_a_id: 'X', team_b_id: 'W', winner_team_id: 'X', status: 'completed', score_summary: { team_a_score: 1, team_b_score: 0 } },
    { team_a_id: 'X', team_b_id: 'Y', winner_team_id: 'Y', status: 'completed', score_summary: { team_a_score: 0, team_b_score: 1 } },
    { team_a_id: 'Y', team_b_id: 'Z', winner_team_id: null, status: 'completed', score_summary: { team_a_score: 0, team_b_score: 0 } },
    { team_a_id: 'Y', team_b_id: 'W', winner_team_id: null, status: 'completed', score_summary: { team_a_score: 0, team_b_score: 0 } },
  ] as never;
  // X: W2 L1 = 6 pts; Y: W1 D2 = 3 + 4 = 7 pts → Y above X on points, though X has more wins.
  expect(rankTeams(['X', 'Y', 'Z', 'W'], m, ['wins', 'score_diff', 'score_scored', 'head_to_head'], P)[0]).toBe('Y');
});
