/**
 * BUILD 3.15 · gully cricket: one tip, one hand (a catch off one bounce) and
 * six and out (a six is out, no runs). Rules switches, off by default; two new
 * wicket kinds the server knows, the bowler's wicket each.
 */
import { rulesRefusal, standardRules, rulesOf } from '../utils/matchRules';
import { isKnownWicketType } from '../utils/cricketEventTypes';
import { allowedOnFreeHit, isDismissal } from '../utils/cricketRules';
import { aggregateCricketPlayers } from '../controllers/scoring.controller';
import { describeEvent } from '../utils/editLog';

test('switches, off by default and for older matches', () => {
  expect(standardRules('cricket')).toMatchObject({ oneTipOneHand: false, sixAndOut: false });
  expect(rulesOf('cricket', { format: 'T20', overs: 20 })).toMatchObject({ oneTipOneHand: false, sixAndOut: false });
  expect(rulesRefusal('cricket', { ...standardRules('cricket'), oneTipOneHand: true, sixAndOut: true })).toBeNull();
  expect(rulesRefusal('cricket', { ...standardRules('cricket'), sixAndOut: 'yes' })?.field).toBe('sixAndOut');
});
test('two known kinds, dismissals, the bowler’s wicket, not on a free hit', () => {
  for (const k of ['one_tip_one_hand', 'six_and_out']) {
    expect(isKnownWicketType(k)).toBe(true);
    expect(isDismissal(k)).toBe(true);
    expect(allowedOnFreeHit(k)).toBe(false);
  }
  const roll = aggregateCricketPlayers([
    { event_type: 'wicket', payload: { team_side: 'A', wicket_type: 'six_and_out', batsman_id: 'b1', bowler_id: 'w' } },
    { event_type: 'wicket', payload: { team_side: 'A', wicket_type: 'one_tip_one_hand', batsman_id: 'b2', bowler_id: 'w', fielder_id: 'f', fielder_name: 'Patel' } },
  ] as never);
  expect(roll.w).toMatchObject({ bowl_wickets: 2 });
  expect(roll.b1).toMatchObject({ out: true, runs: 0, dismissal: 'six_and_out' });
  expect(describeEvent('wicket', { wicket_type: 'one_tip_one_hand' }, { sport: 'cricket', teamA: 'A', teamB: 'B' })).toContain('one tip, one hand');
});
