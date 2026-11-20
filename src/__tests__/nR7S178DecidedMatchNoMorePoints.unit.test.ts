/**
 * N-R7-S178 (Step 2 FINAL X2Pg, SPP1-PKB-106): pickleball rally 45dd81c6 was won 11–0 · 11–0 on phone B;
 * phone D's queued match point (tapped offline, sent after take-back + 'Send it now') was then STORED —
 * a 23rd score event, the player's points 23 for 22 real points, no refusal on D. A decided best-of match
 * now refuses a new point (409 MATCH_DECIDED, so the outbox shows the refused-action sheet); a point the
 * server already has (its key) is still a replay, and an undecided match takes points as before.
 */
let mockSlug = 'pickleball';
let mockHad: unknown = null;
const mockReads: string[] = [];
jest.mock('../utils/supabase', () => {
  const chain = (t: string): any => {
    const c: any = {};
    for (const m of ['select', 'eq', 'in', 'is', 'limit', 'order']) c[m] = jest.fn(() => c);
    c.maybeSingle = jest.fn(async () => { mockReads.push(t); return { data: mockHad, error: null }; });
    return c;
  };
  return { supabase: { from: jest.fn((t: string) => chain(t)) } };
});
jest.mock('../utils/sportCache', () => ({ ...jest.requireActual('../utils/sportCache'), getSport: jest.fn(async () => ({ slug: mockSlug })) }));
// eslint-disable-next-line import/first
import { validateScoringEvent } from '../controllers/scoring.controller';
// eslint-disable-next-line import/first
import { standardRules } from '../utils/matchRules';

const m = (sport: string, ss: object) => ({ id: 'm', status: 'live', sport_id: 's', tournament_id: null, team_a_id: null, team_b_id: null, rules: standardRules(sport), score_summary: ss });
const point = { event_type: 'score', payload: { team_side: 'A', kind: 'point' } };
const won = { A: { sets: [11, 11], score: 2, points: 0 }, B: { sets: [0, 0], score: 0, points: 0 } };

beforeEach(() => { mockSlug = 'pickleball'; mockHad = null; mockReads.length = 0; });

test('pickleball won 2–0: another phone’s late match point → 409 MATCH_DECIDED', async () => {
  const r = await validateScoringEvent('m', m('pickleball', won), point, undefined, { clientKey: 'k-late' });
  expect(r).toEqual({ status: 409, body: { error: 'The match is already decided — this point wasn’t counted. End the match.', code: 'MATCH_DECIDED' } });
});
test('the same point the server already has (its key) is not refused here (a replay)', async () => {
  mockHad = { id: 'e23' };
  expect(await validateScoringEvent('m', m('pickleball', won), point, undefined, { clientKey: 'k-had' })).toBeNull();
  expect(mockReads).toEqual(['match_events']);
});
test('a QR hand-over op on a decided match is refused too', async () => {
  const r = await validateScoringEvent('m', m('pickleball', won), point, undefined, { batch: true, clientKey: 'k-qr' });
  expect(r?.body.code).toBe('MATCH_DECIDED');
});
test('badminton, table tennis, volleyball, tennis decided → refused; one game each → points go on', async () => {
  for (const [sport, need] of [['badminton', 2], ['tabletennis', 3], ['volleyball', 3], ['tennis', 2]] as const) {
    mockSlug = sport;
    const r = await validateScoringEvent('m', m(sport, { A: { score: 0 }, B: { score: need } }), point);
    expect([sport, r?.body.code]).toEqual([sport, 'MATCH_DECIDED']);
    expect(await validateScoringEvent('m', m(sport, { A: { score: 1 }, B: { score: 1 } }), point)).toBeNull();
  }
});
test('a pickleball match not yet won (1–1 in games, 10–10) takes its point', async () => {
  expect(await validateScoringEvent('m', m('pickleball', { A: { sets: [11, 5], score: 1, points: 10 }, B: { sets: [3, 11], score: 1, points: 10 } }), point)).toBeNull();
  expect(mockReads).toEqual([]);
});
test('a timed match level at the buzzer (next point decides) still takes the point', async () => {
  expect(await validateScoringEvent('m', m('pickleball', { A: { score: 0, points: 7 }, B: { score: 0, points: 7 }, buzzer: true }), point)).toBeNull();
});
