/**
 * N-R7-S104 (Step 2 B7, SPP1-PKB-170): the organiser set the Referee back to None — the line went
 * and the former referee could no longer score, but they were never told (only 'You’re the referee'
 * ever reached them). A referee or scorer taken off (None, or someone else named) now gets a notification.
 */
import { fakeDb } from './helpers/fakeSupabase';
import * as notify from '../utils/notify';

let db = fakeDb();
jest.mock('../utils/supabase', () => ({ get supabase() { return db.client; } }));
jest.mock('../utils/notify', () => ({ ...jest.requireActual('../utils/notify'), notifyUser: jest.fn(async () => undefined), notifyUsers: jest.fn(async () => undefined) }));
// eslint-disable-next-line import/first
import { setMatchOfficials } from '../controllers/matches.controller';

const res = () => { const r: any = { statusCode: 200, body: null }; r.status = (c: number) => { r.statusCode = c; return r; }; r.json = (b: unknown) => { r.body = b; return r; }; return r; };
const M = '11111111-1111-4111-8111-111111111111';
const NEW = '22222222-2222-4222-8222-222222222222';
const REF = '33333333-3333-4333-8333-333333333333';
const SCO = '44444444-4444-4444-8444-444444444444';
const req = (body: object) => ({ userId: 'creator', params: { id: M }, body, header: () => undefined }) as any;
const seed = () => fakeDb({
  sports: [{ id: 's', slug: 'pickleball' }],
  users: [{ id: 'creator' }, { id: REF, deleted_at: null }, { id: SCO, deleted_at: null }, { id: NEW, deleted_at: null }],
  matches: [{ id: M, sport_id: 's', created_by: 'creator', umpire_id: REF, scorer_id: SCO, status: 'scheduled', tournament_id: null, is_ranked: false, team_a_id: null, team_b_id: null, team_a_name: 'Lions', team_b_name: 'Tigers' }],
  match_officials: [],
  match_scoring_leases: [],
});
const sent = () => (notify.notifyUser as jest.Mock).mock.calls.map(([a]) => `${a.userId} ${a.type} ${a.title}`);
beforeEach(() => (notify.notifyUser as jest.Mock).mockClear());

test('the referee set back to None is told', async () => {
  db = seed();
  const r = res();
  await setMatchOfficials(req({ umpire_id: null }), r);
  expect(r.statusCode).toBe(200);
  expect(sent()).toEqual([`${REF} match_official_removed You’re no longer the referee`]);
  const call = (notify.notifyUser as jest.Mock).mock.calls[0][0];
  expect(call.body).toBe('You’ve been taken off as referee for Lions vs Tigers. You can’t score it any more.');
  expect(call.data).toEqual({ matchId: M, screen: 'MatchDetail' });
});

test('a replaced scorer is told, and the new one is named', async () => {
  db = seed();
  const r = res();
  await setMatchOfficials(req({ scorer_id: NEW }), r);
  expect(r.statusCode).toBe(200);
  expect(sent().sort()).toEqual([`${NEW} match_official_assigned You’re the scorer`, `${SCO} match_official_removed You’re no longer the scorer`].sort());
});

test('saving the same officials again tells nobody', async () => {
  db = seed();
  const r = res();
  await setMatchOfficials(req({ umpire_id: REF, scorer_id: SCO }), r);
  expect(r.statusCode).toBe(200);
  expect(sent()).toEqual([]);
});
