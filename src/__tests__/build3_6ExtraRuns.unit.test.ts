/**
 * BUILD 3.6 · a wide / no-ball worth 0, 1 or 2. The app stores the match's
 * value on each wide / no-ball (`penalty`); every reader takes the runs on top
 * of it from the event itself, and an event from before carried 1.
 */
jest.mock('../utils/supabase', () => ({ supabase: { from: jest.fn(() => { throw new Error('no db in this test'); }) } }));
// eslint-disable-next-line import/first
import { validateScoringEvent, aggregateCricketPlayers } from '../controllers/scoring.controller';
// eslint-disable-next-line import/first
import { extraPenaltyOf, isBallOfOver } from '../utils/cricketRules';
// eslint-disable-next-line import/first
import { rulesRefusal, standardRules, rulesOf } from '../utils/matchRules';
// eslint-disable-next-line import/first
import { describeEvent } from '../utils/editLog';

test('the value: 0, 1 or 2; standard 1; an older match 1', () => {
  const r = (extraRuns: unknown) => rulesRefusal('cricket', { ...standardRules('cricket'), extraRuns });
  expect(standardRules('cricket').extraRuns).toBe(1);
  for (const ok of [0, 1, 2]) expect(r(ok)).toBeNull();
  for (const bad of [3, -1, 1.5, '2', null]) expect(r(bad)?.field).toBe('extraRuns');
  expect(rulesOf('cricket', { format: 'T20', overs: 20 }).extraRuns).toBe(1);
});
test('an event’s penalty is its own; none means 1', () => {
  expect([extraPenaltyOf({}), extraPenaltyOf({ penalty: 0 }), extraPenaltyOf({ penalty: 2 }), extraPenaltyOf({ penalty: 5 }), extraPenaltyOf(null)]).toEqual([1, 0, 2, 1, 1]);
  expect(isBallOfOver('extra', { type: 'Wd' })).toBe(false);
  expect(isBallOfOver('extra', { type: 'B' })).toBe(true);
  expect(isBallOfOver('wicket', { is_extra: true })).toBe(false);
});

describe('the server checks a wide / no-ball against the match', () => {
  const match = (extraRuns: number) => ({ id: 'm1', status: 'live', tournament_id: null, team_a_id: null, team_b_id: null, rules: { ...standardRules('cricket'), extraRuns } });
  const wd = (extra: object) => ({ event_type: 'extra', payload: { team_side: 'A', type: 'Wd', is_extra: true, ...extra } });
  test('worth 2: the penalty must say 2 and the runs at least 2; a no-ball six is 8', async () => {
    expect(await validateScoringEvent('m1', match(2), wd({ runs: 2, penalty: 2 }))).toBeNull();
    expect(await validateScoringEvent('m1', match(2), { event_type: 'extra', payload: { team_side: 'A', type: 'Nb', is_extra: true, runs: 8, penalty: 2 } })).toBeNull();
    expect((await validateScoringEvent('m1', match(2), wd({ runs: 2, penalty: 1 })))?.body.code).toBe('BAD_PENALTY');
    expect((await validateScoringEvent('m1', match(2), wd({ runs: 1, penalty: 2 })))?.body.code).toBe('BAD_PENALTY');
    expect((await validateScoringEvent('m1', match(2), wd({ runs: 9, penalty: 2 })))?.status).toBe(400);
  });
  test('an older app (no penalty) is asked to update where a wide isn’t worth 1', async () => {
    expect(await validateScoringEvent('m1', match(0), wd({ runs: 1 }))).toEqual({
      status: 409,
      body: { error: 'This match counts a wide or no-ball as 0 runs. Update SportClan to score it.', code: 'EXTRA_RUNS_UPDATE_APP' },
    });
    expect(await validateScoringEvent('m1', match(1), wd({ runs: 1 }))).toBeNull(); // unchanged for the standard
    expect((await validateScoringEvent('m1', match(1), wd({ runs: 8 })))?.status).toBe(400); // cap unchanged too
  });
  test('byes are not checked against it', async () => {
    expect(await validateScoringEvent('m1', match(2), { event_type: 'extra', payload: { team_side: 'A', type: 'B', runs: 1, is_extra: true } })).toBeNull();
  });
});

test('the scorecard takes the runs on top of each event’s own penalty', () => {
  const ev = (payload: object) => ({ event_type: 'extra', payload: { team_side: 'A', batsman_id: 'bt', bowler_id: 'bw', ...payload } });
  const roll = aggregateCricketPlayers([
    ev({ type: 'Nb', runs: 6, penalty: 2 }), // 2 + 4 off the bat
    ev({ type: 'Nb', runs: 3 }), // older: 1 + 2
    ev({ type: 'Nb', runs: 4, penalty: 0 }), // 0 + 4
    ev({ type: 'Wd', runs: 0, penalty: 0 }),
  ] as never);
  expect(roll.bt).toMatchObject({ runs: 10, balls: 3, fours: 2 });
  expect(roll.bw).toMatchObject({ bowl_runs: 13, bowl_balls: 0 });
});
const CTX = { sport: 'cricket', teamA: 'A', teamB: 'B' } as never;
test('the edit log says what came on top', () => {
  expect(describeEvent('extra', { type: 'Wd', runs: 3, penalty: 2 }, CTX)).toBe('wide + 1');
  expect(describeEvent('extra', { type: 'Wd', runs: 2, penalty: 2 }, CTX)).toBe('wide');
  expect(describeEvent('extra', { type: 'Nb', runs: 3 }, CTX)).toBe('no-ball + 2');
});
