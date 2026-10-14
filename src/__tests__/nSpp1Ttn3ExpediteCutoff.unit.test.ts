/**
 * N-SPP1-TTN-3 (launch test plan, Round 2): the server refused expedite once both had 9 points
 * whatever the target — at 12-12 in a game to 21 it should still come in (19-all is the cut-off).
 */
jest.mock('../utils/supabase', () => ({ supabase: { from: jest.fn(() => { throw new Error('no db in this test'); }) } }));
jest.mock('../utils/sportCache', () => ({ ...jest.requireActual('../utils/sportCache'), getSport: jest.fn(async () => ({ slug: 'tabletennis' })) }));
// eslint-disable-next-line import/first
import { validateScoringEvent } from '../controllers/scoring.controller';
// eslint-disable-next-line import/first
import { standardRules } from '../utils/matchRules';

const match = (target: number, a: number, b: number) => ({ id: 'm1', status: 'live', sport_id: 's', tournament_id: null, team_a_id: null, team_b_id: null,
  rules: { ...standardRules('tabletennis'), target }, score_summary: { A: { points: a }, B: { points: b } } });
const note = { event_type: 'note', payload: { kind: 'expedite' } };
test('to 21: at 12-12 yes; at 19-19 no', async () => {
  expect(await validateScoringEvent('m1', match(21, 12, 12) as never, note as never)).toBeNull();
  const r = await validateScoringEvent('m1', match(21, 19, 19) as never, note as never);
  expect([r?.body.code, r?.body.error]).toEqual(['EXPEDITE_TOO_LATE', 'The expedite rule can’t come in once both players have 19 points.']);
});
test('to 11: 9-all is still the cut-off', async () => {
  expect(await validateScoringEvent('m1', match(11, 8, 9) as never, note as never)).toBeNull();
  expect((await validateScoringEvent('m1', match(11, 9, 9) as never, note as never))?.body.code).toBe('EXPEDITE_TOO_LATE');
});
