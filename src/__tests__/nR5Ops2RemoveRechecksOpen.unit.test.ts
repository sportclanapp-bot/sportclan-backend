/**
 * N-R5-ops-2 (launch test plan, Round 5) · Remove did not re-check that the report was still
 * open when it wrote: if another admin dismissed it between Remove's read and its write, Remove
 * removed the content anyway and overwrote 'Dismissed'. Remove now claims the report only while
 * it is open (as Dismiss does) before touching the content — otherwise 409 with words — and if
 * the removal itself is refused, the report is open again.
 */
import { fakeDb } from './helpers/fakeSupabase';

let db = fakeDb();
jest.mock('../utils/supabase', () => ({ get supabase() { return db.client; } }));
// eslint-disable-next-line import/first
import { resolveReport } from '../controllers/admin.controller';

const TEAM = '22222222-2222-4222-8222-222222222222';
const OLD = '33333333-3333-4333-8333-333333333333';
const POST = '44444444-4444-4444-8444-444444444444';
const call = async (fn: any, req: any) => {
  const r: any = { statusCode: 200, body: null, setHeader: jest.fn() };
  r.status = jest.fn((c: number) => { r.statusCode = c; return r; });
  r.json = jest.fn((b: unknown) => { r.body = b; return r; });
  await fn({ params: {}, query: {}, body: {}, ...req }, r);
  return r;
};
/** Another admin dismisses report r1 just after this request has read it. */
function dismissAfterRead() {
  const from = db.client.from.bind(db.client);
  let reads = 0;
  (db.client as any).from = (t: string) => {
    if (t === 'content_reports' && ++reads === 2) {
      Object.assign(db.tables.content_reports[0], { resolved: true, resolved_action: 'dismissed', resolved_by: 'admin-1', resolved_at: '2026-10-16T00:00:00Z' });
    }
    return from(t);
  };
}

beforeEach(() => {
  db = fakeDb({
    teams: [
      { id: TEAM, name: 'Rude Name XI', created_by: 'cap', kind: 'club', deleted_at: null },
      { id: OLD, name: 'Old Rude XI', created_by: 'cap2', kind: 'club', deleted_at: null },
    ],
    team_members: [{ team_id: TEAM, user_id: 'cap', role: 'captain' }],
    matches: [{ id: 'm1', team_a_id: OLD, team_b_id: 'other' }],
    community_posts: [{ id: POST, content: 'rude', author_id: 'cap', deleted_at: null }],
    users: [{ id: 'cap', name: 'Captain', username: 'cap' }],
  });
});

it("a team: another admin's Dismiss lands first — Remove is refused and the team stays", async () => {
  db.tables.content_reports = [{ id: 'r1', target_type: 'team', target_id: TEAM, reporter_id: 'rep', reason: 'offensive', resolved: false, created_at: '2026-10-01T00:00:00Z' }];
  dismissAfterRead();
  const r = await call(resolveReport, { userId: 'admin-2', params: { id: 'r1' }, body: { action: 'remove' } });
  expect(r.statusCode).toBe(409);
  expect(r.body).toEqual({ error: 'Another admin already handled this report. It is in Actioned now.', code: 'ALREADY_HANDLED' });
  expect(db.tables.teams.find((t: any) => t.id === TEAM)!.deleted_at).toBeFalsy();
  expect(db.tables.content_reports[0]).toMatchObject({ resolved_action: 'dismissed', resolved_by: 'admin-1' });
});

it("a post: the same — the post isn't removed and 'Dismissed' stands", async () => {
  db.tables.content_reports = [{ id: 'r1', target_type: 'post', target_id: POST, reporter_id: 'rep', reason: 'spam', resolved: false, created_at: '2026-10-01T00:00:00Z' }];
  dismissAfterRead();
  const r = await call(resolveReport, { userId: 'admin-2', params: { id: 'r1' }, body: { action: 'remove' } });
  expect(r.statusCode).toBe(409);
  expect(db.tables.community_posts[0].deleted_at).toBeFalsy();
  expect(db.tables.content_reports[0]).toMatchObject({ resolved_action: 'dismissed', resolved_by: 'admin-1' });
});

it('a refused removal (a team with matches) leaves the report open', async () => {
  db.tables.content_reports = [{ id: 'r1', target_type: 'team', target_id: OLD, reporter_id: 'rep', reason: 'offensive', resolved: false, created_at: '2026-10-01T00:00:00Z' }];
  const r = await call(resolveReport, { userId: 'admin-2', params: { id: 'r1' }, body: { action: 'remove' } });
  expect(r.statusCode).toBe(409);
  expect(db.tables.content_reports[0].resolved).toBe(false);
  expect(db.tables.content_reports[0].resolved_action ?? null).toBeNull();
});

it('an open report is still removed', async () => {
  db.tables.content_reports = [{ id: 'r1', target_type: 'post', target_id: POST, reporter_id: 'rep', reason: 'spam', resolved: false, created_at: '2026-10-01T00:00:00Z' }];
  const r = await call(resolveReport, { userId: 'admin-2', params: { id: 'r1' }, body: { action: 'remove' } });
  expect(r.body).toMatchObject({ ok: true, contentRemoved: true });
  expect(db.tables.community_posts[0].deleted_at).toBeTruthy();
  expect(db.tables.content_reports[0]).toMatchObject({ resolved: true, resolved_action: 'removed', resolved_by: 'admin-2' });
});
