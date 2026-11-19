/**
 * N-R7-S175 (Step 2 FINAL, SIDE-C26x-1) · a best-of-3 football fixture with only game 1 scored (no
 * game 1 end yet) took a note game_end { game: 3, winner: 'A' } by the API (200): only a decided
 * series refused. Now a series game's end names the game in play (games ended + 1) and an event
 * tagged with a game can't name a later one (NOT_GAME_IN_PLAY), in every sport with a series; the
 * pad's own sends (an untagged END GAME, cricket's game: n end and its game-tagged balls) still go.
 */
let mockSport: Record<string, unknown> = { slug: 'football' };
let mockNotes: Array<{ event_type: string; payload: Record<string, unknown> }> = [];
jest.mock('../utils/supabase', () => {
  const chain: any = {};
  for (const m of ['select', 'in', 'not', 'eq', 'neq', 'is', 'limit', 'maybeSingle', 'single', 'order', 'or', 'range', 'gte', 'gt', 'lt', 'lte']) chain[m] = jest.fn(() => chain);
  chain.then = (ok: (v: unknown) => unknown) => Promise.resolve(ok({ data: [], error: null, count: 0 }));
  return { supabase: { from: jest.fn(() => chain), rpc: jest.fn(async () => ({ data: null, error: null })) } };
});
jest.mock('../utils/sportCache', () => ({ ...jest.requireActual('../utils/sportCache'), getSport: jest.fn(async () => mockSport) }));
jest.mock('../utils/matchEventsAll', () => ({ matchEventsAll: jest.fn(async () => mockNotes) }));
// eslint-disable-next-line import/first
import { validateScoringEvent } from '../controllers/scoring.controller';
// eslint-disable-next-line import/first
import { seriesSpec } from '../utils/tieCore';

const match = (rubbersA: number) => ({
  id: 'm1', status: 'live', is_ranked: false, team_a_id: 'a', team_b_id: 'b', team_a_name: 'Kings', team_b_name: 'Hawks', tournament_id: null, sport_id: 's',
  rules: { v: 1, tie: seriesSpec(3) },
  score_summary: { A: { points: 1, score: 1, runs: 0, balls: 0, wickets: 0 }, B: { points: 0, score: 0, runs: 0, balls: 0, wickets: 0 }, tie: { series: true, win: 'first', rubbersA, rubbersB: 0 } },
});
const end = (game?: number) => ({ event_type: 'note', payload: { kind: 'game_end', ...(game != null ? { game } : {}), winner: 'A' } });
const ended = (n: number) => Array.from({ length: n }, (_, i) => ({ event_type: 'note', payload: { kind: 'game_end', game: i + 1, winner: 'A' } }));

describe.each(['football', 'hockey', 'basketball', 'cricket'])('%s best-of-3 series', (slug) => {
  beforeEach(() => { mockSport = { slug }; mockNotes = []; });
  test('game 1 in play: a game 3 end is refused (out of order)', async () => {
    const r = await validateScoringEvent('m1', match(0) as never, end(3));
    expect(r?.status).toBe(409);
    expect(r?.body?.code).toBe('NOT_GAME_IN_PLAY');
    expect(r?.body?.error).toBe('Game 1 is the game in play — end it first.');
  });
  test('game 2 in play: a game 1 end again, or a game 3 end, is refused; game 2 is not', async () => {
    mockNotes = ended(1);
    expect((await validateScoringEvent('m1', match(1) as never, end(1)))?.body?.code).toBe('NOT_GAME_IN_PLAY');
    expect((await validateScoringEvent('m1', match(1) as never, end(3)))?.body?.code).toBe('NOT_GAME_IN_PLAY');
    expect((await validateScoringEvent('m1', match(1) as never, end(2)))?.body?.code).not.toBe('NOT_GAME_IN_PLAY');
  });
  test('the pad\'s own end (game in play, or untagged) is not refused for its game', async () => {
    expect((await validateScoringEvent('m1', match(0) as never, end(1)))?.body?.code).not.toBe('NOT_GAME_IN_PLAY');
    expect((await validateScoringEvent('m1', match(0) as never, end()))?.body?.code).not.toBe('NOT_GAME_IN_PLAY');
  });
  test('an event tagged with a later game is refused; the game in play or an earlier one is not', async () => {
    mockNotes = ended(1);
    const note = (game: unknown) => ({ event_type: 'note', payload: { kind: 'comment', text: 'x', game } });
    const r = await validateScoringEvent('m1', match(1) as never, note(3));
    expect(r?.body).toEqual({ error: 'Game 3 hasn’t started — game 2 is in play.', code: 'NOT_GAME_IN_PLAY' });
    expect((await validateScoringEvent('m1', match(1) as never, note(4)))?.body?.code).toBe('NOT_GAME_IN_PLAY');
    expect((await validateScoringEvent('m1', match(1) as never, note(2)))?.body?.code).not.toBe('NOT_GAME_IN_PLAY');
    expect((await validateScoringEvent('m1', match(1) as never, note(1)))?.body?.code).not.toBe('NOT_GAME_IN_PLAY');
    expect((await validateScoringEvent('m1', match(1) as never, note('two')))?.body?.code).toBe('BAD_GAME');
  });
});

test('cricket: every game played (a drawn series) takes no further game end', async () => {
  mockSport = { slug: 'cricket' }; mockNotes = ended(3);
  const r = await validateScoringEvent('m1', match(1) as never, end(4));
  expect(r?.body).toEqual({ error: 'Every game of the series is played — end the match.', code: 'NOT_GAME_IN_PLAY' });
});

test('not a series: a game number is left alone', async () => {
  mockSport = { slug: 'football' }; mockNotes = [];
  const m = { ...match(0), rules: { v: 1 } };
  const r = await validateScoringEvent('m1', m as never, { event_type: 'note', payload: { kind: 'comment', text: 'x', game: 3 } });
  expect(r?.body?.code).not.toBe('NOT_GAME_IN_PLAY');
});
