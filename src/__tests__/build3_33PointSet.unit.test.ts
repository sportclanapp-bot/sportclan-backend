/** BUILD 3.33 · basketball points 1-2-3 (5v5) or 1-2 (3x3): no 3 in a 1-2 game. */
jest.mock('../utils/supabase', () => ({ supabase: { from: jest.fn(() => { throw new Error('no db in this test'); }) } }));
// eslint-disable-next-line import/first
import { validateScoringEvent } from '../controllers/scoring.controller';
// eslint-disable-next-line import/first
import { rulesRefusal, standardRules, timedRulesLabel } from '../utils/matchRules';

test('1-2-3 or 1-2; standard 1-2-3; the label', () => {
  expect(standardRules('basketball').pointSet).toBe('123');
  expect(rulesRefusal('basketball', { ...standardRules('basketball'), pointSet: '12' })).toBeNull();
  expect(rulesRefusal('basketball', { ...standardRules('basketball'), pointSet: '1234' })?.error).toBe('Points are 1-2-3 or 1-2.');
  expect(timedRulesLabel('basketball', { ...standardRules('basketball'), pointSet: '12', targetScore: 21 })).toBe('first to 21 · 1s and 2s');
});
test('the server refuses a 3 in a 3x3 game', async () => {
  const m = (pointSet: string) => ({ id: 'm', status: 'live', tournament_id: null, team_a_id: null, team_b_id: null, rules: { ...standardRules('basketball'), pointSet }, score_summary: {} });
  const shot = (value: number) => ({ event_type: 'score', payload: { team_side: 'A', kind: `${value}pt`, value } });
  expect((await validateScoringEvent('m', m('12'), shot(3)))?.body.code).toBe('BAD_POINTS');
  expect(await validateScoringEvent('m', m('12'), shot(2))).toBeNull();
  expect(await validateScoringEvent('m', m('123'), shot(3))).toBeNull();
});
