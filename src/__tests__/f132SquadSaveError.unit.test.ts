/** F132 (launch test plan, Round 3): any database error saving a squad said 'A player is already in another team’s squad' — only the unique key is that. */
import { fakeDb } from './helpers/fakeSupabase';

const id = (n: number) => `abababab-abab-4bab-8bab-${String(n).padStart(12, '0')}`;
const T = id(1); const ORG = id(2); const CAP = id(3); const P1 = id(4); const P2 = id(5); const P3 = id(6); const OTHER = id(7);
const TA = id(10); const TB = id(11);
const mk = (settings: object = {}, extra: object = {}) => fakeDb({
  tournaments: [{ id: T, created_by: ORG, parent_id: null, settings: { v: 1, ...settings }, fixtures_generated: false, registration_deadline: null, entry_kind: 'team', format: 'league', ...extra }],
  tournament_organisers: [],
  tournament_entries: [{ tournament_id: T, team_id: TA, status: 'approved' }, { tournament_id: T, team_id: TB, status: 'approved' }],
  teams: [{ id: TA, name: 'Lions', created_by: CAP }, { id: TB, name: 'Tigers', created_by: OTHER }],
  team_members: [{ team_id: TA, user_id: CAP, role: 'captain', jersey_number: 1 }, { team_id: TA, user_id: P1, role: 'player', jersey_number: 7 }],
  users: [CAP, P1, P2, P3, ORG, OTHER].map((u, i) => ({ id: u, name: ['Cap', 'Ravi', 'Amit', 'Dev', 'Org', 'Other'][i], deleted_at: null })),
  tournament_squads: [], matches: [], match_events: [],
});
let db = mk();
let mockInsertErr: { code: string; message: string } | null = null;
jest.mock('../utils/supabase', () => ({
  get supabase() {
    // The squad insert fails as the database would (F132): a unique key, or anything else.
    return { ...db.client, from: (t: string) => {
      const q = db.client.from(t);
      if (t !== 'tournament_squads' || !mockInsertErr) return q;
      return { ...q, insert: () => Promise.resolve({ data: null, error: mockInsertErr }) };
    } };
  },
}));
// eslint-disable-next-line import/first
import { setSquad } from '../controllers/squads.controller';

const run = async (fn: any, userId: string, params: object, body: object = {}) => {
  const r: any = { statusCode: 200, body: null };
  r.status = jest.fn((c: number) => { r.statusCode = c; return r; });
  r.json = jest.fn((b: unknown) => { r.body = b; return r; });
  await fn({ userId, params: { ...params }, body, query: {} } as any, r);
  return r;
};

test('a unique-key clash is the other squad; anything else says the squad wasn’t saved', async () => {
  db = mk();
  mockInsertErr = { code: '23505', message: 'tournament_squads_user_live' };
  expect((await run(setSquad, CAP, { id: T, teamId: TA }, { players: [{ user_id: CAP }] })).body.code).toBe('IN_OTHER_SQUAD');
  db = mk();
  mockInsertErr = { code: '57014', message: 'canceling statement due to statement timeout' };
  const r = await run(setSquad, CAP, { id: T, teamId: TA }, { players: [{ user_id: CAP }] });
  expect([r.statusCode, r.body.code, r.body.error]).toEqual([500, 'SQUAD_NOT_SAVED', 'The squad wasn’t saved. Try again.']);
});
