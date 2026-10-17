/**
 * E-024 (Round 6) · DELETE /teams/:id/bans/:userId answered { unbanned: true }
 * for someone who was never removed. Now 404 NOT_BANNED; a real ban is lifted
 * (archived with who lifted it), by the captain or a co-captain as before.
 */
import { fakeDb } from './helpers/fakeSupabase';

let db = fakeDb();
jest.mock('../utils/supabase', () => ({ get supabase() { return db.client; } }));
// eslint-disable-next-line import/first
import { unbanTeamMember } from '../controllers/teams.controller';

const TEAM = '22222222-2222-4222-8222-222222222222';
const CAP = '11111111-1111-4111-8111-111111111111';
const VC = '33333333-3333-4333-8333-333333333333';
const GONE = '44444444-4444-4444-8444-444444444444';
const NEVER = '55555555-5555-4555-8555-555555555555';
const call = async (req: any) => {
  const r: any = { statusCode: 200, body: null };
  r.status = jest.fn((c: number) => { r.statusCode = c; return r; });
  r.json = jest.fn((b: unknown) => { r.body = b; return r; });
  await unbanTeamMember({ params: {}, query: {}, body: {}, ...req } as any, r);
  return r;
};

beforeEach(() => {
  db = fakeDb({
    teams: [{ id: TEAM, name: 'T', kind: 'club', deleted_at: null }],
    team_members: [{ team_id: TEAM, user_id: CAP, role: 'captain' }, { team_id: TEAM, user_id: VC, role: 'vice_captain' }],
    team_bans: [{ id: 'b1', team_id: TEAM, user_id: GONE, banned_by: CAP }],
  });
});

describe('E-024 · lifting a removal', () => {
  it('someone never removed → 404, not "unbanned"', async () => {
    const r = await call({ userId: CAP, params: { id: TEAM, userId: NEVER } });
    expect(r.statusCode).toBe(404);
    expect(r.body.code).toBe('NOT_BANNED');
  });
  it('a real ban is lifted by a co-captain, with who and why on the record', async () => {
    const r = await call({ userId: VC, params: { id: TEAM, userId: GONE } });
    expect(r.body).toEqual({ unbanned: true });
    expect(db.tables.team_bans).toEqual([]);
    expect(db.log).toContainEqual({ table: 'team_bans', op: 'delete', arg: { ids: ['b1'], by: VC, reason: 'removal undone by a team manager' } });
  });
});
