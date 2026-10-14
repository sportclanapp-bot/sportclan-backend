/** F167 (launch test plan, Round 2): a side-out rally is credited to the player who won it (how: winner, ace…) but scores them no point. */
import { aggregateRallyPlayers } from '../controllers/scoring.controller';

test('a point and a side out, both won by P', () => {
  const p = aggregateRallyPlayers([
    { event_type: 'score', payload: { team_side: 'A', kind: 'rally', player_id: 'P', how: 'ace' } },
    { event_type: 'score', payload: { team_side: 'A', kind: 'rally', side_out: true, player_id: 'P', how: 'winner' } },
  ]);
  expect(p.P).toMatchObject({ points: 1, how_ace: 1, how_winner: 1 });
});
