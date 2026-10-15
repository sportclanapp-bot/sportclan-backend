/**
 * N-R3C-1 (launch test plan, Round 4) · posts and wall posts were checked for bad
 * language but team names were not, so a team could be called something abusive
 * (it shows in Discover, search and on match cards). Create and edit now refuse it
 * with the posts' answer (PROFANITY_DETECTED + the words), and names like Kshitij
 * pass (N-RWG6-2's whole-word check).
 */
import { fakeDb } from './helpers/fakeSupabase';

let db = fakeDb();
jest.mock('../utils/supabase', () => ({ get supabase() { return db.client; } }));
jest.mock('../utils/teamAuth', () => ({
  isTeamManager: jest.fn(async () => true),
  isTeamCaptain: jest.fn(async () => true),
  getTeamRole: jest.fn(async () => 'captain'),
}));
jest.mock('../utils/tournamentChat', () => ({ syncTournamentChatsForTeam: jest.fn(), syncAfterSuccess: jest.fn() }));
jest.mock('../utils/notify', () => ({ notifyUnlessBlocked: jest.fn(), notifyUsers: jest.fn() }));
jest.mock('../utils/sports', () => ({ validateSportForCreate: jest.fn(async () => null) }));
// eslint-disable-next-line import/first
import { createTeam, updateTeam, cleanTeamName } from '../controllers/teams.controller';

const TEAM = '22222222-2222-4222-8222-222222222222';
const call = async (fn: any, req: any) => {
  const r: any = { statusCode: 200, body: null };
  r.status = jest.fn((c: number) => { r.statusCode = c; return r; });
  r.json = jest.fn((b: unknown) => { r.body = b; return r; });
  await fn({ userId: 'me', params: {}, query: {}, ...req }, r);
  return r;
};

beforeEach(() => { db = fakeDb({ teams: [{ id: TEAM, name: 'Old', sport_id: 's1', captain_id: 'me' }] }); });

it('a new team with an abusive name is refused, and nothing is saved', async () => {
  const r = await call(createTeam, { body: { sport_id: 's1', name: 'Bullshit XI' } });
  expect(r.statusCode).toBe(400);
  expect(r.body).toEqual({ error: 'PROFANITY_DETECTED', detected_words: ['shit'] });
  expect(db.log.filter((l: any) => l.table === 'teams' && l.op === 'insert')).toHaveLength(0);
});

it('renaming a team to an abusive name is refused', async () => {
  const r = await call(updateTeam, { params: { id: TEAM }, body: { name: 'Fucking Legends' } });
  expect(r.statusCode).toBe(400);
  expect(r.body).toEqual({ error: 'PROFANITY_DETECTED', detected_words: ['fuck'] });
  expect(db.log.filter((l: any) => l.table === 'teams' && l.op === 'update')).toHaveLength(0);
});

it('the short name is checked too', async () => {
  const r = await call(updateTeam, { params: { id: TEAM }, body: { short_name: 'ass' } });
  expect(r.statusCode).toBe(400);
  expect(r.body.error).toBe('PROFANITY_DETECTED');
});

it('ordinary names, including Kshitij and Shital, pass', () => {
  expect(cleanTeamName('Kshitij Strikers')).toEqual({ value: 'Kshitij Strikers' });
  expect(cleanTeamName('Shital XI')).toEqual({ value: 'Shital XI' });
});
