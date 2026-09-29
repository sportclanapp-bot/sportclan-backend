/**
 * BUILD 3.5 · max overs per bowler: off by default, or 1 to the innings'
 * overs (the form suggests a fifth). A bowler who has bowled the quota can't
 * deliver again — validateScoringEvent (scoring API and QR handoff) refuses it.
 */
jest.mock('../utils/supabase', () => ({ supabase: { from: jest.fn(() => { throw new Error('no db in this test'); }) } }));
// eslint-disable-next-line import/first
import { validateScoringEvent } from '../controllers/scoring.controller';
// eslint-disable-next-line import/first
import { bowlerQuotaDone, suggestedBowlerOvers } from '../utils/cricketRules';
// eslint-disable-next-line import/first
import { rulesRefusal, standardRules, rulesOf } from '../utils/matchRules';

test('the limit: off, or whole 1 to the overs', () => {
  const r = (bowlerOvers: unknown, overs = 10) => rulesRefusal('cricket', { ...standardRules('cricket'), overs, bowlerOvers });
  expect(standardRules('cricket').bowlerOvers).toBeNull();
  expect(r(null)).toBeNull();
  expect(r(2)).toBeNull();
  expect(r(10)).toBeNull();
  for (const bad of [0, 11, 2.5, '2']) expect(r(bad)?.field).toBe('bowlerOvers');
  expect(r(11)?.error).toBe('Max overs per bowler must be off, or a whole number from 1 to 10.');
});
test('the suggestion is ⌈overs / 5⌉, at least 1', () => {
  expect([1, 5, 6, 8, 10, 20, 50].map(suggestedBowlerOvers)).toEqual([1, 1, 2, 2, 2, 4, 10]);
});
test('quota done at limit × 6 legal balls; never with no limit', () => {
  expect(bowlerQuotaDone(11, 2)).toBe(false);
  expect(bowlerQuotaDone(12, 2)).toBe(true);
  expect(bowlerQuotaDone(600, null)).toBe(false);
  expect(bowlerQuotaDone(undefined, 1)).toBe(false);
});
test('an older match (no rules) has no limit', () => {
  expect(rulesOf('cricket', { format: 'T20', overs: 20 }).bowlerOvers).toBeNull();
});

describe('the server refuses a delivery by a bowler who has bowled the quota', () => {
  const match = (bowlBalls: number, bowlerOvers: number | null = 2) => ({
    id: 'm1', status: 'live', tournament_id: null, team_a_id: null, team_b_id: null,
    rules: { ...standardRules('cricket'), overs: 10, bowlerOvers },
    score_summary: { players: { bw: { bowl_balls: bowlBalls } } },
  });
  const pay = (extra: object = {}) => ({ team_side: 'A', batsman_id: 'bt', bowler_id: 'bw', runs: 1, ...extra });

  test('a ball, a wide, a bye and a bowled wicket → 409 BOWLER_QUOTA_DONE', async () => {
    for (const ev of [
      { event_type: 'ball', payload: pay() },
      { event_type: 'extra', payload: pay({ type: 'Wd', is_extra: true }) },
      { event_type: 'extra', payload: pay({ type: 'B' }) },
      { event_type: 'wicket', payload: pay({ wicket_type: 'bowled' }) },
    ]) {
      const r = await validateScoringEvent('m1', match(12), ev);
      expect(r).toEqual({ status: 409, body: { error: 'This bowler has bowled their 2 overs — the most one bowler may bowl in this match.', code: 'BOWLER_QUOTA_DONE' } });
    }
  });
  test('one ball short of the quota, no limit, or a wicket off no ball → allowed', async () => {
    expect(await validateScoringEvent('m1', match(11), { event_type: 'ball', payload: pay() })).toBeNull();
    expect(await validateScoringEvent('m1', match(60, null), { event_type: 'ball', payload: pay() })).toBeNull();
    expect(await validateScoringEvent('m1', match(12), { event_type: 'wicket', payload: pay({ wicket_type: 'run_out', is_extra: true }) })).toBeNull();
    expect(await validateScoringEvent('m1', match(12), { event_type: 'ball', payload: pay({ bowler_id: 'other' }) })).toBeNull();
  });
});

test('with players a side set, the limit must let them bowl the innings', () => {
  const r = (players: number | null, bowlerOvers: number) => rulesRefusal('cricket', { ...standardRules('cricket'), overs: 8, players, bowlerOvers });
  expect(r(6, 1)?.field).toBe('bowlerOvers');
  expect(r(4, 2)).toBeNull();
  expect(r(null, 1)).toBeNull();
});
