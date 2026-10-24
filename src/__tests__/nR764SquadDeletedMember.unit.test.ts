/**
 * N-R7-64 (Step 2, X2-S14 on the phone) · a captain deleted their account mid-league. The team's
 * squad (not saved yet, so built from the members) still counted them — '3 players' with one
 * shown as 'Player' — though the team page shows 2 members and a deleted account is never put in
 * a line-up (N-R7-39). The members' squad now leaves a deleted account out, and a squad saved
 * before the deletion names them 'Deleted User', as everywhere else.
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
import { getSquad } from '../controllers/squads.controller';

const run = async (fn: any, userId: string, params: object, body: object = {}) => {
  const r: any = { statusCode: 200, body: null };
  r.status = jest.fn((c: number) => { r.statusCode = c; return r; });
  r.json = jest.fn((b: unknown) => { r.body = b; return r; });
  await fn({ userId, params: { ...params }, body, query: {} } as any, r);
  return r;
};

describe('N-R7-64 · a deleted member and the squad', () => {
  beforeEach(() => { db = mk(); });
  test('the members\' squad (not saved yet) leaves the deleted account out', async () => {
    const r = await run(getSquad, ORG, { id: T, teamId: TA });
    expect(r.body.saved).toBe(false);
    expect(r.body.players.map((p: any) => p.user_id).sort()).toEqual([P1, VC].sort());
    expect(r.body.players.map((p: any) => p.name)).not.toContain('Player');
  });
  test('a squad saved before the deletion names them Deleted User', async () => {
    db.t('tournament_squads').push({ id: id(90), tournament_id: T, team_id: TA, user_id: CAP, guest_name: null, jersey_number: 1, removed_at: null, id_checked_at: null, id_checked_by: null, id_note: null, created_at: '2026-10-20T00:00:00Z' },
      { id: id(91), tournament_id: T, team_id: TA, user_id: P1, guest_name: null, jersey_number: 7, removed_at: null, id_checked_at: null, id_checked_by: null, id_note: null, created_at: '2026-10-20T00:00:01Z' });
    const r = await run(getSquad, ORG, { id: T, teamId: TA });
    expect(r.body.saved).toBe(true);
    expect(r.body.players.find((p: any) => p.user_id === CAP).name).toBe('Deleted User');
    expect(r.body.players.find((p: any) => p.user_id === P1).name).toBe('Ravi');
  });
});
