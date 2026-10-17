/**
 * E-008 (Round 6) · DELETE /admin/teams/:id removed the team but left its open
 * reports in the queue (the report path resolves them). Now the direct remove
 * resolves them as 'removed', and the direct restore turns those into 'restored',
 * as the report path does. Same fake database as nRwg29ReportRemoveTeam.
 */
import { fakeDb } from './helpers/fakeSupabase';

let db = fakeDb();
jest.mock('../utils/supabase', () => ({ get supabase() { return db.client; } }));
// eslint-disable-next-line import/first
import { adminRemoveTeam, adminRestoreTeam } from '../controllers/admin.controller';

const TEAM = '22222222-2222-4222-8222-222222222222';
const OTHER = '44444444-4444-4444-8444-444444444444';
const call = async (fn: any, req: any) => {
  const r: any = { statusCode: 200, body: null, setHeader: jest.fn() };
  r.status = jest.fn((c: number) => { r.statusCode = c; return r; });
  r.json = jest.fn((b: unknown) => { r.body = b; return r; });
  await fn({ params: {}, query: {}, body: {}, ...req }, r);
  return r;
};

beforeEach(() => {
  db = fakeDb({
    teams: [{ id: TEAM, name: 'Rude Name XI', created_by: 'cap', kind: 'club', deleted_at: null }],
    team_members: [{ team_id: TEAM, user_id: 'cap', role: 'captain' }],
    content_reports: [
      { id: 'r1', target_type: 'team', target_id: TEAM, reporter_id: 'a', resolved: false },
      { id: 'r2', target_type: 'team', target_id: TEAM, reporter_id: 'b', resolved: false },
      { id: 'r3', target_type: 'team', target_id: OTHER, reporter_id: 'a', resolved: false },
    ],
  });
});

describe('E-008 · direct remove / restore of a team', () => {
  it('removing the team resolves its open reports as removed (only its own)', async () => {
    const r = await call(adminRemoveTeam, { userId: 'admin', params: { id: TEAM } });
    expect(r.body).toEqual({ ok: true, removed: true });
    const byId = Object.fromEntries(db.tables.content_reports.map((x: any) => [x.id, x]));
    expect(byId.r1).toMatchObject({ resolved: true, resolved_action: 'removed', resolved_by: 'admin' });
    expect(byId.r2).toMatchObject({ resolved: true, resolved_action: 'removed' });
    expect(byId.r3.resolved).toBe(false);
  });
  it('restoring it turns those reports to restored', async () => {
    await call(adminRemoveTeam, { userId: 'admin', params: { id: TEAM } });
    const r = await call(adminRestoreTeam, { userId: 'admin', params: { id: TEAM } });
    expect(r.body).toEqual({ ok: true, restored: true });
    const acts = db.tables.content_reports.filter((x: any) => x.target_id === TEAM).map((x: any) => x.resolved_action);
    expect(acts).toEqual(['restored', 'restored']);
  });
});
