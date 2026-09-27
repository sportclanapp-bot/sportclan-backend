/**
 * Hard-delete list #3 (27 Sep 2026) · a moderator's "Remove content" is a
 * soft delete told apart from the author's own, and restorable (migration 103).
 */
import fs from 'fs';
import path from 'path';

const calls: Array<{ table: string; op: string; args: unknown[] }> = [];
let readRow: unknown = null;
let updateRows: unknown[] = [{ id: 'x' }];
jest.mock('../utils/supabase', () => ({
  supabase: {
    from: (table: string) => {
      const q: any = {};
      let mode = 'read';
      const rec = (op: string) => (...args: unknown[]) => { calls.push({ table, op, args }); return q; };
      for (const op of ['select', 'eq', 'is', 'in', 'neq']) q[op] = rec(op);
      q.update = (...args: unknown[]) => { mode = 'update'; calls.push({ table, op: 'update', args }); return q; };
      q.delete = (...args: unknown[]) => { calls.push({ table, op: 'delete', args }); return q; };
      q.maybeSingle = () => Promise.resolve({ data: readRow, error: null });
      q.then = (resolve: (v: unknown) => void) =>
        resolve(mode === 'update' && table !== 'notifications' ? { data: updateRows, error: null } : { data: [], error: null });
      return q;
    },
  },
}));
// eslint-disable-next-line import/first
import {
  softDeletePost, softDeleteComment, restoreRemovedContent, postGone, commentGone, isModeratorRemoval,
  POST_REMOVED, COMMENT_REMOVED, POST_DELETED, COMMENT_DELETED, asDeletedPlaceholder,
} from '../utils/postVisibility';

const code = (f: string) =>
  fs.readFileSync(path.join(__dirname, '..', f), 'utf8').replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*$/gm, '');
const fnBody = (f: string, name: string) => {
  const s = code(f);
  const i = s.indexOf(`function ${name}(`);
  if (i < 0) throw new Error(`${name} not found`);
  const j = s.indexOf('\nexport ', i + 10);
  return s.slice(i, j < 0 ? undefined : j);
};

beforeEach(() => { calls.length = 0; readRow = null; updateRows = [{ id: 'x' }]; });

describe('who took it down is recorded, apart from an author\'s delete', () => {
  test('an author\'s delete writes reason "author"; a moderator\'s writes "moderator" and who', async () => {
    await softDeletePost('p1', 'u1', { authorId: 'u1' });
    expect(calls.find((c) => c.op === 'update' && c.table === 'community_posts')?.args[0]).toMatchObject({ deleted_by: 'u1', deleted_reason: 'author' });
    calls.length = 0;
    await softDeletePost('p1', 'admin1', { reason: 'moderator' });
    expect(calls.find((c) => c.op === 'update' && c.table === 'community_posts')?.args[0]).toMatchObject({ deleted_by: 'admin1', deleted_reason: 'moderator' });
    calls.length = 0;
    await softDeleteComment('c1', 'admin1', { reason: 'moderator' });
    expect(calls.find((c) => c.op === 'update' && c.table === 'post_comments')?.args[0]).toMatchObject({ deleted_by: 'admin1', deleted_reason: 'moderator' });
    expect(calls.some((c) => c.op === 'delete')).toBe(false);
  });
  test('what users read', () => {
    expect(POST_REMOVED).toEqual({ error: 'This post was removed by a moderator', code: 'POST_REMOVED' });
    expect(COMMENT_REMOVED).toEqual({ error: 'This comment was removed by a moderator', code: 'COMMENT_REMOVED' });
    expect(postGone({ deleted_at: 't', deleted_reason: 'moderator' })).toBe(POST_REMOVED);
    expect(postGone({ deleted_at: 't', deleted_reason: 'author' })).toBe(POST_DELETED);
    expect(postGone({ deleted_at: 't', deleted_reason: null })).toBe(POST_DELETED); // pre-103 rows
    expect(commentGone({ removed: true })).toBe(COMMENT_REMOVED);
    expect(commentGone({ deleted_at: 't' })).toBe(COMMENT_DELETED);
    expect(isModeratorRemoval({ deleted_at: null, deleted_reason: 'moderator' })).toBe(false);
    expect(asDeletedPlaceholder({ deleted_reason: 'moderator' })).toMatchObject({ removed_by_moderator: true, deleted: true });
    expect(asDeletedPlaceholder({ deleted_reason: 'author' })).toMatchObject({ removed_by_moderator: false });
  });
});

describe('restore', () => {
  test('brings a moderator-removed post back, and exactly the notifications its removal hid', async () => {
    readRow = { deleted_at: '2026-09-27T10:00:00.000Z', deleted_reason: 'moderator' };
    expect(await restoreRemovedContent('post', 'p1')).toBe(true);
    expect(calls.find((c) => c.op === 'update' && c.table === 'community_posts')?.args[0])
      .toEqual({ deleted_at: null, deleted_by: null, deleted_reason: null });
    expect(calls).toEqual(expect.arrayContaining([
      { table: 'community_posts', op: 'eq', args: ['deleted_reason', 'moderator'] },
      { table: 'notifications', op: 'update', args: [{ hidden_at: null }] },
      { table: 'notifications', op: 'eq', args: ['data->>post_id', 'p1'] },
      // only those hidden BY this removal — a separately deleted comment stays hidden
      { table: 'notifications', op: 'eq', args: ['hidden_at', '2026-09-27T10:00:00.000Z'] },
    ]));
  });
  test('a comment the same way (its count comes back through the trigger, migration 102)', async () => {
    readRow = { deleted_at: '2026-09-27T10:00:00.000Z', deleted_reason: 'moderator' };
    expect(await restoreRemovedContent('comment', 'c1')).toBe(true);
    expect(calls).toEqual(expect.arrayContaining([
      { table: 'post_comments', op: 'update', args: [{ deleted_at: null, deleted_by: null, deleted_reason: null }] },
      { table: 'notifications', op: 'eq', args: ['data->>comment_id', 'c1'] },
    ]));
  });
  test('an author\'s own delete is not restorable; a live post has nothing to restore', async () => {
    readRow = { deleted_at: 't', deleted_reason: 'author' };
    expect(await restoreRemovedContent('post', 'p1')).toBe(false);
    readRow = { deleted_at: null, deleted_reason: null };
    expect(await restoreRemovedContent('post', 'p1')).toBe(false);
    expect(calls.some((c) => c.op === 'update')).toBe(false);
  });
});

describe('PATCH /admin/reports/:id', () => {
  const R = () => fnBody('controllers/admin.controller.ts', 'resolveReport');
  test('remove is the moderator soft delete, never .delete()', () => {
    const f = R();
    expect(f).not.toMatch(/\.delete\(\)/);
    expect(f).toMatch(/softDeletePost\(report\.target_id, adminId, \{ reason: 'moderator' \}\)/);
    expect(f).toMatch(/softDeleteComment\(report\.target_id, adminId, \{ reason: 'moderator' \}\)/);
  });
  test('the report records the action; the other open reports stay, marked actioned through it', () => {
    const f = R();
    expect(f).toMatch(/update\(resolution\('removed'\)\)\.eq\('id', id\)/);
    expect(f).toMatch(/update\(\{ \.\.\.resolution\('removed'\), actioned_via: id \}\)[\s\S]*?\.eq\('resolved', false\)\s*\.neq\('id', id\)/);
    expect(f).toMatch(/update\(resolution\('dismissed'\)\)\.eq\('id', id\)/);
    expect(f).toMatch(/resolved_action \}\)/); // resolved, resolved_at, resolved_by, resolved_action
  });
  test('restore: only a moderator removal; its reports read "restored"; both are audited', () => {
    const f = R();
    expect(f).toMatch(/restoreRemovedContent\(type, report\.target_id\)/);
    expect(f).toMatch(/code: 'NOT_REMOVED'/);
    expect(f).toMatch(/update\(resolution\('restored'\)\)[\s\S]*?\.eq\('resolved_action', 'removed'\)/);
    expect(f).toMatch(/logAdminAction\(adminId, `remove_\$\{type\}`/);
    expect(f).toMatch(/logAdminAction\(adminId, `restore_\$\{type\}`/);
  });
  test('an author-deleted post can\'t be "removed" again', () => {
    expect(R()).toMatch(/target\.deleted && !target\.removed[\s\S]*?code: 'ALREADY_DELETED'/);
  });
  test('the queue: open by default, ?status=actioned lists resolved ones with the action and restorability', () => {
    const f = fnBody('controllers/admin.controller.ts', 'getReports');
    expect(f).toMatch(/const actioned = req\.query\.status === 'actioned'/);
    expect(f).toMatch(/\.eq\('resolved', actioned\)/);
    expect(f).toMatch(/resolved_action, actioned_via/);
    expect(f).toMatch(/content_removed_by_moderator = isModeratorRemoval\(p\)/);
    expect(f).toMatch(/content_removed_by_moderator = isModeratorRemoval\(c\)/);
  });
});

describe('users read "removed by a moderator" wherever #1 / #2 say "deleted"', () => {
  const C = 'controllers/community.controller.ts';
  test('no refusal in the community controller hard-codes the author wording', () => {
    const s = code(C);
    expect(s).not.toMatch(/json\(POST_DELETED\)|json\(COMMENT_DELETED\)/);
    expect(s.match(/json\(postGone\(/g)!.length).toBeGreaterThanOrEqual(9);
    expect(s.match(/json\(commentGone\(/g)!.length).toBeGreaterThanOrEqual(3);
  });
  test('a link to the post', () => expect(fnBody(C, 'getPost')).toMatch(/json\(postGone\(data/));
});

describe('migration 103', () => {
  const sql = fs.readFileSync(path.join(__dirname, '..', '..', 'supabase', 'migrations', '103_moderator_removal.sql'), 'utf8');
  test('schema only; nothing deleted', () => {
    expect(sql).toMatch(/ALTER TABLE community_posts ADD COLUMN IF NOT EXISTS deleted_reason text;/);
    expect(sql).toMatch(/ALTER TABLE post_comments\s+ADD COLUMN IF NOT EXISTS deleted_reason text;/);
    expect(sql).toMatch(/ALTER TABLE content_reports ADD COLUMN IF NOT EXISTS resolved_action text;/);
    expect(sql).toMatch(/ADD COLUMN IF NOT EXISTS actioned_via uuid REFERENCES content_reports\(id\)/);
    expect(sql).toMatch(/deleted_reason IN \('author', 'moderator'\)/);
    expect(sql).toMatch(/resolved_action IN \('dismissed', 'removed', 'restored'\)/);
    expect(sql.replace(/--.*$/gm, '').replace(/ON DELETE SET NULL/g, '')).not.toMatch(/\bDELETE\b|\bDROP\b|\bTRUNCATE\b/i);
  });
});
