/** Audit #51 (11 Oct 2026): a score event with no kind or value was stored — the timeline said GOAL but the score didn't count it. */
import { fakeDb } from './helpers/fakeSupabase';

let db = fakeDb();
jest.mock('../utils/supabase', () => ({ get supabase() { return db.client; } }));
// eslint-disable-next-line import/first
import { validateScoringEvent } from '../controllers/scoring.controller';

const m = (sport: string) => ({ id: 'm', status: 'live', sport_id: sport, team_a_id: null, team_b_id: null, tournament_id: null, rules: {} });
beforeEach(() => { db = fakeDb({ sports: [{ id: 'fb', slug: 'football' }, { id: 'hk', slug: 'hockey' }, { id: 'bb', slug: 'basketball' }, { id: 'bd', slug: 'badminton' }] }); });

test('football / hockey: a score with no kind (or not a goal) is refused; goals and own goals pass', async () => {
  expect((await validateScoringEvent('m', m('fb'), { event_type: 'score', payload: { team_side: 'A', points: 1 } }))?.body.code).toBe('BAD_SCORE_KIND');
  expect((await validateScoringEvent('m', m('hk'), { event_type: 'score', payload: { team_side: 'A', kind: 'point', value: 1 } }))?.body.code).toBe('BAD_SCORE_KIND');
  expect(await validateScoringEvent('m', m('fb'), { event_type: 'score', payload: { team_side: 'A', kind: 'goal', value: 1 } })).toBeNull();
  expect(await validateScoringEvent('m', m('fb'), { event_type: 'score', payload: { team_side: 'B', kind: 'own_goal', value: 1 } })).toBeNull();
});
test('basketball: a basket with no points is refused', async () => {
  expect((await validateScoringEvent('m', m('bb'), { event_type: 'score', payload: { team_side: 'A', kind: '2pt' } }))?.body.code).toBe('BAD_SCORE_KIND');
  expect(await validateScoringEvent('m', m('bb'), { event_type: 'score', payload: { team_side: 'A', kind: '2pt', value: 2 } })).toBeNull();
});
test('other sports unchanged', async () => {
  expect(await validateScoringEvent('m', m('bd'), { event_type: 'score', payload: { team_side: 'A', value: 1 } })).toBeNull();
});
