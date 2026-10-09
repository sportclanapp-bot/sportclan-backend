/**
 * BUILD 3.32 · basketball first to N (7–50): the game is over once a side
 * reaches it — the server refuses a basket after that.
 */
jest.mock('../utils/supabase', () => ({ supabase: { from: jest.fn(() => { throw new Error('no db in this test'); }) } }));
// eslint-disable-next-line import/first
import { validateScoringEvent } from '../controllers/scoring.controller';
// eslint-disable-next-line import/first
import { rulesRefusal, standardRules, timedRulesLabel } from '../utils/matchRules';

test('off or 1 or more (Stage 13 · CR3: no top); the label', () => {
  const r = (targetScore: unknown) => rulesRefusal('basketball', { ...standardRules('basketball'), targetScore });
  for (const ok of [null, 1, 6, 7, 21, 50, 51, 500]) expect(r(ok)).toBeNull();
  for (const bad of [0, -1, 10.5]) expect(r(bad)?.error).toBe('First to must be off, or a whole number of points.');
  expect(timedRulesLabel('basketball', { ...standardRules('basketball'), targetScore: 21 })).toBe('first to 21');
});
describe('the server', () => {
  const match = (a: number, target: number | null = 21) => ({ id: 'm', status: 'live', tournament_id: null, team_a_id: null, team_b_id: null, rules: { ...standardRules('basketball'), targetScore: target }, score_summary: { A: { score: a }, B: { score: 3 } } });
  const shot = { event_type: 'score', payload: { team_side: 'B', kind: '2pt', value: 2 } };
  test('a basket after the target → 409 TARGET_REACHED', async () => {
    expect(await validateScoringEvent('m', match(21), shot)).toEqual({ status: 409, body: { error: 'A side has reached 21 — the game is over. End the match.', code: 'TARGET_REACHED' } });
  });
  test('before it, or with no target → fine', async () => {
    expect(await validateScoringEvent('m', match(19), shot)).toBeNull();
    expect(await validateScoringEvent('m', match(60, null), shot)).toBeNull();
  });
});
