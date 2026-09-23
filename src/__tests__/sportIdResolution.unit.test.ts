/**
 * SC-442 (M9/F-02) · registration accepts sport SLUGS, not only ids.
 *
 * The register screen holds its selection as slugs ('cricket') and posts them as
 * `sport_ids`, which are UUIDs everywhere else. user_sports therefore received
 * values no sport row matched, and a brand-new account came out with NO sports —
 * a step that enforces "pick at least one" silently discarded, after which the
 * profile-completion card asked the user to add the sports they had just picked.
 */
import fs from 'fs';
import path from 'path';

const src = fs.readFileSync(
  path.join(__dirname, '..', 'controllers', 'auth.controller.ts'), 'utf8',
);

describe('SC-442 · sport id resolution on registration', () => {
  test('a resolver exists and is used, not a raw insert', () => {
    expect(src).toContain('async function resolveSportIds(');
    expect(src).not.toMatch(/sport_ids\.map\(\(sid: string\) =>/);
  });

  test('the ONE registration path resolves', () => {
    // This used to assert BOTH paths (phone and email) so a fix to one could
    // not leave half of new accounts sportless. The email path was removed on
    // 23 Sep 2026 — phone is mandatory — so there is one path, and it resolves.
    const uses = src.split('resolveSportIds(sport_ids)').length - 1;
    expect(uses).toBe(1);
  });

  test('it reuses the resolver that already accepts either form', () => {
    // resolveSportId is how match creation has always taken 'cricket'.
    expect(src).toContain("from '../utils/sportId'");
    expect(src).toMatch(/const id = await resolveSportId\(v\)/);
  });

  test('unknown values are dropped, not inserted', () => {
    // A bad slug should cost one sport, not the whole registration.
    expect(src).toMatch(/if \(id && !out\.includes\(id\)\) out\.push\(id\)/);
  });

  test('and duplicates cannot be written twice', () => {
    expect(src).toContain('!out.includes(id)');
  });
});
