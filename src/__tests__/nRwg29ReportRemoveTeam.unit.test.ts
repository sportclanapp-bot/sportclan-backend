/**
 * N-RWG2-9 (launch test plan, Round 4) · a team with an offensive name or logo
 * could not be reported (POST /community/report {target_type:'team'} → 400), and
 * admins had no way to rename or remove a team. Now:
 *   - a team can be reported (migration 158 widens content_reports.target_type);
 *   - the admin queue shows it (name, logo, maker) and Remove / Restore act on it —
 *     a soft mark (deleted_reason 'moderator'), never a deleted row;
 *   - PATCH /admin/teams/:id renames it or clears its logo; DELETE removes it (soft);
 *     POST /admin/teams/:id/restore undoes that. All behind requireAdmin.
 */
import fs from 'fs';
import path from 'path';
import { fakeDb } from './helpers/fakeSupabase';

let db = fakeDb();
jest.mock('../utils/supabase', () => ({ get supabase() { return db.client; } }));
// eslint-disable-next-line import/first
import { reportContent } from '../controllers/community.controller';
// eslint-disable-next-line import/first
import { getReports, resolveReport, adminUpdateTeam, adminRemoveTeam, adminRestoreTeam } from '../controllers/admin.controller';
// eslint-disable-next-line import/first
import { getTeam } from '../controllers/teams.controller';

const TEAM = '22222222-2222-4222-8222-222222222222';
const OLD = '33333333-3333-4333-8333-333333333333';
const call = async (fn: any, req: any) => {
  const r: any = { statusCode: 200, body: null, setHeader: jest.fn() };
  r.status = jest.fn((c: number) => { r.statusCode = c; return r; });
  r.json = jest.fn((b: unknown) => { r.body = b; return r; });
  await fn({ params: {}, query: {}, body: {}, ...req }, r);
  return r;
};

beforeEach(() => {
  db = fakeDb({
    teams: [
      { id: TEAM, name: 'Rude Name XI', short_name: 'RNX', logo_url: 'https://pub.r2.dev/rude.png', created_by: 'cap', kind: 'club', is_public: true, deleted_at: null },
      { id: OLD, name: 'Old Rude XI', created_by: 'cap2', kind: 'club', deleted_at: null },
    ],
    team_members: [{ team_id: TEAM, user_id: 'cap', role: 'captain' }, { team_id: TEAM, user_id: 'mem', role: 'player' }],
    matches: [{ id: 'm1', team_a_id: OLD, team_b_id: 'other' }],
    users: [{ id: 'rep', name: 'Reporter', username: 'rep' }, { id: 'cap', name: 'Captain', username: 'cap' }],
  });
});

describe('reporting a team', () => {
  it('is filed (it was a 400)', async () => {
    const r = await call(reportContent, { userId: 'rep', body: { target_type: 'team', target_id: TEAM, reason: 'offensive' } });
    expect(r.statusCode).toBe(201);
    expect(db.tables.content_reports).toEqual([expect.objectContaining({ target_type: 'team', target_id: TEAM, reporter_id: 'rep' })]);
  });
  it('its captain cannot report their own team', async () => {
    const r = await call(reportContent, { userId: 'cap', body: { target_type: 'team', target_id: TEAM, reason: 'offensive' } });
    expect(r.statusCode).toBe(400);
  });
  it('a team that is gone says so; an unknown one is a 404', async () => {
    db.tables.teams[0]!.deleted_at = '2026-10-01T00:00:00Z';
    db.tables.teams[0]!.deleted_reason = 'moderator';
    const gone = await call(reportContent, { userId: 'rep', body: { target_type: 'team', target_id: TEAM, reason: 'offensive' } });
    expect(gone.statusCode).toBe(410);
    expect(gone.body.code).toBe('TEAM_REMOVED');
    const none = await call(reportContent, { userId: 'rep', body: { target_type: 'team', target_id: 'not-a-team', reason: 'offensive' } });
    expect(none.statusCode).toBe(404);
  });
});

describe('the admin queue', () => {
  beforeEach(() => {
    db.tables.content_reports = [{ id: 'r1', target_type: 'team', target_id: TEAM, reporter_id: 'rep', reason: 'offensive', resolved: false, created_at: '2026-10-01T00:00:00Z' }];
  });
  it('shows the team: its name, logo and who made it', async () => {
    const r = await call(getReports, { userId: 'admin' });
    expect(r.body.reports[0]).toMatchObject({
      target_type: 'team', content_exists: true, content_preview: 'Rude Name XI (RNX)',
      content_author: { id: 'cap', name: 'Captain' }, team_logo_url: 'https://pub.r2.dev/rude.png',
    });
  });
  it('Remove marks the team removed by a moderator — the row and its members stay', async () => {
    const r = await call(resolveReport, { userId: 'admin', params: { id: 'r1' }, body: { action: 'remove' } });
    expect(r.body).toMatchObject({ ok: true, contentRemoved: true });
    expect(db.tables.teams.find((t: any) => t.id === TEAM)).toMatchObject({ deleted_by: 'admin', deleted_reason: 'moderator' });
    expect(db.tables.teams.find((t: any) => t.id === TEAM)!.deleted_at).toBeTruthy();
    expect(db.tables.team_members).toHaveLength(2);
    expect(db.log.filter((l) => l.op === 'delete')).toHaveLength(0);
    expect(db.tables.content_reports[0]).toMatchObject({ resolved: true, resolved_action: 'removed' });
    expect(db.tables.admin_actions).toEqual([expect.objectContaining({ action: 'remove_team', target_id: TEAM })]);
    // The team page says a moderator removed it.
    const page = await call(getTeam, { userId: 'rep', params: { id: TEAM } });
    expect(page.statusCode).toBe(410);
    expect(page.body.code).toBe('TEAM_REMOVED');
  });
  it('Restore brings it back', async () => {
    await call(resolveReport, { userId: 'admin', params: { id: 'r1' }, body: { action: 'remove' } });
    const r = await call(resolveReport, { userId: 'admin', params: { id: 'r1' }, body: { action: 'restore' } });
    expect(r.body).toMatchObject({ ok: true, contentRestored: true });
    expect(db.tables.teams.find((t: any) => t.id === TEAM)).toMatchObject({ deleted_at: null, deleted_reason: null });
  });
});

describe('admin team tools', () => {
  it('rename: the name is checked like a new team’s, then saved and logged', async () => {
    const bad = await call(adminUpdateTeam, { userId: 'admin', params: { id: TEAM }, body: { name: 'Bullshit XI' } });
    expect(bad.statusCode).toBe(400);
    expect(bad.body.error).toBe('PROFANITY_DETECTED');
    const ok = await call(adminUpdateTeam, { userId: 'admin', params: { id: TEAM }, body: { name: 'Team 1', logo_url: null } });
    expect(ok.statusCode).toBe(200);
    expect(db.tables.teams.find((t: any) => t.id === TEAM)).toMatchObject({ name: 'Team 1', logo_url: null });
    expect(db.tables.admin_actions).toEqual([expect.objectContaining({ action: 'update_team', target_id: TEAM })]);
  });
  it('an admin can clear a logo but not put their own in', async () => {
    const r = await call(adminUpdateTeam, { userId: 'admin', params: { id: TEAM }, body: { logo_url: 'https://pub.r2.dev/x.png' } });
    expect(r.statusCode).toBe(400);
  });
  it('remove is soft; restore undoes it', async () => {
    const r = await call(adminRemoveTeam, { userId: 'admin', params: { id: TEAM } });
    expect(r.body).toEqual({ ok: true, removed: true });
    expect(db.tables.teams.find((t: any) => t.id === TEAM)!.deleted_reason).toBe('moderator');
    const back = await call(adminRestoreTeam, { userId: 'admin', params: { id: TEAM } });
    expect(back.body).toEqual({ ok: true, restored: true });
    expect(db.tables.teams.find((t: any) => t.id === TEAM)!.deleted_at).toBeNull();
  });
  it('a team with matches is not removed (rename it instead)', async () => {
    const r = await call(adminRemoveTeam, { userId: 'admin', params: { id: OLD } });
    expect(r.statusCode).toBe(409);
    expect(r.body.code).toBe('TEAM_HAS_HISTORY');
    expect(db.tables.teams.find((t: any) => t.id === OLD)!.deleted_at).toBeNull();
  });
  it('a captain’s disband is not something an admin restores', async () => {
    db.tables.teams[0]!.deleted_at = '2026-10-01T00:00:00Z';
    db.tables.teams[0]!.deleted_reason = 'captain_disband';
    const r = await call(adminRestoreTeam, { userId: 'admin', params: { id: TEAM } });
    expect(r.statusCode).toBe(409);
  });
  it('the routes sit behind requireAdmin, and migration 158 allows team reports and the moderator reason', () => {
    const routes = fs.readFileSync(path.join(__dirname, '..', 'routes', 'admin.routes.ts'), 'utf8');
    expect(routes.indexOf('router.use(requireAdmin)')).toBeLessThan(routes.indexOf("router.patch('/teams/:id', adminUpdateTeam)"));
    expect(routes).toContain("router.delete('/teams/:id', adminRemoveTeam)");
    const m = fs.readFileSync(path.join(__dirname, '..', '..', 'supabase', 'migrations', '158_reportable_teams.sql'), 'utf8');
    expect(m).toContain("'profile_comment', 'team'");
    expect(m).toContain("'last_member_left', 'moderator'");
  });
});
