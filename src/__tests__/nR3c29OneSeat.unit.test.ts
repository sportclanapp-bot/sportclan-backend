/**
 * N-R3C2-9 (launch test plan, Round 3): one person was named umpire, second, third and fourth umpire of a
 * match at once, and told four times. One person, one official's seat (the scorer isn't one).
 */
import { fakeDb } from './helpers/fakeSupabase';

const id = (n: number) => `dddddddd-dddd-4ddd-8ddd-${String(n).padStart(12, '0')}`;
const ORG = id(1); const REF = id(2); const AR1 = id(3); const AR2 = id(4); const PLAYER = id(5); const T = id(6);
const FB = 'sport-football'; const CR = 'sport-cricket'; const CA = 'sport-carrom';
const M = id(100); const MC = id(101); const MCR = id(102);
const mkDb = () => fakeDb({
  sports: [{ id: FB, slug: 'football' }, { id: CR, slug: 'cricket' }, { id: CA, slug: 'carrom' }],
  tournaments: [{ id: T, created_by: ORG, parent_id: null }],
  tournament_organisers: [],
  users: [ORG, REF, AR1, AR2, PLAYER].map((u, i) => ({ id: u, name: `U${i}`, username: `u${i}`, deleted_at: null })),
  matches: [
    { id: M, sport_id: FB, tournament_id: T, created_by: ORG, status: 'scheduled', umpire_id: REF, scorer_id: null, is_ranked: true, team_a_name: 'Lions', team_b_name: 'Tigers', official_report: null },
    { id: MC, sport_id: CA, tournament_id: T, created_by: ORG, status: 'scheduled', umpire_id: null, scorer_id: null, is_ranked: false, team_a_name: 'A', team_b_name: 'B', official_report: null },
    { id: MCR, sport_id: CR, tournament_id: T, created_by: ORG, status: 'completed', umpire_id: REF, scorer_id: null, is_ranked: false, team_a_name: 'A', team_b_name: 'B', official_report: null },
  ],
  match_officials: [],
  match_participants: [{ match_id: M, user_id: PLAYER, team_side: 'A' }],
});
let db = mkDb();
jest.mock('../utils/supabase', () => ({ get supabase() { return db.client; } }));
const sent: Array<{ userId: string; title: string }> = [];
jest.mock('../utils/notify', () => ({ notifyUser: jest.fn(async (n: { userId: string; title: string }) => { sent.push(n); }), notifyUsers: jest.fn(), matchAudienceIds: jest.fn(async () => []), matchFollowerIds: jest.fn(async () => []) }));
jest.mock('../utils/tournamentAuth', () => ({ ...jest.requireActual('../utils/tournamentAuth'), isTournamentOrganiser: jest.fn(async () => true) }));

// eslint-disable-next-line import/first
import { setMatchAssistants } from '../controllers/matchOfficials.controller';
// eslint-disable-next-line import/first
import { setMatchOfficials } from '../controllers/matches.controller';

const run = async (fn: any, userId: string, params: object, body: object = {}) => {
  const r: any = { statusCode: 200, body: null };
  r.status = jest.fn((c: number) => { r.statusCode = c; return r; });
  r.json = jest.fn((b: unknown) => { r.body = b; return r; });
  await fn({ userId, params, body, query: {} } as any, r);
  return r;
};
beforeEach(() => { db = mkDb(); sent.length = 0; });
test('two assistant seats for one person: refused, nothing saved, nobody told', async () => {
  const r = await run(setMatchAssistants, ORG, { id: M }, { assignments: [{ role: 'assistant_referee_1', user_id: AR1 }, { role: 'assistant_referee_2', user_id: AR1 }] });
  expect([r.statusCode, r.body.code]).toEqual([409, 'OFFICIAL_TWICE']);
  expect(db.t('match_officials').length).toBe(0);
  expect(sent.length).toBe(0);
});
test('the referee can’t also be an assistant, either way round', async () => {
  const r = await run(setMatchAssistants, ORG, { id: M }, { assignments: [{ role: 'fourth_official', user_id: REF }] });
  expect([r.statusCode, r.body.code]).toEqual([409, 'OFFICIAL_TWICE']);
  expect((await run(setMatchAssistants, ORG, { id: M }, { assignments: [{ role: 'fourth_official', user_id: AR1 }] })).statusCode).toBe(200);
  const r2 = await run(setMatchOfficials, ORG, { id: M }, { umpire_id: AR1 });
  expect([r2.statusCode, r2.body.code]).toEqual([409, 'OFFICIAL_TWICE']);
});
test('moving a person from one seat to another in one save is fine', async () => {
  await run(setMatchAssistants, ORG, { id: M }, { assignments: [{ role: 'assistant_referee_1', user_id: AR1 }] });
  const r = await run(setMatchAssistants, ORG, { id: M }, { assignments: [{ role: 'assistant_referee_1', user_id: null }, { role: 'assistant_referee_2', user_id: AR1 }] });
  expect(r.statusCode).toBe(200);
});
