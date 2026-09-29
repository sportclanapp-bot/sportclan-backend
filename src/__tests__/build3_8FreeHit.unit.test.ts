/**
 * BUILD 3.8 · free hit: where the match plays them, the delivery after a
 * no-ball is a free hit — the batter is out only as off a no-ball. A wide
 * bowled again carries it on; the free hit ball itself uses it up.
 */
let mockLog: unknown[] = [];
jest.mock('../utils/supabase', () => ({
  supabase: {
    from: jest.fn(() => {
      const q: any = { select: () => q, eq: () => q, order: async () => ({ data: mockLog }) };
      return q;
    }),
  },
}));
// eslint-disable-next-line import/first
import { validateScoringEvent } from '../controllers/scoring.controller';
// eslint-disable-next-line import/first
import { allowedOnFreeHit, freeHitNext } from '../utils/cricketRules';
// eslint-disable-next-line import/first
import { rulesRefusal, standardRules } from '../utils/matchRules';

const ev = (event_type: string, payload: object = {}) => ({ event_type, payload: { team_side: 'A', ...payload } });
const nb = ev('extra', { type: 'Nb', runs: 1, is_extra: true });

test('off by default; on or off', () => {
  expect(standardRules('cricket').freeHit).toBe(false);
  expect(rulesRefusal('cricket', { ...standardRules('cricket'), freeHit: true })).toBeNull();
  expect(rulesRefusal('cricket', { ...standardRules('cricket'), freeHit: 1 })?.field).toBe('freeHit');
});
test('when the next ball is a free hit', () => {
  expect(freeHitNext([], 'A')).toBe(false);
  expect(freeHitNext([nb], 'A')).toBe(true);
  expect(freeHitNext([nb], 'B')).toBe(false); // the other innings
  expect(freeHitNext([nb, ev('extra', { type: 'Wd', runs: 1, is_extra: true })], 'A')).toBe(true); // carried on
  expect(freeHitNext([nb, nb], 'A')).toBe(true);
  expect(freeHitNext([nb, ev('ball', { runs: 4 })], 'A')).toBe(false); // used
  expect(freeHitNext([nb, ev('extra', { type: 'B', runs: 1 })], 'A')).toBe(false);
  expect(freeHitNext([nb, ev('wicket', { wicket_type: 'retired_hurt', is_extra: true })], 'A')).toBe(true); // no delivery
  expect(freeHitNext([nb, ev('extra', { type: 'Wd', runs: 1, rebowl: false })], 'A')).toBe(false); // a wide that counts is the ball
});
test('the ways out off a free hit', () => {
  expect(['run_out', 'obstructing_the_field', 'hit_the_ball_twice', 'retired_hurt', 'retired_out', 'retired_not_out'].every(allowedOnFreeHit)).toBe(true);
  expect(['bowled', 'caught', 'lbw', 'stumped', 'hit_wicket'].some(allowedOnFreeHit)).toBe(false);
});
describe('the server refuses a wicket a free hit rules out', () => {
  const match = (freeHit: boolean) => ({ id: 'm1', status: 'live', tournament_id: null, team_a_id: null, team_b_id: null, rules: { ...standardRules('cricket'), freeHit } });
  const wk = (wicket_type: string) => ev('wicket', { wicket_type });
  test('bowled off a free hit → 400 FREE_HIT; run out fine', async () => {
    mockLog = [nb];
    expect((await validateScoringEvent('m1', match(true), wk('bowled')))?.body.code).toBe('FREE_HIT');
    expect(await validateScoringEvent('m1', match(true), wk('run_out'))).toBeNull();
  });
  test('not a free hit, or a match without them → fine', async () => {
    mockLog = [nb, ev('ball', { runs: 0 })];
    expect(await validateScoringEvent('m1', match(true), wk('bowled'))).toBeNull();
    mockLog = [nb];
    expect(await validateScoringEvent('m1', match(false), wk('bowled'))).toBeNull();
  });
});
