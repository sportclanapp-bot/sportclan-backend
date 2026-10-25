/**
 * N-R7-S39 (Step 2 Batch 13, FMT-FOO-SERIES-06) · once a football / hockey / basketball series
 * is decided, another game's end is refused 'The series is decided — end the match.'
 * (SERIES_DECIDED), as cricket already was. Before: it fell through to the level-game check and
 * answered 'The game is level — penalties decide it first.' (GAME_LEVEL), which is not why.
 */
let mockSport: Record<string, unknown> = { slug: 'football' };
jest.mock('../utils/supabase', () => {
  const chain: any = {};
  for (const m of ['select', 'in', 'not', 'eq', 'neq', 'is', 'limit', 'maybeSingle', 'single', 'order', 'or', 'range', 'gte', 'gt', 'lt', 'lte']) chain[m] = jest.fn(() => chain);
  chain.then = (ok: (v: unknown) => unknown) => Promise.resolve(ok({ data: [], error: null, count: 0 }));
  return { supabase: { from: jest.fn(() => chain), rpc: jest.fn(async () => ({ data: null, error: null })) } };
});
jest.mock('../utils/sportCache', () => ({ ...jest.requireActual('../utils/sportCache'), getSport: jest.fn(async () => mockSport) }));
// eslint-disable-next-line import/first
import { validateScoringEvent } from '../controllers/scoring.controller';
// eslint-disable-next-line import/first
import { seriesSpec } from '../utils/tieCore';

const match = (slug: string, decided: 'A' | null) => ({
  id: 'm1', status: 'live', is_ranked: false, team_a_id: 'a', team_b_id: 'b', team_a_name: 'Kings', team_b_name: 'Hawks', tournament_id: null, sport_id: 's',
  rules: { v: 1, tie: seriesSpec(3) },
  score_summary: { A: { points: 0, score: 2 }, B: { points: 0, score: 0 }, tie: { series: true, win: 'first', rubbersA: decided ? 2 : 1, rubbersB: 0, ...(decided ? { decided } : {}) } },
});
const gameEnd = { event_type: 'note', payload: { kind: 'game_end', game: 3, winner: 'A' } };

describe.each(['football', 'hockey', 'basketball'])('%s series', (slug) => {
  beforeEach(() => { mockSport = { slug }; });
  test('decided 2–0: a third game end is refused as decided', async () => {
    const r = await validateScoringEvent('m1', match(slug, 'A') as never, { ...gameEnd, payload: { ...gameEnd.payload } });
    expect(r?.status).toBe(409);
    expect(r?.body).toEqual({ error: 'The series is decided — end the match.', code: 'SERIES_DECIDED' });
  });
  test('not decided: a level game is still refused as level', async () => {
    const r = await validateScoringEvent('m1', match(slug, null) as never, { ...gameEnd, payload: { ...gameEnd.payload } });
    expect(r?.body?.code).toBe('GAME_LEVEL');
  });
});
