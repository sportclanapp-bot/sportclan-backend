/**
 * N-R7-S132 (Step 2 · Batch 11 · SP-BKB-S13): 3x3's overtime is won by the first
 * side to score 2 points in it (FIBA 3x3 Art. 6.4), also from a 20–20 tie. The
 * server checked the 21 target before the overtime rule, so at 21–20 in OT1 the
 * second overtime point was refused (409 TARGET_REACHED 'A side has reached 21').
 */
jest.mock('../utils/supabase', () => ({ supabase: { from: jest.fn(() => { throw new Error('no db in this test'); }) } }));
// eslint-disable-next-line import/first
import { validateScoringEvent } from '../controllers/scoring.controller';
// eslint-disable-next-line import/first
import { standardRules } from '../utils/matchRules';

const X3 = { ...standardRules('basketball'), players: 3, pointSet: '12', targetScore: 21, periods: 1, periodMinutes: 10, overtimeTo: 2, teamFoulBonus: 7, teamFoulPossessionAt: 10 };
const m = (rules: object, ss: object) => ({ id: 'm', status: 'live', tournament_id: null, team_a_id: null, team_b_id: null, rules, score_summary: ss });
const one = (s: 'A' | 'B') => ({ event_type: 'score', payload: { team_side: s, kind: '1pt', value: 1 } });

test('3x3 OT1 at 21–20 (from 20–20): the next point is taken', async () => {
  expect(await validateScoringEvent('m', m(X3, { A: { score: 20 }, B: { score: 21 }, periods: [{ A: 20, B: 20 }, { A: 0, B: 1 }] }), one('A'))).toBeNull();
  expect(await validateScoringEvent('m', m(X3, { A: { score: 21 }, B: { score: 21 }, periods: [{ A: 20, B: 20 }, { A: 1, B: 1 }] }), one('B'))).toBeNull();
});
test('3x3 OT1 once a side has 2 in it (22–21) → over', async () => {
  const r = await validateScoringEvent('m', m(X3, { A: { score: 21 }, B: { score: 22 }, periods: [{ A: 20, B: 20 }, { A: 1, B: 2 }] }), one('A'));
  expect((r?.body as { code?: string }).code).toBe('TARGET_REACHED');
});
test('regular time: 21 still ends the 3x3 game; a 5x5 first-to without an overtime target keeps its target in overtime', async () => {
  expect((await validateScoringEvent('m', m(X3, { A: { score: 21 }, B: { score: 12 }, periods: [{ A: 21, B: 12 }] }), one('B')))?.status).toBe(409);
  const r5 = { ...standardRules('basketball'), periods: 1, targetScore: 11 };
  expect((await validateScoringEvent('m', m(r5, { A: { score: 11 }, B: { score: 10 }, periods: [{ A: 10, B: 10 }, { A: 1, B: 0 }] }), one('B')))?.status).toBe(409);
});
