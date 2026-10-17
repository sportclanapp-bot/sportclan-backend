/**
 * E-055 (Round 6) · createTeam ignored a failed captain-row insert ("best effort
 * — return team anyway"), so a team could exist with no captain that nobody
 * could manage, edit or disband. Now the new team is taken back (archived with
 * why) and the maker is told it wasn't created.
 */
import { fakeDb } from './helpers/fakeSupabase';

let db = fakeDb();
let failMembers = false;
jest.mock('../utils/supabase', () => ({
  get supabase() {
    return {
      ...db.client,
      from: (t: string) => (t === 'team_members' && failMembers
        ? { insert: () => Promise.resolve({ data: null, error: { message: 'boom' } }) }
        : db.client.from(t)),
    };
  },
}));
jest.mock('../utils/sports', () => ({ ...jest.requireActual('../utils/sports'), validateSportForCreate: jest.fn(async () => null) }));
// eslint-disable-next-line import/first
import { createTeam } from '../controllers/teams.controller';

const SPORT = '66666666-6666-4666-8666-666666666666';
const ME = '11111111-1111-4111-8111-111111111111';
const call = async () => {
  const r: any = { statusCode: 200, body: null };
  r.status = jest.fn((c: number) => { r.statusCode = c; return r; });
  r.json = jest.fn((b: unknown) => { r.body = b; return r; });
  await createTeam({ userId: ME, params: {}, query: {}, body: { sport_id: SPORT, name: 'Lions' } } as any, r);
  return r;
};

beforeEach(() => { db = fakeDb({ teams: [], team_members: [] }); failMembers = false; });

describe('E-055 · a team is never left without its captain', () => {
  test('the captain row fails → 500, and no team is left behind', async () => {
    failMembers = true;
    const r = await call();
    expect(r.statusCode).toBe(500);
    expect(r.body.code).toBe('TEAM_NOT_CREATED');
    expect(db.tables.teams).toEqual([]);
    expect(db.tables.deleted_records).toEqual([expect.objectContaining({ table_name: 'teams', deleted_by: ME })]);
  });
  test('control: normally the maker is its captain', async () => {
    const r = await call();
    expect(r.statusCode).toBe(200);
    expect(db.tables.team_members).toEqual([expect.objectContaining({ team_id: r.body.team.id, user_id: ME, role: 'captain' })]);
  });
});
