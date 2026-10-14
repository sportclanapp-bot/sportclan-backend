/**
 * N-R2-2 (launch test plan, found while checking Round 2 on the phone): a football player sent off
 * (second yellow → red) was still offered as a goal scorer, and the server took it. Refused now for a
 * goal, an assist or coming back on (football, hockey); a card can still be shown.
 */
let mockReds: unknown[] = [];
let mockSlug = 'football';
jest.mock('../utils/supabase', () => {
  const chain: any = {};
  for (const m of ['select', 'eq', 'limit', 'order', 'range', 'in', 'is', 'neq', 'maybeSingle']) chain[m] = jest.fn(() => chain);
  chain.then = (ok: (v: unknown) => unknown) => Promise.resolve(ok({ data: mockReds, error: null }));
  return { supabase: { from: jest.fn(() => chain) } };
});
jest.mock('../utils/sportCache', () => ({ ...jest.requireActual('../utils/sportCache'), getSport: jest.fn(async () => ({ slug: mockSlug })) }));
// eslint-disable-next-line import/first
import { validateScoringEvent } from '../controllers/scoring.controller';
// eslint-disable-next-line import/first
import { standardRules } from '../utils/matchRules';

const match = () => ({ id: 'm1', status: 'live', sport_id: 's', tournament_id: null, team_a_id: null, team_b_id: null, rules: standardRules(mockSlug), score_summary: {} });
const goal = { event_type: 'score', payload: { team_side: 'A', kind: 'goal', player_id: 'guest:ravi' } };
beforeEach(() => { mockReds = []; mockSlug = 'football'; });
test('a goal by a sent-off player is refused; by anyone else it goes in', async () => {
  mockReds = [{ id: 'red1' }];
  expect((await validateScoringEvent('m1', match() as never, goal as never))?.body.code).toBe('PLAYER_SENT_OFF');
  mockReds = [];
  expect(await validateScoringEvent('m1', match() as never, goal as never)).toBeNull();
});
test('coming back on is refused too; hockey the same', async () => {
  mockReds = [{ id: 'red1' }];
  const sub = { event_type: 'sub', payload: { team_side: 'A', player_id: 'guest:ravi', off_id: 'guest:x' } };
  expect((await validateScoringEvent('m1', match() as never, sub as never))?.body.error).toBe('A player sent off can’t come back on.');
  mockSlug = 'hockey';
  expect((await validateScoringEvent('m1', match() as never, goal as never))?.body.code).toBe('PLAYER_SENT_OFF');
});
test('a card for them can still be shown', async () => {
  mockReds = [{ id: 'red1' }];
  expect(await validateScoringEvent('m1', match() as never, { event_type: 'card', payload: { team_side: 'A', kind: 'yellow', player_id: 'guest:ravi' } } as never)).toBeNull();
});
