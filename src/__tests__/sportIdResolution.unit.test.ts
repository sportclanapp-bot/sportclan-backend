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

  test('BOTH registration paths resolve — phone and email', () => {
    // Fixing only one would leave half the new accounts sportless, which is
    // harder to notice than fixing neither.
    const uses = src.split('resolveSportIds(sport_ids)').length - 1;
    expect(uses).toBe(2);
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
