/**
 * N-TC-2 (launch test plan, Round 2): during a penalty shoot-out the normal goal still went in —
 * one stray tap turned a level knockout into a win in normal time and orphaned the kicks. Once a
 * shoot-out has started (and not been backed out of), a football / hockey goal is refused.
 */
let mockNotes: unknown[] = [];
jest.mock('../utils/supabase', () => {
  const chain: any = {};
  for (const m of ['select', 'eq', 'order', 'range', 'in', 'is', 'limit']) chain[m] = jest.fn(() => chain);
  chain.then = (ok: (v: unknown) => unknown) => Promise.resolve(ok({ data: mockNotes, error: null }));
  return { supabase: { from: jest.fn(() => chain) } };
});
jest.mock('../utils/sportCache', () => ({ getSport: jest.fn(async (id: string) => ({ id, slug: id })), normSportSlug: (s: string | null | undefined) => (s ?? '').toLowerCase() }));
// eslint-disable-next-line import/first
import { validateScoringEvent } from '../controllers/scoring.controller';
// eslint-disable-next-line import/first
import { standardRules } from '../utils/matchRules';

const m = (sport: string) => ({ id: 'm', status: 'live', tournament_id: null, team_a_id: null, team_b_id: null, sport_id: sport, rules: standardRules(sport), score_summary: { A: { score: 1 }, B: { score: 1 } } });
const goal = { event_type: 'score', payload: { team_side: 'B', value: 1, kind: 'goal' } };
const note = (kind: string) => ({ event_type: 'note', payload: { kind } });

it.each(['football', 'hockey'])('%s: a goal during the shoot-out is refused', async (sport) => {
  mockNotes = [note('shootout_start'), { event_type: 'note', payload: { kind: 'shootout_kick', team_side: 'A', scored: true } }];
  expect((await validateScoringEvent('m', m(sport) as never, goal as never))?.body.code).toBe('IN_SHOOTOUT');
});
test('before it, or once it was backed out of, a goal is fine', async () => {
  mockNotes = [];
  expect(await validateScoringEvent('m', m('football') as never, goal as never)).toBeNull();
  mockNotes = [note('shootout_start'), note('shootout_cancel')];
  expect(await validateScoringEvent('m', m('football') as never, goal as never)).toBeNull();
});
test('a series game after a shoot-out decided the last one is a new game', async () => {
  mockNotes = [note('shootout_start'), { event_type: 'note', payload: { kind: 'game_end', game: 1, winner: 'A' } }];
  expect(await validateScoringEvent('m', m('football') as never, goal as never)).toBeNull();
});
