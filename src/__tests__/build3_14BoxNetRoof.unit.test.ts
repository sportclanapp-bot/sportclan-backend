/**
 * BUILD 3.14 · box cricket's net and roof. Net 4 / net 6 are ordinary balls.
 * Roof −5 is a ball carrying `penalty_runs: -5` — the side's total takes it,
 * the batter and bowler don't. Roof out is a wicket kind of its own.
 */
jest.mock('../utils/supabase', () => ({ supabase: { from: jest.fn(() => { throw new Error('no db in this test'); }) } }));
// eslint-disable-next-line import/first
import { validateScoringEvent, aggregateCricketPlayers } from '../controllers/scoring.controller';
// eslint-disable-next-line import/first
import { penaltyRunsOf, powerplayState, isDismissal } from '../utils/cricketRules';
// eslint-disable-next-line import/first
import { isKnownWicketType } from '../utils/cricketEventTypes';
// eslint-disable-next-line import/first
import { describeEvent } from '../utils/editLog';
// eslint-disable-next-line import/first
import { standardRules } from '../utils/matchRules';

test('a roof penalty: whole −10..−1, else nothing', () => {
  expect([penaltyRunsOf({ penalty_runs: -5 }), penaltyRunsOf({ penalty_runs: 5 }), penaltyRunsOf({ penalty_runs: -11 }), penaltyRunsOf({})]).toEqual([-5, 0, 0, 0]);
  expect(powerplayState([{ event_type: 'ball', payload: { team_side: 'A', runs: 0, penalty_runs: -5 } }, { event_type: 'ball', payload: { team_side: 'A', runs: 6 } }], 'A', 1)?.runs).toBe(1);
});
test('roof out: a known kind, a dismissal, the bowler’s wicket, worded', () => {
  expect(isKnownWicketType('hit_roof')).toBe(true);
  expect(isDismissal('hit_roof')).toBe(true);
  const roll = aggregateCricketPlayers([{ event_type: 'wicket', payload: { team_side: 'A', wicket_type: 'hit_roof', batsman_id: 'bt', bowler_id: 'bw', bowler_name: 'Khan' } }] as never);
  expect(roll.bw).toMatchObject({ bowl_wickets: 1, bowl_balls: 1 });
  expect(roll.bt).toMatchObject({ out: true, dismissal: 'hit_roof' });
  expect(describeEvent('wicket', { wicket_type: 'hit_roof' }, { sport: 'cricket', teamA: 'A', teamB: 'B' })).toContain('hit the roof');
});
test('the batter and the bowler don’t take a roof penalty', () => {
  const roll = aggregateCricketPlayers([{ event_type: 'ball', payload: { team_side: 'A', runs: 0, penalty_runs: -5, batsman_id: 'bt', bowler_id: 'bw' } }] as never);
  expect(roll.bt).toMatchObject({ runs: 0, balls: 1 });
  expect(roll.bw).toMatchObject({ bowl_runs: 0, bowl_balls: 1 });
});
describe('the server takes a roof penalty only on a ball in box cricket', () => {
  const match = (style: string) => ({ id: 'm1', status: 'live', tournament_id: null, team_a_id: null, team_b_id: null, rules: { ...standardRules('cricket'), style, overs: 6 } });
  test('box: fine; limited overs: refused; not on a ball or out of range: refused', async () => {
    expect(await validateScoringEvent('m1', match('box'), { event_type: 'ball', payload: { team_side: 'A', runs: 0, penalty_runs: -5 } })).toBeNull();
    expect((await validateScoringEvent('m1', match('limited'), { event_type: 'ball', payload: { team_side: 'A', runs: 0, penalty_runs: -5 } }))?.body.code).toBe('BAD_PENALTY_RUNS');
    expect((await validateScoringEvent('m1', match('box'), { event_type: 'ball', payload: { team_side: 'A', runs: 0, penalty_runs: 5 } }))?.body.code).toBe('BAD_PENALTY_RUNS');
    expect((await validateScoringEvent('m1', match('box'), { event_type: 'extra', payload: { team_side: 'A', type: 'B', runs: 1, penalty_runs: -5 } }))?.body.code).toBe('BAD_PENALTY_RUNS');
  });
});
