/**
 * Step 2 · Batch 10 · SPP2-VOL-094: a handed-over scorer's team default was refused at
 * /complete (403 NOT_REFEREE), but the "default" misconduct note itself was stored (200),
 * so the match's misconduct record showed a default that never happened. A ladder step that
 * ends the match is now the referee's / organiser's on the note too.
 */
let mayDefault = false;
jest.mock('../utils/supabase', () => ({ supabase: { from: jest.fn(() => { throw new Error('no db in this test'); }) } }));
jest.mock('../utils/sportCache', () => ({ ...jest.requireActual('../utils/sportCache'), getSport: jest.fn(async () => ({ slug: 'volleyball' })) }));
jest.mock('../utils/tournamentAuth', () => ({ ...jest.requireActual('../utils/tournamentAuth'), canDefault: jest.fn(async () => mayDefault) }));
// eslint-disable-next-line import/first
import { validateScoringEvent } from '../controllers/scoring.controller';
// eslint-disable-next-line import/first
import { standardRules } from '../utils/matchRules';

const m = { id: 'm', status: 'live', sport_id: 's', tournament_id: null, team_a_id: null, team_b_id: null, rules: standardRules('volleyball'), score_summary: {} };
const note = (penalty: string) => ({ event_type: 'note', payload: { kind: 'violation', team_side: 'A', offence: 'conduct', penalty, n: 1 } });

test('a scorer who may not default: the default note → 403 NOT_REFEREE', async () => {
  mayDefault = false;
  const r = await validateScoringEvent('m', m, note('default'), 'scorer');
  expect(r).toEqual({ status: 403, body: { error: 'Only the referee, the umpire or the organiser can default a player.', code: 'NOT_REFEREE' } });
});
test('a warning or penalty note stays open to the scorer', async () => {
  mayDefault = false;
  expect(await validateScoringEvent('m', m, note('warning'), 'scorer')).toBeNull();
  expect(await validateScoringEvent('m', m, note('point'), 'scorer')).toBeNull();
});
test('the creator / referee records the default note', async () => {
  mayDefault = true;
  expect(await validateScoringEvent('m', m, note('default'), 'creator')).toBeNull();
});
