/**
 * N-R7-S176 (Step 2 FINAL, REG-014): a match on a deactivated sport (kabaddi, is_active false) took a typed
 * result through POST /matches/:id/complete (Match detail's 'Enter the score' → saved 100-90), though live
 * scoring and /typed-score refuse it with 400 SPORT_INACTIVE. /complete and /decide now refuse it the same way
 * and write nothing; an active sport is unchanged.
 */
import { fakeDb } from './helpers/fakeSupabase';

const ME = 'me'; const M = 'aaaaaaaa-aaaa-4aaa-8aaa-000000000176';
let db = fakeDb({});
let inactive = true;
jest.mock('../utils/supabase', () => ({ get supabase() { return db.client; } }));
jest.mock('../utils/sports', () => ({ ...jest.requireActual('../utils/sports'), isSportInactive: jest.fn(async () => inactive) }));
jest.mock('../utils/tournamentAuth', () => ({ ...jest.requireActual('../utils/tournamentAuth'), canOfficiateMatch: jest.fn(async () => true), isTournamentOrganiser: jest.fn(async () => true) }));
jest.mock('../utils/scoringLease', () => ({ ...jest.requireActual('../utils/scoringLease'), checkLease: jest.fn(async () => ({ ok: true })) }));
jest.mock('../utils/sportCache', () => ({ ...jest.requireActual('../utils/sportCache'), getSport: jest.fn(async () => ({ slug: 'kabaddi', is_active: inactive ? false : true })) }));
jest.mock('../utils/knockout', () => ({ ...jest.requireActual('../utils/knockout'), isKnockoutBracketMatch: jest.fn(async () => false) }));
jest.mock('../utils/notify', () => ({ ...jest.requireActual('../utils/notify'), notifyUsers: jest.fn(async () => undefined), notifyUser: jest.fn(async () => undefined), matchAudienceIds: jest.fn(async () => []) }));
// eslint-disable-next-line import/first
import { completeMatch } from '../controllers/matches.controller';
// eslint-disable-next-line import/first
import { decideMatch } from '../controllers/matchDecision.controller';

const row = (status: string) => ({ id: M, sport_id: 's-kab', status, created_by: ME, umpire_id: null, scorer_id: null, tournament_id: null, team_a_id: null, team_b_id: null, team_a_name: 'Raiders', team_b_name: 'Bulls', is_ranked: false, round: null, group_label: null, next_match_id: null, score_summary: {}, toss_choice: null, format: null, overs: null, rules: {}, voided_at: null, winner_team_id: null });
const call = async (fn: (q: any, r: any) => Promise<unknown>, body: object) => {
  const r: any = { statusCode: 200, body: null };
  r.status = jest.fn((c: number) => { r.statusCode = c; return r; });
  r.json = jest.fn((b: unknown) => { r.body = b; return r; });
  await fn({ userId: ME, params: { id: M }, body, query: {}, headers: {}, get: () => undefined, header: () => undefined } as any, r);
  return r;
};

beforeEach(() => { inactive = true; });

test('/complete refuses a typed result on a deactivated sport, and writes nothing', async () => {
  db = fakeDb({ matches: [row('scheduled')], match_events: [], match_participants: [] });
  const r = await call(completeMatch, { winner_side: 'A', score_summary: { A: { score: 100 }, B: { score: 90 }, team_a_score: 100, team_b_score: 90 } });
  expect(r.statusCode).toBe(400);
  expect(r.body.code).toBe('SPORT_INACTIVE');
  expect(db.t('matches')[0]!.status).toBe('scheduled');
  expect(db.t('matches')[0]!.score_summary).toEqual({});
});
test('/complete refuses a walkover on a deactivated sport too', async () => {
  db = fakeDb({ matches: [row('scheduled')], match_events: [], match_participants: [] });
  const r = await call(completeMatch, { winner_side: 'A', walkover: true, walkover_reason: 'no show' });
  expect(r.body.code).toBe('SPORT_INACTIVE');
  expect(db.t('matches')[0]!.status).toBe('scheduled');
});
test('/decide (stands / awarded) refuses a deactivated sport, and writes nothing', async () => {
  db = fakeDb({ matches: [row('abandoned')], match_events: [] });
  for (const body of [{ decision: 'awarded', reason: 'No show', winner_side: 'A' }, { decision: 'stands', reason: 'Rain' }, { decision: 'replay', reason: 'Rain' }]) {
    const r = await call(decideMatch, body);
    expect(r.statusCode).toBe(400);
    expect(r.body.code).toBe('SPORT_INACTIVE');
  }
  expect(db.t('matches')[0]!.status).toBe('abandoned');
});
test('an active sport is not refused by this check', async () => {
  inactive = false;
  db = fakeDb({ matches: [row('abandoned')], match_events: [] });
  // Q29: kabaddi has no official forfeit score, so the award carries a typed one.
  const r = await call(decideMatch, { decision: 'awarded', reason: 'No show', winner_side: 'A', score: { A: 1, B: 0 } });
  expect([r.statusCode, r.body?.code]).toEqual([200, undefined]);
  expect(db.t('matches')[0]!.status).toBe('completed');
});
