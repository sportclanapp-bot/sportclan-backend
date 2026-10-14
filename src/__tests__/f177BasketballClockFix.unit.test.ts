/**
 * F177 (launch test plan, Round 2): basketball's countdown has a '± Clock' sheet, but the server
 * refused every correction for basketball, and its timeline line read the stored number (time
 * played) as if it were time left. Basketball is accepted, and its line says the time left.
 */
jest.mock('../utils/supabase', () => ({ supabase: { from: jest.fn(() => { throw new Error('no db in this test'); }) } }));
jest.mock('../utils/sportCache', () => ({
  getSport: jest.fn(async (id: string) => ({ id, slug: id })),
  normSportSlug: (s: string | null | undefined) => (s ?? '').toLowerCase(),
}));
// eslint-disable-next-line import/first
import { validateScoringEvent } from '../controllers/scoring.controller';
// eslint-disable-next-line import/first
import { standardRules } from '../utils/matchRules';
// eslint-disable-next-line import/first
import { sportCommentary } from '../utils/commentary';

const m = (sport: string, rules: object = {}) => ({ id: 'm', status: 'live', tournament_id: null, team_a_id: null, team_b_id: null, sport_id: sport, rules: { ...standardRules(sport), ...rules }, score_summary: {} });
const note = (payload: object) => ({ event_type: 'note', payload });
const ctx = (sport: string) => ({ sport, teamA: 'Lions', teamB: 'Tigers', period: 1 } as never);

test('basketball’s countdown can be corrected (its default length too)', async () => {
  expect(await validateScoringEvent('m', m('basketball'), note({ kind: 'clock_adjust', seconds: -10 }))).toBeNull();
  expect(await validateScoringEvent('m', m('basketball', { periodMinutes: 12 }), note({ kind: 'clock_adjust', seconds: 60 }))).toBeNull();
  expect((await validateScoringEvent('m', m('basketball'), note({ kind: 'clock_adjust', seconds: 0 })))?.body.code).toBe('BAD_NOTE');
});
test('the timeline says it the way the clock shows: basketball in time left', () => {
  expect(sportCommentary('note', { kind: 'clock_adjust', seconds: -10 }, ctx('basketball'))).toBe('⏱ Clock corrected +10 s left');
  expect(sportCommentary('note', { kind: 'clock_adjust', seconds: 60 }, ctx('basketball'))).toBe('⏱ Clock corrected −1 min left');
  expect(sportCommentary('note', { kind: 'clock_adjust', seconds: -10 }, ctx('hockey'))).toBe('⏱ Clock corrected −10 s');
});
