/**
 * F141 (launch test plan, Round 2): the pad couldn't record the batter at the bowler's end being
 * run out, or a stumping / run-out off a wide or a no-ball — every wicket went on the batter
 * facing, as a fair ball. The server takes both shapes (and refuses impossible ones), and its
 * scorecard, totals and timeline put the wicket on the right batter and ball.
 */
jest.mock('../utils/supabase', () => ({ supabase: { from: jest.fn(() => { throw new Error('no db in this test'); }) } }));
jest.mock('../utils/sportCache', () => ({ getSport: jest.fn(async () => ({ slug: 'cricket' })), normSportSlug: (s: string | null | undefined) => (s ?? '').toLowerCase() }));
// eslint-disable-next-line import/first
import { validateScoringEvent, aggregatePlayers } from '../controllers/scoring.controller';
// eslint-disable-next-line import/first
import { sideTotals, outBatterOf } from '../utils/cricketRules';
// eslint-disable-next-line import/first
import { timelineLine } from '../utils/commentary';
// eslint-disable-next-line import/first
import { standardRules } from '../utils/matchRules';

const m = { id: 'm', status: 'live', tournament_id: null, team_a_id: null, team_b_id: null, sport_id: 'cricket', rules: standardRules('cricket'), score_summary: {} };
const w = (p: object) => ({ event_type: 'wicket', payload: { team_side: 'A', batsman_id: 'S', batsman_name: 'Sam', bowler_id: 'B', bowler_name: 'Bo', ...p } });
const ctx = { sport: 'cricket', teamA: 'Lions', teamB: 'Tigers', period: 1 } as never;

test('the server takes them, and refuses what can’t happen', async () => {
  const ok = async (p: object) => validateScoringEvent('m', m as never, w(p) as never);
  expect(await ok({ wicket_type: 'run_out', out_batsman_id: 'N', out_batsman_name: 'Nia', fielder_id: 'F', fielder_name: 'Fay' })).toBeNull();
  expect(await ok({ wicket_type: 'stumped', off: 'wide', is_extra: true })).toBeNull();
  expect(await ok({ wicket_type: 'run_out', off: 'no_ball', is_extra: true })).toBeNull();
  expect((await ok({ wicket_type: 'bowled', off: 'no_ball', is_extra: true }))?.body.code).toBe('BAD_WICKET');
  expect((await ok({ wicket_type: 'caught', out_batsman_id: 'N' }))?.body.code).toBe('BAD_WICKET');
  expect((await ok({ wicket_type: 'stumped', off: 'wide' }))?.body.code).toBe('BAD_WICKET'); // must use no ball of the over
});
test('a non-striker run out: Nia is out, Sam faced the ball (and keeps his runs)', () => {
  const p = aggregatePlayers('cricket', [w({ wicket_type: 'run_out', runs: 1, out_batsman_id: 'N', out_batsman_name: 'Nia', fielder_id: 'F', fielder_name: 'Fay' })] as never) as Record<string, any>;
  expect(p.N).toMatchObject({ out: true, dismissal: 'run_out', dismissal_fielder: 'Fay' });
  expect(p.S).toMatchObject({ balls: 1, runs: 1 });
  expect(p.S.out).not.toBe(true);
  expect(outBatterOf({ batsman_id: 'S', out_batsman_id: 'N' }).id).toBe('N');
});
test('stumped off a wide: 1 wide, a wicket, no ball of the over; the bowler gets it', () => {
  const evs = [
    { event_type: 'extra', payload: { team_side: 'A', type: 'Wd', runs: 1, is_extra: true, batsman_id: 'S', bowler_id: 'B', bowler_name: 'Bo' } },
    w({ wicket_type: 'stumped', off: 'wide', is_extra: true, fielder_id: 'K', fielder_name: 'Kip' }),
  ];
  expect(sideTotals(evs as never, 'A', 10)).toEqual({ runs: 1, balls: 0, wickets: 1 });
  const p = aggregatePlayers('cricket', evs as never) as Record<string, any>;
  expect(p.B).toMatchObject({ bowl_balls: 0, bowl_runs: 1, bowl_wickets: 1 });
  expect(p.S).toMatchObject({ out: true, balls: 0 });
});
test('the timeline names who is out and how', () => {
  expect(timelineLine('wicket', w({ wicket_type: 'run_out', out_batsman_id: 'N', out_batsman_name: 'Nia', fielder_name: 'Fay' }).payload, ctx).text).toMatch(/^OUT! Nia — run out \(Fay\)/);
  expect(timelineLine('wicket', w({ wicket_type: 'stumped', off: 'wide', is_extra: true, fielder_name: 'Kip' }).payload, ctx).text).toMatch(/^OUT! Sam — st Kip b Bo · off a wide/);
});
