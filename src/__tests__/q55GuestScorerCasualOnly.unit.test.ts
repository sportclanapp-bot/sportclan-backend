/**
 * Q55 (Dipak, 21 Nov 2026), N-R7-S52: a football casual match between
 * registered teams may credit a goal to a typed-in stand-in ("Add a player…",
 * a guest:<id>). A tournament match keeps the registered team's players only:
 * the server refuses a typed-in name there.
 */
let mockNotes: unknown[] = [];
jest.mock('../utils/supabase', () => {
  const chain: any = {};
  for (const m of ['select', 'eq', 'order', 'range', 'in', 'is', 'limit', 'maybeSingle']) chain[m] = jest.fn(() => chain);
  chain.then = (ok: (v: unknown) => unknown) => Promise.resolve(ok({ data: mockNotes, error: null }));
  return { supabase: { from: jest.fn(() => chain) } };
});
jest.mock('../utils/sportCache', () => ({ getSport: jest.fn(async (id: string) => ({ id, slug: id })), normSportSlug: (s: string | null | undefined) => (s ?? '').toLowerCase() }));
// eslint-disable-next-line import/first
import { validateScoringEvent } from '../controllers/scoring.controller';
// eslint-disable-next-line import/first
import { standardRules } from '../utils/matchRules';

const m = (extra: object) => ({ id: 'm', status: 'live', tournament_id: null, team_a_id: 'lions', team_b_id: 'tigers', sport_id: 'football', rules: standardRules('football'), score_summary: { A: { score: 0 }, B: { score: 0 } }, ...extra });
const guestGoal = { event_type: 'score', payload: { team_side: 'A', value: 1, kind: 'goal', player_id: 'guest:imran-1', player_name: 'Imran' } };
beforeEach(() => { mockNotes = []; });

test('casual match between registered teams: a typed-in scorer is fine', async () => {
  expect(await validateScoringEvent('m', m({}) as never, guestGoal as never)).toBeNull();
});
test('tournament match, registered side: refused', async () => {
  const r = await validateScoringEvent('m', m({ tournament_id: 't1' }) as never, guestGoal as never);
  expect([r?.status, r?.body.code]).toEqual([400, 'GUEST_IN_TOURNAMENT']);
});
test('ranked: refused as before', async () => {
  expect((await validateScoringEvent('m', m({ is_ranked: true }) as never, guestGoal as never))?.status).toBe(400);
});
