/**
 * Hard-delete list #5 (27 Sep 2026) · DELETE /profile-posts/comments/:commentId
 * is a soft delete that records whose delete it was (migration 105).
 */
import fs from 'fs';
import path from 'path';

const calls: Array<{ table: string; op: string; args: unknown[] }> = [];
let rows: unknown[] = [{ id: 'k1' }];
jest.mock('../utils/supabase', () => ({
  supabase: {
    from: (table: string) => {
      const q: any = {};
      const rec = (op: string) => (...args: unknown[]) => { calls.push({ table, op, args }); return q; };
      for (const op of ['select', 'eq', 'is', 'update', 'delete']) q[op] = rec(op);
      q.then = (resolve: (v: unknown) => void) => resolve({ data: rows, error: null });
      return q;
    },
  },
}));
// eslint-disable-next-line import/first
import { softDeleteProfileComment, asDeletedWallComment } from '../utils/postVisibility';

const code = (f: string) =>
  fs.readFileSync(path.join(__dirname, '..', f), 'utf8').replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*$/gm, '');
const fnBody = (f: string, name: string) => {
  const s = code(f);
  const i = s.indexOf(`function ${name}(`);
  if (i < 0) throw new Error(`${name} not found`);
  const j = s.indexOf('\nexport ', i + 10);
  return s.slice(i, j < 0 ? undefined : j);
};
const P = 'controllers/profilePosts.controller.ts';

beforeEach(() => { calls.length = 0; rows = [{ id: 'k1' }]; });

describe('softDeleteProfileComment', () => {
  test('marks it with who and which, never deletes it', async () => {
    expect(await softDeleteProfileComment('k1', 'owner1', 'wall_owner')).toBe(true);
    expect(calls.some((c) => c.op === 'delete')).toBe(false);
    expect(calls.find((c) => c.op === 'update')?.args[0]).toMatchObject({ deleted_by: 'owner1', deleted_reason: 'wall_owner' });
    expect(calls).toEqual(expect.arrayContaining([{ table: 'profile_post_comments', op: 'is', args: ['deleted_at', null] }]));
  });
  test('nothing live to delete → false', async () => {
    rows = [];
    expect(await softDeleteProfileComment('k1', 'u1', 'author')).toBe(false);
  });
  test('the placeholder: place and time, which kind, nothing said or who said it', () => {
    const own = asDeletedWallComment({ id: 'k1', created_at: 't', content: 'x', author_id: 'u', author: { name: 'A' }, deleted_reason: 'author' });
    expect(own).toMatchObject({ id: 'k1', created_at: 't', content: null, author_id: null, author: null, deleted: true, removed_by_wall_owner: false });
    expect(asDeletedWallComment({ deleted_reason: 'wall_owner' })).toMatchObject({ removed_by_wall_owner: true });
  });
});

describe('DELETE /profile-posts/comments/:commentId', () => {
  const f = () => fnBody(P, 'deleteProfilePostComment');
  test('soft, and whose delete: the author, or the wall owner removing someone else\'s', () => {
    expect(f()).not.toMatch(/\.delete\(\)/);
    expect(f()).toMatch(/const reason: WallCommentDeletedReason = row\.author_id === userId \? 'author' : 'wall_owner'/);
    expect(f()).toMatch(/softDeleteProfileComment\(commentId, userId, reason\)/);
  });
  test('only the author or the wall owner may (403 otherwise), and not twice (404)', () => {
    expect(f()).toMatch(/Not yours to delete/);
    expect(f()).toMatch(/row\.deleted_at\) return res\.status\(404\)/);
  });
});

describe('where it must not show', () => {
  test('the thread: a placeholder in its place; COMMENTS · N counts live only; paging counts all', () => {
    const l = fnBody(P, 'listProfilePostComments');
    expect(l).toMatch(/deleted_at \? asDeletedWallComment\(/);
    expect(l).toMatch(/\.eq\('post_id', id\)\s*\.is\('deleted_at', null\)/);
    expect(l).toMatch(/has_more: offset \+ rows\.length < all/);
  });
  test('the post\'s comments_count: the trigger fires on deleted_at (migration 105)', () => {
    const sql = fs.readFileSync(path.join(__dirname, '..', '..', 'supabase', 'migrations', '105_soft_delete_profile_post_comments.sql'), 'utf8');
    expect(sql).toMatch(/AFTER INSERT OR DELETE OR UPDATE OF deleted_at ON profile_post_comments/);
    expect(sql).toMatch(/OLD\.deleted_at IS NULL AND NEW\.deleted_at IS NOT NULL THEN\s*UPDATE profile_posts SET comments_count = GREATEST\(comments_count - 1, 0\)/);
    expect(sql).toMatch(/ELSIF \(TG_OP = 'DELETE'\) THEN\s*IF OLD\.deleted_at IS NULL THEN/);
    expect(sql).toMatch(/deleted_reason IN \('author', 'wall_owner'\)/);
  });
  test('notifications and search never carried wall comments (controls: they carry community ones)', () => {
    expect(code(P)).not.toMatch(/notify|notifications/);
    expect(code('controllers/community.controller.ts')).toMatch(/notifyEngagement/);
    expect(code('controllers/search.controller.ts')).not.toMatch(/profile_post/);
    expect(code('controllers/search.controller.ts')).toMatch(/community_posts/);
  });
});

describe('nothing can be done to it', () => {
  test('wall comments have no like, reply or edit at all (controls: the comment routes that do exist)', () => {
    const r = fs.readFileSync(path.join(__dirname, '..', 'routes', 'profilePosts.routes.ts'), 'utf8');
    expect(r).not.toMatch(/comments\/:commentId\/(like|react|reply)|router\.(patch|put)\('\/comments/);
    expect(r).toMatch(/router\.delete\('\/comments\/:commentId'/);
    expect(r).toMatch(/router\.post\('\/:id\/comments'/);
    const sql = fs.readFileSync(path.join(__dirname, '..', '..', 'supabase', 'migrations', '075_profile_posts.sql'), 'utf8');
    const table = sql.slice(sql.indexOf('CREATE TABLE IF NOT EXISTS profile_post_comments'), sql.indexOf(');', sql.indexOf('CREATE TABLE IF NOT EXISTS profile_post_comments')));
    expect(table).not.toMatch(/parent_id/);
  });
});

describe('migration 105', () => {
  test('schema only; nothing deleted', () => {
    const sql = fs.readFileSync(path.join(__dirname, '..', '..', 'supabase', 'migrations', '105_soft_delete_profile_post_comments.sql'), 'utf8');
    expect(sql).toMatch(/ALTER TABLE profile_post_comments ADD COLUMN IF NOT EXISTS deleted_at\s+timestamptz;/);
    expect(sql.replace(/--.*$/gm, '').replace(/ON DELETE SET NULL/g, '').replace(/OR DELETE OR/g, '').replace(/TG_OP = 'DELETE'/g, '').replace(/DROP TRIGGER IF EXISTS trg_profile_post_comments/g, ''))
      .not.toMatch(/\bDELETE\b|\bDROP\b|\bTRUNCATE\b/i);
  });
});
