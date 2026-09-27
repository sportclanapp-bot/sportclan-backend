/**
 * Hard-delete list #4 (27 Sep 2026) · DELETE /profilePosts/:id is a soft delete
 * (migration 104). Helper behaviour, and every place a deleted wall post must
 * not show or be acted on.
 */
import fs from 'fs';
import path from 'path';

const calls: Array<{ table: string; op: string; args: unknown[] }> = [];
let rows: unknown[] = [{ id: 'w1' }];
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
import { softDeleteProfilePost } from '../utils/postVisibility';

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

beforeEach(() => { calls.length = 0; rows = [{ id: 'w1' }]; });

describe('softDeleteProfilePost', () => {
  test('marks the author\'s live wall post, never deletes it', async () => {
    expect(await softDeleteProfilePost('w1', 'u1')).toBe(true);
    expect(calls.some((c) => c.op === 'delete')).toBe(false);
    expect(calls.find((c) => c.op === 'update')?.args[0]).toMatchObject({ deleted_by: 'u1', deleted_reason: 'author' });
    expect(calls).toEqual(expect.arrayContaining([
      { table: 'profile_posts', op: 'eq', args: ['author_id', 'u1'] },
      { table: 'profile_posts', op: 'is', args: ['deleted_at', null] },
    ]));
  });
  test('nothing to delete (missing, not theirs, already deleted) → false', async () => {
    rows = [];
    expect(await softDeleteProfilePost('w1', 'u2')).toBe(false);
  });
});

describe('DELETE /profilePosts/:id', () => {
  test('is the soft delete; no .delete() left on wall posts', () => {
    const f = fnBody(P, 'deleteProfilePost');
    expect(f).toMatch(/softDeleteProfilePost\(id, userId\)/);
    expect(f).not.toMatch(/\.delete\(\)/);
  });
});

describe('a deleted wall post does not show', () => {
  test('the wall and its count', () => {
    const f = fnBody(P, 'listProfilePosts');
    expect(f.match(/\.is\('deleted_at', null\)/g)?.length).toBe(2);
  });
  test('the post screen: 410 "This post was deleted"', () => {
    expect(fnBody(P, 'getProfilePost')).toMatch(/deleted_at\) \{\s*return res\.status\(410\)\.json\(postGone\(/);
  });
  test('its comments: 410', () => {
    expect(fnBody(P, 'listProfilePostComments')).toMatch(/wallPost\?\.deleted\) return res\.status\(410\)/);
  });
  test('the post count', () => {
    expect(fnBody('controllers/community.controller.ts', 'getMyPostCount'))
      .toMatch(/from\('profile_posts'\)[\s\S]*?\.is\('deleted_at', null\)/);
  });
  test('no feed, search or notification ever carried wall posts (controls: they carry community posts)', () => {
    expect(code('controllers/search.controller.ts')).not.toMatch(/profile_post/);
    expect(code('controllers/search.controller.ts')).toMatch(/community_posts/);
    expect(code(P)).not.toMatch(/notify|notifications/);
    expect(code('controllers/community.controller.ts')).toMatch(/notifyEngagement/);
  });
});

describe('nothing can be done to it', () => {
  test.each([
    ['likeProfilePost', /target\.deleted\) return res\.status\(410\)/],
    ['unlikeProfilePost', /target\?\.deleted\) return res\.status\(410\)/],
    ['addProfilePostComment', /post\.deleted\) return res\.status\(410\)/],
    ['deleteProfilePostComment', /parentPost\?\.deleted\) return res\.status\(410\)/],
    ['updateProfilePost', /current\.deleted_at\) return res\.status\(410\)[\s\S]*?\.is\('deleted_at', null\)/],
  ])('%s refuses', (name, re) => expect(fnBody(P, name as string)).toMatch(re as RegExp));
  test('report: a deleted wall post can\'t be reported (wall posts became reportable on 27 Sep 2026, migration 108)', () => {
    const f = fnBody('controllers/community.controller.ts', 'reportContent');
    expect(f).toMatch(/resolvedType === 'profile_post'[\s\S]*?t\?\.deleted\) return res\.status\(410\)\.json\(postGone\(t\)\)/);
  });
});

describe('migration 104', () => {
  const sql = fs.readFileSync(path.join(__dirname, '..', '..', 'supabase', 'migrations', '104_soft_delete_profile_posts.sql'), 'utf8');
  test('schema only; nothing deleted', () => {
    expect(sql).toMatch(/ALTER TABLE profile_posts ADD COLUMN IF NOT EXISTS deleted_at\s+timestamptz;/);
    expect(sql).toMatch(/deleted_reason IN \('author', 'moderator'\)/);
    expect(sql).toMatch(/idx_profile_posts_live_wall[\s\S]*WHERE deleted_at IS NULL/);
    expect(sql.replace(/--.*$/gm, '').replace(/ON DELETE SET NULL/g, '')).not.toMatch(/\bDELETE\b|\bDROP\b|\bTRUNCATE\b/i);
  });
});
