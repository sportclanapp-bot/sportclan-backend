/**
 * Step 2 · Batch 9 · SP-CRM-098: in point carrom the queen is one piece a board. A second
 * "queen pocketed" in the same board was stored (200) though it scores nothing — the server
 * now refuses a piece that is no longer on the board (the pad hides its row already).
 */
const events: Array<{ event_type: string; payload: Record<string, unknown> }> = [];
jest.mock('../utils/supabase', () => ({ supabase: { from: jest.fn(() => { throw new Error('no db in this test'); }) } }));
jest.mock('../utils/matchEventsAll', () => ({ matchEventsAll: jest.fn(async () => events) }));
jest.mock('../utils/sportCache', () => ({ ...jest.requireActual('../utils/sportCache'), getSport: jest.fn(async () => ({ slug: 'carrom' })) }));
// eslint-disable-next-line import/first
import { validateScoringEvent } from '../controllers/scoring.controller';
// eslint-disable-next-line import/first
import { standardRules } from '../utils/matchRules';

const m = { id: 'm', status: 'live', sport_id: 's', tournament_id: null, team_a_id: null, team_b_id: null, rules: { ...standardRules('carrom'), carromMode: 'points', queenValue: 50 }, score_summary: {} };
const queen = (side: 'A' | 'B') => ({ event_type: 'score', payload: { team_side: side, kind: 'coin', coin: 'queen', value: 50 } });
const white = { event_type: 'score', payload: { team_side: 'A', kind: 'coin', coin: 'white', value: 10 } };

beforeEach(() => { events.length = 0; });
test('the first queen of the board is taken', async () => {
  expect(await validateScoringEvent('m', m, queen('B'))).toBeNull();
});
test('a second queen in the same board → 409 PIECE_GONE', async () => {
  events.push(queen('B'));
  const r = await validateScoringEvent('m', m, queen('A'));
  expect(r?.status).toBe(409);
  expect((r?.body as { code?: string }).code).toBe('PIECE_GONE');
});
test('a white while whites are left is still taken', async () => {
  events.push(queen('B'));
  expect(await validateScoringEvent('m', m, white)).toBeNull();
});
