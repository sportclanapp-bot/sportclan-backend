/**
 * Hard-delete list #1 (27 Sep 2026) · DELETE /community/posts/:id is a soft
 * delete (migration 101). Behaviour of the helper against a fake supabase, and
 * every place a deleted post must not show for a normal user.
 */
import fs from 'fs';
import path from 'path';

const calls: Array<{ table: string; op: string; args: unknown[] }> = [];
let updateReturns: unknown[] = [{ id: 'p1' }];
jest.mock('../utils/supabase', () => ({
  supabase: {
    from: (table: string) => {
      const q: any = {};
      const rec = (op: string) => (...args: unknown[]) => { calls.push({ table, op, args }); return q; };
      for (const op of ['select', 'eq', 'is', 'in', 'maybeSingle']) q[op] = rec(op);
      q.update = (...args: unknown[]) => { calls.push({ table, op: 'update', args }); return q; };
      q.delete = (...args: unknown[]) => { calls.push({ table, op: 'delete', args }); return q; };
      q.then = (resolve: (v: unknown) => void) =>
        resolve(table === 'community_posts' ? { data: updateReturns, error: null } : { data: [], error: null });
      return q;
    },
  },
}));
// eslint-disable-next-line import/first
import { softDeletePost, livePosts, isDeletedPost, POST_DELETED } from '../utils/postVisibility';

const code = (f: string) =>
  fs.readFileSync(path.join(__dirname, '..', f), 'utf8').replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*$/gm, '');
const fnBody = (f: string, name: string) => {
  const s = code(f);
  const i = s.indexOf(`function ${name}(`);
  if (i < 0) throw new Error(`${name} not found`);
  const j = s.indexOf('\nexport ', i + 10);
  return s.slice(i, j < 0 ? undefined : j);
};

beforeEach(() => { calls.length = 0; updateReturns = [{ id: 'p1' }]; });

describe('softDeletePost', () => {
  test('marks the post (never deletes it) and hides its notifications', async () => {
    expect(await softDeletePost('p1', 'u1', { authorId: 'u1' })).toBe(true);
    expect(calls.some((c) => c.op === 'delete')).toBe(false);
    const upd = calls.find((c) => c.table === 'community_posts' && c.op === 'update');
    expect(upd?.args[0]).toMatchObject({ deleted_by: 'u1' });
    expect((upd?.args[0] as { deleted_at: string }).deleted_at).toMatch(/^\d{4}-/);
    // only a live post, only the author's
    expect(calls).toEqual(expect.arrayContaining([
      { table: 'community_posts', op: 'is', args: ['deleted_at', null] },
      { table: 'community_posts', op: 'eq', args: ['author_id', 'u1'] },
    ]));
    const hide = calls.find((c) => c.table === 'notifications' && c.op === 'update');
    expect(Object.keys(hide?.args[0] as object)).toEqual(['hidden_at']);
    expect(calls).toEqual(expect.arrayContaining([
      { table: 'notifications', op: 'eq', args: ['data->>post_id', 'p1'] },
    ]));
  });
  test('nothing to delete (missing, not yours, already deleted) → false, notifications untouched', async () => {
    updateReturns = [];
    expect(await softDeletePost('p1', 'u2', { authorId: 'u2' })).toBe(false);
    expect(calls.some((c) => c.table === 'notifications')).toBe(false);
  });
  test('helpers', () => {
    const q: any = { is: jest.fn(() => 'filtered') };
    expect(livePosts(q)).toBe('filtered');
    expect(q.is).toHaveBeenCalledWith('deleted_at', null);
    expect(isDeletedPost({ deleted_at: '2026-09-27' })).toBe(true);
    expect(isDeletedPost({ deleted_at: null })).toBe(false);
    expect(POST_DELETED).toEqual({ error: 'This post was deleted', code: 'POST_DELETED' });
  });
});

describe('DELETE /community/posts/:id is the soft delete', () => {
  test('deletePost calls softDeletePost and never .delete()', () => {
    const f = fnBody('controllers/community.controller.ts', 'deletePost');
    expect(f).toMatch(/softDeletePost\(id, userId, \{ authorId: userId \}\)/);
    expect(f).not.toMatch(/\.delete\(\)/);
  });
});

describe('a deleted post does not show for a normal user', () => {
  const C = 'controllers/community.controller.ts';
  test('feeds (For you, Following, Tournaments, trending) and the profile grid', () => {
    const f = fnBody(C, 'listPosts');
    expect(f).toMatch(/q = livePosts\(q\);/);
    expect(f).toMatch(/cq = livePosts\(cq\);/); // the grid's total
  });
  test('the stories-row counts', () => expect(fnBody(C, 'getSportStoryCounts')).toMatch(/query = livePosts\(query\);/));
  test('the post count', () => expect(fnBody(C, 'getMyPostCount')).toMatch(/\.is\('deleted_at', null\)/));
  test('a deep link: 410 POST_DELETED, unless the viewer is an admin', () => {
    const f = fnBody(C, 'getPost');
    expect(f).toMatch(/isDeletedPost\(data[\s\S]*?!\(req\.userId && \(await isAdminUser\(req\.userId\)\)\)[\s\S]*?status\(410\)\.json\(POST_DELETED\)/);
  });
  test('its comments: 410 unless admin', () => {
    expect(fnBody(C, 'listComments')).toMatch(/postForWrite\(id\)\)\?\.deleted && !\(req\.userId && \(await isAdminUser\(req\.userId\)\)\)/);
  });
  test('search', () => {
    const s = code('controllers/search.controller.ts');
    const i = s.indexOf('async function searchPosts');
    expect(s.slice(i, i + 1200)).toMatch(/\.is\('deleted_at', null\)/);
  });
  test('notifications: the list, the unread badge and the filter chips skip hidden ones', () => {
    const f = fnBody('controllers/notifications.controller.ts', 'listNotifications');
    expect(f.match(/\.is\('hidden_at', null\)/g)?.length).toBe(3);
  });
  test('the weekly digest, badge progress and the scheduled-post publisher', () => {
    expect(fnBody('controllers/notifications.controller.ts', 'weeklyDigest')).toMatch(/\.is\('deleted_at', null\)/);
    expect(fnBody('controllers/badges.controller.ts', 'evaluateBadgesForUser')).toMatch(/\.is\('deleted_at', null\)/);
    expect(fnBody('controllers/features.controller.ts', 'runPublishScheduledPosts')).toMatch(/\.is\('deleted_at', null\)/);
  });
});

describe('nothing can be done to a deleted post', () => {
  const C = 'controllers/community.controller.ts';
  test.each([
    ['likePost', /likePostRow\.deleted\) return res\.status\(410\)/],
    ['unlikePost', /postForWrite\(id\)\)\?\.deleted\) return res\.status\(410\)/],
    ['createComment', /commentPostRow\.deleted\) return res\.status\(410\)/],
    ['reactToComment', /postForWrite\(comment\.post_id as string\)\)\?\.deleted\) return res\.status\(410\)/],
    ['votePoll', /isDeletedPost\(post\)\) return res\.status\(410\)/],
    ['updatePost', /editTarget\?\.deleted[\s\S]*?status\(410\)[\s\S]*?\.is\('deleted_at', null\)/],
    ['closePost', /\.is\('deleted_at', null\)/],
    ['reportContent', /t\?\.deleted\) return res\.status\(410\)[\s\S]*?cpost && \(await postForWrite\(cpost\)\)\?\.deleted\) return res\.status\(410\)/],
  ])('%s refuses', (name, re) => expect(fnBody(C, name as string)).toMatch(re as RegExp));
});

describe('admins still see it, with its reports', () => {
  test('the report queue reads deleted posts and says when and by whom', () => {
    const f = fnBody('controllers/admin.controller.ts', 'getReports');
    expect(f).toMatch(/select\('id, content, author_id, deleted_at, deleted_by'\)/);
    expect(f).toMatch(/content_deleted_by_author = !!p\?\.deleted_at && p\.deleted_by === p\.author_id/);
  });
  test('the owner\'s data export keeps their deleted posts, marked', () => {
    expect(code('controllers/account.controller.ts')).toMatch(/'id, content, image_url, created_at, deleted_at'/);
  });
});

describe('migration 101', () => {
  const sql = fs.readFileSync(path.join(__dirname, '..', '..', 'supabase', 'migrations', '101_soft_delete_community_posts.sql'), 'utf8');
  test('adds the columns and indexes, deletes nothing', () => {
    expect(sql).toMatch(/ALTER TABLE community_posts ADD COLUMN IF NOT EXISTS deleted_at timestamptz;/);
    expect(sql).toMatch(/ALTER TABLE community_posts ADD COLUMN IF NOT EXISTS deleted_by uuid/);
    expect(sql).toMatch(/ALTER TABLE notifications\s+ADD COLUMN IF NOT EXISTS hidden_at\s+timestamptz;/);
    expect(sql).toMatch(/idx_community_posts_live_feed[\s\S]*WHERE deleted_at IS NULL/);
    expect(sql).toMatch(/idx_notifications_post_id[\s\S]*\(\(data->>'post_id'\)\)/);
    // (ON DELETE SET NULL is the foreign key's rule, not a delete)
    expect(sql.replace(/--.*$/gm, '').replace(/ON DELETE SET NULL/g, '')).not.toMatch(/\bDELETE\b|\bDROP\b|\bTRUNCATE\b/i);
  });
});
