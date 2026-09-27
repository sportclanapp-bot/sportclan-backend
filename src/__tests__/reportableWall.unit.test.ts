/**
 * 27 Sep 2026 · wall posts and wall comments can be reported, and removed /
 * restored by a moderator like #3 (migration 108).
 */
import fs from 'fs';
import path from 'path';

const calls: Array<{ table: string; op: string; args: unknown[] }> = [];
let rows: unknown[] = [{ id: 'w1' }];
let single: unknown = null;
jest.mock('../utils/supabase', () => ({
  supabase: {
    from: (table: string) => {
      const q: any = {};
      let mode = 'read';
      const rec = (op: string) => (...args: unknown[]) => { calls.push({ table, op, args }); return q; };
      for (const op of ['select', 'eq', 'is', 'in']) q[op] = rec(op);
      q.update = (...args: unknown[]) => { mode = 'update'; calls.push({ table, op: 'update', args }); return q; };
      q.delete = (...args: unknown[]) => { calls.push({ table, op: 'delete', args }); return q; };
      q.maybeSingle = () => Promise.resolve({ data: single, error: null });
      q.then = (resolve: (v: unknown) => void) => resolve({ data: mode === 'update' ? rows : [], error: null });
      return q;
    },
  },
}));
// eslint-disable-next-line import/first
import { moderatorRemoveWallItem, restoreRemovedContent, asDeletedWallComment } from '../utils/postVisibility';

const code = (f: string) =>
  fs.readFileSync(path.join(__dirname, '..', f), 'utf8').replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*$/gm, '');
const fnBody = (f: string, name: string) => {
  const s = code(f);
  const i = s.indexOf(`function ${name}(`);
  const j = s.indexOf('\nexport ', i + 10);
  return s.slice(i, j < 0 ? undefined : j);
};

beforeEach(() => { calls.length = 0; rows = [{ id: 'w1' }]; single = null; });

describe('moderator removal of wall items', () => {
  test.each([['profile_post', 'profile_posts'], ['profile_comment', 'profile_post_comments']])(
    '%s: the soft delete with reason "moderator"; never a delete', async (type, table) => {
      expect(await moderatorRemoveWallItem(type as 'profile_post', 'w1', 'admin1')).toBe(true);
      expect(calls.some((c) => c.op === 'delete')).toBe(false);
      const upd = calls.find((c) => c.op === 'update');
      expect(upd?.table).toBe(table);
      expect(upd?.args[0]).toMatchObject({ deleted_by: 'admin1', deleted_reason: 'moderator' });
    });
  test('restore brings a moderator-removed wall post back (wall items have no notifications to show again)', async () => {
    single = { deleted_at: 't', deleted_reason: 'moderator' };
    expect(await restoreRemovedContent('profile_post', 'w1')).toBe(true);
    expect(calls).toEqual(expect.arrayContaining([
      { table: 'profile_posts', op: 'update', args: [{ deleted_at: null, deleted_by: null, deleted_reason: null }] },
    ]));
    expect(calls.some((c) => c.table === 'notifications')).toBe(false);
  });
  test('an author\'s or wall owner\'s delete is not restorable here', async () => {
    single = { deleted_at: 't', deleted_reason: 'wall_owner' };
    expect(await restoreRemovedContent('profile_comment', 'k1')).toBe(false);
  });
  test('the thread placeholder says a moderator removed it', () => {
    expect(asDeletedWallComment({ deleted_reason: 'moderator' })).toMatchObject({ removed_by_moderator: true, removed_by_wall_owner: false });
  });
});

describe('reporting them', () => {
  const R = () => fnBody('controllers/community.controller.ts', 'reportContent');
  test('the two new target types are accepted', () => {
    expect(R()).toMatch(/\['post', 'comment', 'user', 'message', 'profile_post', 'profile_comment'\]\.includes\(target_type\)/);
  });
  test('a gone wall post / comment (or a comment on a gone wall post) can\'t be reported; self-reports refused as before', () => {
    expect(R()).toMatch(/resolvedType === 'profile_post'[\s\S]*?t\?\.deleted\) return res\.status\(410\)\.json\(postGone\(t\)\)/);
    expect(R()).toMatch(/resolvedType === 'profile_comment'[\s\S]*?t\?\.deleted\) return res\.status\(410\)\.json\(commentGone\(t\)\)[\s\S]*?wall\?\.deleted\) return res\.status\(410\)/);
    expect(R()).toMatch(/You can’t report your own content/);
  });
});

describe('the admin queue and actions', () => {
  test('wall items appear with text, author and deleted / removed state', () => {
    const f = fnBody('controllers/admin.controller.ts', 'getReports');
    expect(f).toMatch(/from\('profile_posts'\)\.select\('id, content, author_id, deleted_at, deleted_by, deleted_reason'\)/);
    expect(f).toMatch(/from\('profile_post_comments'\)\.select\('id, content, author_id, deleted_at, deleted_by, deleted_reason'\)/);
    expect(f).toMatch(/r\.target_type === 'profile_post' \|\| r\.target_type === 'profile_comment'[\s\S]*?content_removed_by_moderator = isModeratorRemoval\(w\)/);
  });
  test('Remove and Restore reach them', () => {
    const f = fnBody('controllers/admin.controller.ts', 'resolveReport');
    expect(f).toMatch(/\['post', 'comment', 'profile_post', 'profile_comment'\]\.includes\(report\.target_type\)/);
    expect(f).toMatch(/moderatorRemoveWallItem\(type, report\.target_id, adminId\)/);
    expect(f).toMatch(/type === 'profile_post' \? await profilePostForWrite[\s\S]*?: await profileCommentForWrite/);
  });
  test('users read "removed by a moderator": the wall post screen via postGone, the thread via the placeholder', () => {
    expect(fnBody('controllers/profilePosts.controller.ts', 'getProfilePost')).toMatch(/postGone\(/);
    expect(fnBody('controllers/profilePosts.controller.ts', 'listProfilePostComments')).toMatch(/asDeletedWallComment\(/);
  });
});

describe('migration 108', () => {
  test('widens the two check rules only', () => {
    const sql = fs.readFileSync(path.join(__dirname, '..', '..', 'supabase', 'migrations', '108_reportable_wall.sql'), 'utf8');
    expect(sql).toMatch(/CHECK \(target_type IN \('post', 'comment', 'user', 'message', 'profile_post', 'profile_comment'\)\)/);
    expect(sql).toMatch(/deleted_reason IN \('author', 'wall_owner', 'moderator'\)/);
    expect(sql.replace(/--.*$/gm, '').replace(/DROP CONSTRAINT( IF EXISTS)?/g, '')).not.toMatch(/\bDELETE\b|\bDROP\b|\bTRUNCATE\b/i);
  });
});
