/**
 * F121 (launch test plan, Round 3): a double-elimination draw with byes (5 teams) could never be made
 * again — its back-draw 'BYE v BYE' row is cancelled at the draw, and that counted as 'started'.
 */
import { drawStarted } from '../controllers/redraw.controller';

const m = (o: object) => ({ id: 'x', status: 'scheduled', team_a_id: null, team_b_id: null, team_a_name: null, team_b_name: null, score_summary: {}, voided_at: null, ...o });
test('5-team double elimination right after the draw: not started', () => {
  expect(drawStarted([
    m({ team_a_id: 'A', team_b_id: null, team_a_name: 'A', team_b_name: 'BYE', status: 'completed' }),
    m({ team_a_id: null, team_b_id: null, team_a_name: 'BYE', team_b_name: 'BYE', status: 'cancelled' }),
    m({ team_a_id: 'B', team_b_id: 'C', team_a_name: 'B', team_b_name: 'C' }),
    m({}), // a later round, both slots still empty
  ] as never)).toBe(false);
});
test('a played match is still a started draw; an empty row that was played-at is not a bye', () => {
  expect(drawStarted([m({ team_a_id: 'B', team_b_id: 'C', status: 'live' })] as never)).toBe(true);
  expect(drawStarted([m({ status: 'live' })] as never)).toBe(true);
});
