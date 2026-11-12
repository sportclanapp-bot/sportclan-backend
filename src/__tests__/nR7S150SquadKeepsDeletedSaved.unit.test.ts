/**
 * N-R7-S150 (Step 2 B13, SIDE-A5b-1): a squad saved while a player had an account could not be saved again
 * once the account was deleted (every edit refused 'That player isn't on SportClan.'). A deleted account
 * already in the saved squad now stays (N-R7-64 still names it Deleted User); a new one is still refused.
 * Setup copied from nR764SquadDeletedMember.
 */
import { fakeDb } from './helpers/fakeSupabase';

const id = (n: number) => `abababab-abab-4bab-8bab-${String(n).padStart(12, '0')}`;
const T = id(1); const ORG = id(2); const CAP = id(3); const P1 = id(4); const VC = id(5); const OUT = id(6); const OTHER = id(7);
const TA = id(10); const TB = id(11);
const mk = (status = 'approved') => fakeDb({
  tournaments: [{ id: T, created_by: ORG, parent_id: null, settings: { v: 1 }, fixtures_generated: false, registration_deadline: null, entry_kind: 'team', format: 'league' }],
  tournament_organisers: [],
  tournament_entries: [{ tournament_id: T, team_id: TA, status }, { tournament_id: T, team_id: TB, status: 'approved' }],
  teams: [{ id: TA, name: 'Lions', created_by: CAP }, { id: TB, name: 'Tigers', created_by: OTHER }],
  team_members: [
    { team_id: TA, user_id: CAP, role: 'captain', jersey_number: 1 }, { team_id: TA, user_id: VC, role: 'vice_captain', jersey_number: 2 },
    { team_id: TA, user_id: P1, role: 'player', jersey_number: 7 }, { team_id: TB, user_id: OTHER, role: 'captain', jersey_number: 1 },
  ],
  users: [CAP, P1, VC, OUT, ORG, OTHER].map((u, i) => ({ id: u, name: u === CAP ? 'Deleted User' : ['Cap', 'Ravi', 'Vice', 'Out', 'Org', 'Other'][i], deleted_at: u === CAP ? '2026-10-24T07:00:00Z' : null })),
  tournament_squads: [], matches: [], match_events: [],
});
let db = mk();
jest.mock('../utils/supabase', () => ({ get supabase() { return db.client; } }));
// eslint-disable-next-line import/first
import { setSquad } from '../controllers/squads.controller';

const run = async (fn: any, userId: string, params: object, body: object = {}) => {
  const r: any = { statusCode: 200, body: null };
  r.status = jest.fn((c: number) => { r.statusCode = c; return r; });
  r.json = jest.fn((b: unknown) => { r.body = b; return r; });
  await fn({ userId, params: { ...params }, body, query: {} } as any, r);
  return r;
};

describe('N-R7-S150 · a squad saved with an account deleted since then can be saved again', () => {
  beforeEach(() => {
    db = mk();
    db.t('tournament_squads').push({ id: id(90), tournament_id: T, team_id: TA, user_id: CAP, guest_name: null, jersey_number: 1, removed_at: null, id_checked_at: null, id_checked_by: null, id_note: null, created_at: '2026-10-20T00:00:00Z' },
      { id: id(91), tournament_id: T, team_id: TA, user_id: P1, guest_name: null, jersey_number: 7, removed_at: null, id_checked_at: null, id_checked_by: null, id_note: null, created_at: '2026-10-20T00:00:01Z' });
  });
  test('adding a name keeps the saved Deleted User row instead of refusing the save', async () => {
    const r = await run(setSquad, ORG, { id: T, teamId: TA }, { players: [{ user_id: CAP, jersey_number: 1 }, { user_id: P1, jersey_number: 7 }, { guest_name: 'New Kid' }] });
    expect(r.statusCode).toBe(200);
    const live = db.t('tournament_squads').filter((x: any) => !x.removed_at && x.team_id === TA);
    expect(live.map((x: any) => x.user_id ?? x.guest_name).sort()).toEqual([CAP, P1, 'New Kid'].sort());
  });
  test('a deleted account that was not in the saved squad is still refused', async () => {
    const r = await run(setSquad, ORG, { id: T, teamId: TA }, { players: [{ user_id: P1 }, { user_id: id(99) }] });
    expect(r.statusCode).toBe(404);
    expect(r.body.code).toBe('PLAYER_NOT_FOUND');
  });
});
