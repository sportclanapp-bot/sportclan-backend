/**
 * Found on the device during BUILD 2.4: a knockout fixture waiting on earlier
 * results (TBD v TBD) took scoring events, so it could have a result before
 * anyone knew who played. validateScoringEvent — shared by the scoring API and
 * the QR handoff — refuses it now.
 */
jest.mock('../utils/supabase', () => ({ supabase: { from: jest.fn(() => { throw new Error('no db in this test'); }) } }));
// eslint-disable-next-line import/first
import { validateScoringEvent } from '../controllers/scoring.controller';

const ev = { event_type: 'ball', payload: { runs: 1, team_side: 'A' } };
test('a tournament fixture without both teams → 409 TEAMS_NOT_SET', async () => {
  for (const sides of [{ team_a_id: null, team_b_id: null }, { team_a_id: 'a', team_b_id: null }]) {
    const r = await validateScoringEvent('m1', { id: 'm1', status: 'scheduled', tournament_id: 't1', ...sides }, ev);
    expect(r).toEqual({ status: 409, body: { error: 'Both teams aren’t known yet — this fixture waits on earlier results.', code: 'TEAMS_NOT_SET' } });
  }
});
test('a casual match with typed-in sides is not affected', async () => {
  const r = await validateScoringEvent('m1', { id: 'm1', status: 'scheduled', tournament_id: null, team_a_id: null, team_b_id: null }, { event_type: 'nope' });
  expect(r?.body.code).toBe('UNKNOWN_EVENT_TYPE'); // it reached the normal checks
});
