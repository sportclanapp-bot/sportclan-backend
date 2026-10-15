/**
 * F077 (launch test plan, Round 4) · once one player had rated a finished match,
 * everyone else who played saw only the average: the app hid the stars whenever the
 * match had an average, because the match page never said whether THIS viewer had
 * rated. getMatch now sends my_rating (the viewer's own stars, or null).
 */
import { fakeDb } from './helpers/fakeSupabase';

let db = fakeDb();
jest.mock('../utils/supabase', () => ({ get supabase() { return db.client; } }));
jest.mock('../utils/liveStatus', () => ({ getMatchLiveStatus: jest.fn(async () => null) }));
jest.mock('../utils/scoringLease', () => ({ ...jest.requireActual('../utils/scoringLease'), getLease: jest.fn(async () => null) }));
jest.mock('../utils/tournamentAuth', () => ({
  ...jest.requireActual('../utils/tournamentAuth'),
  canOfficiateMatch: jest.fn(async () => false),
  isTournamentOrganiser: jest.fn(async () => false),
}));
jest.mock('../utils/teamNames', () => ({ attachTeamNames: jest.fn(async () => undefined) }));
jest.mock('../utils/sportCache', () => ({ ...jest.requireActual('../utils/sportCache'), getSport: jest.fn(async () => ({ slug: 'cricket' })) }));
// eslint-disable-next-line import/first
import { getMatch } from '../controllers/matches.controller';

const MATCH = { id: 'm1', status: 'completed', sport_id: 's1', created_by: 'a', team_a_id: null, team_b_id: null, rules: { format: 'x' } };
async function open(viewer: string) {
  const r: any = { statusCode: 200, body: null, setHeader: jest.fn() };
  r.status = jest.fn((c: number) => { r.statusCode = c; return r; });
  r.json = jest.fn((b: unknown) => { r.body = b; return r; });
  await getMatch({ userId: viewer, params: { id: 'm1' } } as any, r);
  return r;
}

beforeEach(() => {
  db = fakeDb({
    matches: [MATCH],
    match_ratings: [{ match_id: 'm1', rater_id: 'a', match_quality: 4, would_play_again: true }],
  });
});

it('a player who has not rated is told so, even though the match has an average', async () => {
  const r = await open('b');
  expect(r.statusCode).toBe(200);
  expect(r.body.match.avg_rating).toBe(4);
  expect(r.body.match.my_rating).toBeNull();
});

it('the player who rated gets their own stars back', async () => {
  const r = await open('a');
  expect(r.body.match.my_rating).toBe(4);
});

it('no ratings yet: my_rating is null', async () => {
  db = fakeDb({ matches: [MATCH] });
  const r = await open('a');
  expect(r.body.match.my_rating).toBeNull();
  expect(r.body.match.avg_rating).toBeUndefined();
});
