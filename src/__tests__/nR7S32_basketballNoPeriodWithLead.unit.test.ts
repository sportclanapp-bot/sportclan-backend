/**
 * Step 2 · Batch 11 · SP-BKB-036: after Q4 with a side ahead (78–80) there is no next period —
 * the lead is the result. The app hides the button (canStartNextPeriodOf), but the server took
 * a period change (200) and opened an "OT1" for a decided game. Level, it is overtime.
 */
let recorded = 0;
const chain: any = { select: () => chain, eq: () => chain, then: (f: (x: unknown) => unknown) => Promise.resolve({ count: recorded, data: null, error: null }).then(f) };
jest.mock('../utils/supabase', () => ({ supabase: { from: jest.fn(() => chain) } }));
jest.mock('../utils/sportCache', () => ({ ...jest.requireActual('../utils/sportCache'), getSport: jest.fn(async () => ({ slug: 'basketball' })) }));
// eslint-disable-next-line import/first
import { validateScoringEvent } from '../controllers/scoring.controller';
// eslint-disable-next-line import/first
import { standardRules } from '../utils/matchRules';

const m = (rules: object, A: number, B: number, periods: number) => ({ id: 'm', status: 'live', sport_id: 's', tournament_id: null, team_a_id: null, team_b_id: null, rules,
  score_summary: { A: { score: A }, B: { score: B }, periods: Array.from({ length: periods }, () => ({ A: 0, B: 0 })) } });
const pc = { event_type: 'period_change', payload: { kind: 'quarter' } };
const R = standardRules('basketball');

test('78–80 after Q4: no next period → 409 NO_NEXT_PERIOD', async () => {
  const r = await validateScoringEvent('m', m(R, 78, 80, 4), pc);
  expect(r?.status).toBe(409);
  expect((r?.body as { code?: string }).code).toBe('NO_NEXT_PERIOD');
});
test('80–80 after Q4: overtime starts; within regulation any score moves on', async () => {
  expect(await validateScoringEvent('m', m(R, 80, 80, 4), pc)).toBeNull();
  expect(await validateScoringEvent('m', m(R, 40, 52, 2), pc)).toBeNull();
});
test('a lead after OT1 is the result too', async () => {
  expect((await validateScoringEvent('m', m(R, 90, 88, 5), pc))?.status).toBe(409);
});
test('a 1-period game at 0–0: overtime only once something was recorded (N-TC-1)', async () => {
  recorded = 0;
  expect((await validateScoringEvent('m', m({ ...R, periods: 1 }, 0, 0, 1), pc))?.status).toBe(409);
  recorded = 1;
  expect(await validateScoringEvent('m', m({ ...R, periods: 1 }, 0, 0, 1), pc)).toBeNull();
});
