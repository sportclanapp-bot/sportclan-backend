/** Stage 12 · CH8 · the chess arbiter's time notes and a football / hockey clock correction: checked by sport and shape. */
jest.mock('../utils/supabase', () => ({ supabase: { from: jest.fn(() => { throw new Error('no db in this test'); }) } }));
jest.mock('../utils/sportCache', () => ({
  getSport: jest.fn(async (id: string) => ({ id, slug: id })),
  normSportSlug: (s: string | null | undefined) => (s ?? '').toLowerCase(),
}));
// eslint-disable-next-line import/first
import { validateScoringEvent } from '../controllers/scoring.controller';
// eslint-disable-next-line import/first
import { standardRules } from '../utils/matchRules';

const m = (sport: string, rules: object = {}) => ({ id: 'm', status: 'live', tournament_id: null, team_a_id: null, team_b_id: null, sport_id: sport, rules: { ...standardRules(sport), ...rules }, score_summary: {} });
const note = (payload: object) => ({ event_type: 'note', payload });

test('chess: add time, an illegal move, a wrong claim', async () => {
  expect(await validateScoringEvent('m', m('chess'), note({ kind: 'add_time', side: 'B', seconds: 120 }))).toBeNull();
  expect(await validateScoringEvent('m', m('chess'), note({ kind: 'illegal_move', side: 'A', seconds: 60 }))).toBeNull();
  expect(await validateScoringEvent('m', m('chess'), note({ kind: 'wrong_claim', side: 'A', seconds: 120 }))).toBeNull();
  expect((await validateScoringEvent('m', m('chess'), note({ kind: 'add_time', side: 'C', seconds: 60 })))?.body.code).toBe('BAD_NOTE');
  expect((await validateScoringEvent('m', m('chess'), note({ kind: 'add_time', side: 'A', seconds: 1.5 })))?.body.code).toBe('BAD_NOTE');
  expect((await validateScoringEvent('m', m('tennis'), note({ kind: 'add_time', side: 'A', seconds: 60 })))?.body.code).toBe('BAD_NOTE');
});
test('a running clock corrected: football / hockey with a period length only', async () => {
  expect(await validateScoringEvent('m', m('football', { periodMinutes: 45 }), note({ kind: 'clock_adjust', seconds: -10 }))).toBeNull();
  expect(await validateScoringEvent('m', m('hockey', { periodMinutes: 15 }), note({ kind: 'clock_adjust', seconds: 60 }))).toBeNull();
  expect((await validateScoringEvent('m', m('football', { periodMinutes: null }), note({ kind: 'clock_adjust', seconds: 60 })))?.body.code).toBe('BAD_NOTE');
  expect((await validateScoringEvent('m', m('basketball'), note({ kind: 'clock_adjust', seconds: 60 })))?.body.code).toBe('BAD_NOTE');
  expect((await validateScoringEvent('m', m('football', { periodMinutes: 45 }), note({ kind: 'clock_adjust', seconds: 0 })))?.body.code).toBe('BAD_NOTE');
});
