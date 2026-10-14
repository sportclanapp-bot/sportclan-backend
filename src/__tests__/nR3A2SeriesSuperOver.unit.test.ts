/**
 * N-R3A-2 (launch test plan, Round 2): a tied game of a cricket series settled by typing each side's
 * super-over runs kept only who won — the series record showed 6/0 v 6/0 'won' with no reason. The
 * game-end note now carries the runs; the server checks them, keeps them on the game's row and says
 * them on the timeline.
 */
let mockLog: unknown[] = [];
let mockSlug = 'cricket';
jest.mock('../utils/supabase', () => {
  const chain: any = {};
  for (const m of ['select', 'eq', 'order', 'range', 'in', 'is', 'limit', 'neq']) chain[m] = jest.fn(() => chain);
  chain.then = (ok: (v: unknown) => unknown) => Promise.resolve(ok({ data: mockLog, error: null }));
  return { supabase: { from: jest.fn(() => chain) } };
});
jest.mock('../utils/sportCache', () => ({ ...jest.requireActual('../utils/sportCache'), getSport: jest.fn(async () => ({ slug: mockSlug })) }));
// eslint-disable-next-line import/first
import { validateScoringEvent, superOverOfGame } from '../controllers/scoring.controller';
// eslint-disable-next-line import/first
import { cricketSeries } from '../utils/cricketRules';
// eslint-disable-next-line import/first
import { timelineLine, type CommentaryContext } from '../utils/commentary';
// eslint-disable-next-line import/first
import { standardRules } from '../utils/matchRules';
// eslint-disable-next-line import/first
import { seriesSpec } from '../utils/tieCore';

const match = { id: 'm1', status: 'live', sport_id: 's', tournament_id: null, team_a_id: null, team_b_id: null, rules: { ...standardRules('cricket'), overs: 1, tie: seriesSpec(5) }, score_summary: {} };
const note = (payload: object) => ({ event_type: 'note', payload: { kind: 'game_end', game: 3, ...payload } });

test('the server takes a typed super over, and refuses a level or contradicting one', async () => {
  expect(await validateScoringEvent('m1', match as never, note({ winner: 'A', super_over_runs: { A: 5, B: 3 } }) as never)).toBeNull();
  expect((await validateScoringEvent('m1', match as never, note({ winner: 'A', super_over_runs: { A: 4, B: 4 } }) as never))?.body.code).toBe('BAD_NOTE');
  expect((await validateScoringEvent('m1', match as never, note({ winner: 'B', super_over_runs: { A: 5, B: 3 } }) as never))?.body.code).toBe('BAD_NOTE');
});
test('the series keeps the runs, and the game row has them', () => {
  const s = cricketSeries([note({ game: 1, winner: 'A', super_over_runs: { A: 5, B: 3 } })] as never, 5);
  expect(s.ends[0]).toEqual({ game: 1, winner: 'A', nextFirst: null, superOver: { A: 5, B: 3 } });
  expect(superOverOfGame(s.ends[0]!.superOver, [], 'A')).toEqual({ super_over: { A: 5, B: 3 } });
  expect(superOverOfGame(undefined, [], 'A')).toEqual({});
});
test('a super over played ball by ball in the game is the row’s too', () => {
  const so = (side: 'A' | 'B', runs: number) => Array.from({ length: 6 }, (_, i) => ({ event_type: 'ball', payload: { team_side: side, runs: i === 0 ? runs : 0, super_over: 1, game: 3 } }));
  // A batted first in the game, so B bats first in its super over.
  expect(superOverOfGame(undefined, [...so('B', 7), ...so('A', 9)], 'A')).toEqual({ super_over: { A: 9, B: 7 } });
});
test('the timeline says how the game was won', () => {
  const ctx: CommentaryContext = { sport: 'cricket', teamA: 'Lions', teamB: 'Tigers', period: 1, move: 3, clockSeconds: 75, regulation: null, periodMinutes: null };
  expect(timelineLine('note', { kind: 'game_end', game: 3, winner: 'A', next_first: 'B', super_over_runs: { A: 5, B: 3 } }, ctx).text)
    .toBe('🏁 End of game 3 — Lions won it on the super over (5–3) · Tigers bat first in game 4');
});
