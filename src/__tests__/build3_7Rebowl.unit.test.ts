/**
 * BUILD 3.7 · re-bowl on/off. Standard: a wide / no-ball is bowled again and
 * is no ball of the over. Off: the app marks each one `rebowl: false` and it
 * counts as a ball of the over — in the over, the bowler's balls and maidens.
 */
jest.mock('../utils/supabase', () => ({ supabase: { from: jest.fn(() => { throw new Error('no db in this test'); }) } }));
// eslint-disable-next-line import/first
import { validateScoringEvent, aggregateCricketPlayers } from '../controllers/scoring.controller';
// eslint-disable-next-line import/first
import { isBallOfOver } from '../utils/cricketRules';
// eslint-disable-next-line import/first
import { rulesRefusal, standardRules, rulesOf } from '../utils/matchRules';
// eslint-disable-next-line import/first
import { cricketBallLabels } from '../utils/editLog';

test('on or off; standard on; an older match on', () => {
  expect(standardRules('cricket').rebowl).toBe(true);
  expect(rulesRefusal('cricket', { ...standardRules('cricket'), rebowl: false })).toBeNull();
  expect(rulesRefusal('cricket', { ...standardRules('cricket'), rebowl: 'no' })?.field).toBe('rebowl');
  expect(rulesOf('cricket', { format: 'T20', overs: 20 }).rebowl).toBe(true);
});
test('a wide / no-ball not re-bowled is a ball of the over', () => {
  expect(isBallOfOver('extra', { type: 'Wd', rebowl: false })).toBe(true);
  expect(isBallOfOver('extra', { type: 'Nb', rebowl: false })).toBe(true);
  expect(isBallOfOver('extra', { type: 'Wd' })).toBe(false);
  expect(isBallOfOver('extra', { type: 'Wd', rebowl: true })).toBe(false);
});
test('the scorecard and the ball labels count it', () => {
  const ev = (id: string, payload: object) => ({ id, event_type: 'extra', payload: { team_side: 'A', batsman_id: 'bt', bowler_id: 'bw', ...payload } });
  const log = [ev('1', { type: 'Wd', runs: 1, penalty: 1, rebowl: false }), ev('2', { type: 'Nb', runs: 1, penalty: 1, rebowl: false })];
  const roll = aggregateCricketPlayers(log as never);
  expect(roll.bw).toMatchObject({ bowl_balls: 2, bowl_runs: 2 });
  expect(roll.bt).toMatchObject({ balls: 1, runs: 0 }); // a no-ball is faced, a wide isn't
  expect([...cricketBallLabels(log as never).values()]).toEqual(['ball 0.1', 'ball 0.2']);
});
describe('the server checks the event against the match', () => {
  const match = (rebowl: boolean) => ({ id: 'm1', status: 'live', tournament_id: null, team_a_id: null, team_b_id: null, rules: { ...standardRules('cricket'), rebowl } });
  const wd = (extra: object) => ({ event_type: 'extra', payload: { team_side: 'A', type: 'Wd', runs: 1, is_extra: true, ...extra } });
  test('off: marked → fine; not marked → 400; an older app → 409', async () => {
    expect(await validateScoringEvent('m1', match(false), wd({ penalty: 1, rebowl: false }))).toBeNull();
    expect((await validateScoringEvent('m1', match(false), wd({ penalty: 1 })))?.body.code).toBe('BAD_REBOWL');
    expect((await validateScoringEvent('m1', match(false), wd({})))?.body.code).toBe('EXTRA_RUNS_UPDATE_APP');
  });
  test('on: marked not re-bowled → 400; the standard and an older app fine', async () => {
    expect((await validateScoringEvent('m1', match(true), wd({ penalty: 1, rebowl: false })))?.body.code).toBe('BAD_REBOWL');
    expect(await validateScoringEvent('m1', match(true), wd({ penalty: 1 }))).toBeNull();
    expect(await validateScoringEvent('m1', match(true), wd({}))).toBeNull();
  });
});
