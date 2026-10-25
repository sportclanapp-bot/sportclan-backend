/**
 * N-R7-S27 (Step 2 · Batch 11 · SPP2-BAS-023 / SPP2-BAS-022): once a basketball
 * game is over the server refuses more points — but a free throw (kind 'ft')
 * slipped past the first-to check, and 3x3's overtime "first to 2" was never
 * checked at all: after Bulls won OT 2–1 a Hawks +2 made it 17–18.
 */
jest.mock('../utils/supabase', () => ({ supabase: { from: jest.fn(() => { throw new Error('no db in this test'); }) } }));
// eslint-disable-next-line import/first
import { validateScoringEvent } from '../controllers/scoring.controller';
// eslint-disable-next-line import/first
import { standardRules } from '../utils/matchRules';

const X3 = { ...standardRules('basketball'), players: 3, pointSet: '12', targetScore: 21, periods: 1, periodMinutes: 10, overtimeTo: 2, teamFoulBonus: 7, teamFoulPossessionAt: 10 };
const m = (rules: object, ss: object) => ({ id: 'm', status: 'live', tournament_id: null, team_a_id: null, team_b_id: null, rules, score_summary: ss });
const ft = { event_type: 'score', payload: { team_side: 'B', kind: 'ft', value: 1 } };
const two = { event_type: 'score', payload: { team_side: 'B', kind: '2pt', value: 2 } };

test('a free throw after the first-to target → 409 TARGET_REACHED', async () => {
  const r = await validateScoringEvent('m', m({ ...standardRules('basketball'), targetScore: 11 }, { A: { score: 12 }, B: { score: 8 } }), ft);
  expect(r?.status).toBe(409);
  expect((r?.body as { code?: string }).code).toBe('TARGET_REACHED');
});
test('3x3 overtime: a side has its 2 overtime points → the game is over', async () => {
  const r = await validateScoringEvent('m', m(X3, { A: { score: 17 }, B: { score: 16 }, periods: [{ A: 15, B: 15 }, { A: 2, B: 1 }] }), two);
  expect(r).toEqual({ status: 409, body: { error: 'A side has reached 2 in overtime — the game is over. End the match.', code: 'TARGET_REACHED' } });
});
test('3x3 overtime still open at 1–1, and regulation is not overtime', async () => {
  expect(await validateScoringEvent('m', m(X3, { A: { score: 16 }, B: { score: 16 }, periods: [{ A: 15, B: 15 }, { A: 1, B: 1 }] }), two)).toBeNull();
  expect(await validateScoringEvent('m', m(X3, { A: { score: 2 }, B: { score: 1 }, periods: [{ A: 2, B: 1 }] }), two)).toBeNull();
});
