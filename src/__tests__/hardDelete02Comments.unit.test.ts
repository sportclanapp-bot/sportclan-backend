/**
 * Hard-delete list #2 (27 Sep 2026) · DELETE /community/comments/:commentId is
 * a soft delete (migration 102). Helper behaviour against a fake supabase, and
 * every place a deleted comment must not show for a normal user.
 */
import fs from 'fs';
import path from 'path';

const calls: Array<{ table: string; op: string; args: unknown[] }> = [];
let updateReturns: unknown[] = [{ id: 'c1' }];
jest.mock('../utils/supabase', () => ({
  supabase: {
    from: (table: string) => {
      const q: any = {};
      const rec = (op: string) => (...args: unknown[]) => { calls.push({ table, op, args }); return q; };
      for (const op of ['select', 'eq', 'is', 'in', 'maybeSingle', 'update', 'delete']) q[op] = rec(op);
      q.then = (resolve: (v: unknown) => void) =>
        resolve(table === 'post_comments' ? { data: updateReturns, error: null } : { data: [], error: null });
      return q;
    },
  },
}));
// eslint-disable-next-line import/first
import { softDeleteComment, asDeletedPlaceholder, COMMENT_DELETED } from '../utils/postVisibility';

const code = (f: string) =>
  fs.readFileSync(path.join(__dirname, '..', f), 'utf8').replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*$/gm, '');
const fnBody = (f: string, name: string) => {
  const s = code(f);
  const i = s.indexOf(`function ${name}(`);
  if (i < 0) throw new Error(`${name} not found`);
  const j = s.indexOf('\nexport ', i + 10);
  return s.slice(i, j < 0 ? undefined : j);
};
const C = 'controllers/community.controller.ts';

beforeEach(() => { calls.length = 0; updateReturns = [{ id: 'c1' }]; });

describe('softDeleteComment', () => {
  test('marks the comment (never deletes it) and hides its notifications', async () => {
    expect(await softDeleteComment('c1', 'u1', { authorId: 'u1' })).toBe(true);
    expect(calls.some((c) => c.op === 'delete')).toBe(false);
    const upd = calls.find((c) => c.table === 'post_comments' && c.op === 'update');
    expect(upd?.args[0]).toMatchObject({ deleted_by: 'u1' });
    expect(calls).toEqual(expect.arrayContaining([
      { table: 'post_comments', op: 'is', args: ['deleted_at', null] },
      { table: 'post_comments', op: 'eq', args: ['author_id', 'u1'] },
      { table: 'notifications', op: 'eq', args: ['data->>comment_id', 'c1'] },
    ]));
    expect(Object.keys(calls.find((c) => c.table === 'notifications' && c.op === 'update')?.args[0] as object)).toEqual(['hidden_at']);
  });
  test('nothing to delete → false, notifications untouched', async () => {
    updateReturns = [];
    expect(await softDeleteComment('c1', 'u2', { authorId: 'u2' })).toBe(false);
    expect(calls.some((c) => c.table === 'notifications')).toBe(false);
  });
  test('the placeholder keeps its place and time, and drops what it said and who said it', () => {
    const p = asDeletedPlaceholder({ id: 'c1', post_id: 'p', parent_id: null, created_at: 't', content: 'rude', author_id: 'u', author: { name: 'X' }, mentions: ['m'], reactions: { '🔥': ['u'] }, deleted_at: 'd' });
    expect(p).toMatchObject({ id: 'c1', post_id: 'p', created_at: 't', content: null, author_id: null, author: null, mentions: [], reactions: {}, deleted: true });
    expect(COMMENT_DELETED).toEqual({ error: 'This comment was deleted', code: 'COMMENT_DELETED' });
  });
});

describe('DELETE /community/comments/:commentId is the soft delete', () => {
  test('deleteComment calls softDeleteComment and never .delete()', () => {
    const f = fnBody(C, 'deleteComment');
    expect(f).toMatch(/softDeleteComment\(commentId, userId, \{ authorId: userId \}\)/);
    expect(f).not.toMatch(/\.delete\(\)/);
  });
});

describe('in its thread, and in counts', () => {
  test('a normal user gets the placeholder; an admin gets the text', () => {
    const f = fnBody(C, 'listComments');
    expect(f).toMatch(/deleted_at && !admin\s*\?\s*asDeletedPlaceholder/);
    expect(f).toMatch(/const admin = !!req\.userId && \(await isAdminUser\(req\.userId\)\)/);
  });
  test('the COMMENTS · N total counts live comments only; paging still counts the placeholders', () => {
    const f = fnBody(C, 'listComments');
    expect(f).toMatch(/\.eq\('post_id', id\)\s*\.is\('deleted_at', null\)/);
    expect(f).toMatch(/const total = live\.count/);
    expect(f).toMatch(/has_more: lcp\.from \+ rows\.length < all/);
    // the live count hides the same blocked and test authors as the list
    expect(f).toMatch(/lq = excludeIds\(lq, 'author_id', blocked\);\s*if \(hideTest\) lq = excludeTestEmbed\(lq, 'author'\);/);
  });
  test('the post\'s comments_count: the trigger fires on deleted_at (migration 102)', () => {
    const sql = fs.readFileSync(path.join(__dirname, '..', '..', 'supabase', 'migrations', '102_soft_delete_post_comments.sql'), 'utf8');
    expect(sql).toMatch(/AFTER INSERT OR DELETE OR UPDATE OF deleted_at ON post_comments/);
    expect(sql).toMatch(/OLD\.deleted_at IS NULL AND NEW\.deleted_at IS NOT NULL THEN\s*UPDATE community_posts SET comments_count = GREATEST\(comments_count - 1, 0\)/);
    expect(sql).toMatch(/OLD\.deleted_at IS NOT NULL AND NEW\.deleted_at IS NULL THEN\s*UPDATE community_posts SET comments_count = comments_count \+ 1/);
    // a hard delete after a soft delete is not subtracted twice
    expect(sql).toMatch(/ELSIF TG_OP = 'DELETE' THEN\s*IF OLD\.deleted_at IS NULL THEN/);
    expect(sql).toMatch(/ADD COLUMN IF NOT EXISTS deleted_at timestamptz/);
    expect(sql).toMatch(/idx_notifications_comment_id[\s\S]*\(\(data->>'comment_id'\)\)/);
    expect(sql.replace(/--.*$/gm, '').replace(/ON DELETE SET NULL/g, '').replace(/OR DELETE OR/g, '').replace(/TG_OP = 'DELETE'/g, '').replace(/DROP TRIGGER IF EXISTS trg_post_comments_count/g, ''))
      .not.toMatch(/\bDELETE\b|\bDROP\b|\bTRUNCATE\b/i);
  });
  test('notifications about it are hidden — the list, badge and chips skip hidden_at (#1)', () => {
    expect(fnBody('controllers/notifications.controller.ts', 'listNotifications').match(/\.is\('hidden_at', null\)/g)?.length).toBe(3);
  });
  test('search never reads comments (control: it reads posts)', () => {
    const s = code('controllers/search.controller.ts');
    expect(s).not.toMatch(/post_comments/);
    expect(s).toMatch(/community_posts/);
  });
});

describe('nothing can be done to a deleted comment', () => {
  test('react', () => expect(fnBody(C, 'reactToComment')).toMatch(/comment\.deleted_at\) return res\.status\(410\)\.json\(commentGone\(comment\)\)/));
  test('reply', () => expect(fnBody(C, 'createComment')).toMatch(/parentRow\.deleted\) return res\.status\(410\)\.json\(commentGone\(parentRow\)\)/));
  test('report', () => expect(fnBody(C, 'reportContent')).toMatch(/crow\?\.deleted_at\) return res\.status\(410\)\.json\(commentGone\(crow\)\)/));
  test('edit: there is no comment-edit route (control: one PATCH route exists)', () => {
    const r = fs.readFileSync(path.join(__dirname, '..', 'routes', 'community.routes.ts'), 'utf8');
    expect(r).not.toMatch(/router\.(patch|put)\('\/comments/);
    expect(r.match(/router\.patch\(/g)?.length).toBe(1);
  });
});

describe('admins still see it, with its reports', () => {
  test('the report queue reads deleted comments and says when and by whom', () => {
    const f = fnBody('controllers/admin.controller.ts', 'getReports');
    expect(f).toMatch(/from\('post_comments'\)\.select\('id, content, author_id, deleted_at, deleted_by, deleted_reason'\)/);
    expect(f).toMatch(/content_deleted_by_author = !!c\?\.deleted_at && !content_removed_by_moderator && c\.deleted_by === c\.author_id/);
  });
});
