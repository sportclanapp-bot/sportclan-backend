/**
 * F144 (launch test plan, Round 2): only the app stopped a bowler bowling two overs in a row (Law
 * 17.8); the server didn't check, so an older app or a direct request could. The first delivery of an
 * over by the previous over's bowler is refused.
 */
let mockLog: unknown[] = [];
jest.mock('../utils/supabase', () => {
  const chain: any = {};
  for (const m of ['select', 'eq', 'order', 'range', 'in', 'is', 'limit', 'neq']) chain[m] = jest.fn(() => chain);
  chain.then = (ok: (v: unknown) => unknown) => Promise.resolve(ok({ data: mockLog, error: null }));
  return { supabase: { from: jest.fn(() => chain) } };
});
// eslint-disable-next-line import/first
import { validateScoringEvent } from '../controllers/scoring.controller';
// eslint-disable-next-line import/first
import { standardRules } from '../utils/matchRules';

const ball = (bowler: string) => ({ event_type: 'ball', payload: { team_side: 'A', runs: 0, batsman_id: 's', bowler_id: bowler } });
const over = (bowler: string) => Array.from({ length: 6 }, () => ball(bowler));
const match = (balls: number) => ({ id: 'm1', status: 'live', tournament_id: null, team_a_id: null, team_b_id: null, rules: { ...standardRules('cricket'), overs: 10 }, score_summary: { A: { balls } } });

test('the bowler of the last over can’t start the next', async () => {
  mockLog = over('bw1');
  const r = await validateScoringEvent('m1', match(6) as never, ball('bw1') as never);
  expect(r?.body.code).toBe('BOWLER_CONSECUTIVE');
});
test('another bowler can; and mid-over the same one carries on', async () => {
  mockLog = over('bw1');
  expect(await validateScoringEvent('m1', match(6) as never, ball('bw2') as never)).toBeNull();
  mockLog = [ball('bw1'), ball('bw1')];
  expect(await validateScoringEvent('m1', match(2) as never, ball('bw1') as never)).toBeNull();
});
test('a wide to open the over counts too; the first over has nobody before it', async () => {
  mockLog = over('bw1');
  expect((await validateScoringEvent('m1', match(6) as never, { event_type: 'extra', payload: { team_side: 'A', type: 'Wd', runs: 1, is_extra: true, bowler_id: 'bw1' } } as never))?.body.code).toBe('BOWLER_CONSECUTIVE');
  mockLog = [];
  expect(await validateScoringEvent('m1', match(0) as never, ball('bw1') as never)).toBeNull();
});
