/**
 * F-63 / D7 · a person you have blocked must not be listed back to you.
 *
 * Every people-listing endpoint carries two filters of DIFFERENT classes:
 *
 *   deleted_at  — absolute. A deleted account is hidden from everyone, so it is
 *                 a query predicate (activeUser.ts).
 *   user_blocks — relative. It depends on who is asking, so it is a per-request
 *                 id-set exclusion keyed on the viewer (blocks.ts).
 *
 * /services had NEITHER. It was the last one, which is exactly how it survived:
 * every review of "do we filter blocks?" looked at the controllers, and the
 * services directory is the app's only list that lives in a route file.
 *
 * This is a source-level sweep on purpose. A behavioural test proves one query
 * is filtered on the day it is written; this proves the NEXT list added to any
 * of these files cannot quietly ship without both.
 */
import fs from 'fs';
import path from 'path';

const read = (rel: string) =>
  fs.readFileSync(path.join(__dirname, '..', rel), 'utf8')
    // A guard its own documentation can fail is a guard people delete: strip
    // comments so a sentence ABOUT blocking never counts as blocking.
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/^\s*\/\/.*$/gm, '');

/** Every file that renders a list of OTHER PEOPLE to a viewer. */
const PEOPLE_LISTS: [string, string][] = [
  ['routes/services.routes.ts', 'the coach / umpire / organiser directory (F-63)'],
  ['controllers/search.controller.ts', 'search results, all tabs'],
  ['controllers/users.controller.ts', 'discovery, rivals, followers, following, reviews'],
  ['controllers/community.controller.ts', 'feed authors and commenters'],
  ['controllers/kudos.controller.ts', 'who gave kudos'],
  ['controllers/teams.controller.ts', 'team rosters'],
  ['controllers/matchJoinRequests.controller.ts', 'who asked to join your match'],
];

describe('every people list applies both filter classes', () => {
  it.each(PEOPLE_LISTS)('%s — %s', (rel) => {
    const src = read(rel);
    expect(src).toMatch(/blockedUserIds|isBlockedBetween/);
    expect(src).toMatch(/excludeDeleted|deletedIdSet|deleted_at/);
  });
});

describe('the services directory specifically', () => {
  const src = read('routes/services.routes.ts');

  it('excludes people blocked in EITHER direction', () => {
    // blockedUserIds is already bidirectional; using it is the whole assertion.
    expect(src).toContain('blockedUserIds(req.userId)');
    expect(src).toContain("excludeIds(q, 'user_id', blocked)");
  });

  it('excludes soft-deleted accounts, which it never did', () => {
    // Without this a deleted coach stayed in the directory under the scrubbed
    // name "Deleted User", with a Contact button.
    expect(src).toContain("is('users.deleted_at', null)");
  });

  it('filters in the QUERY, so the count is not a lie', () => {
    // A post-filter in JS would report "24 coaches" and render 22.
    expect(src).toContain("{ count: 'exact' }");
    const filter = src.indexOf('excludeIds(q');
    const await_ = src.indexOf('await q;');
    expect(filter).toBeGreaterThan(-1);
    expect(filter).toBeLessThan(await_);
  });

  it('still lists providers who never paid (SC-434 stays fixed)', () => {
    expect(src).not.toContain("eq('users.is_premium', true)");
  });
});

describe('what this sweep deliberately does NOT cover', () => {
  it('the leaderboard hides deleted accounts but not blocked ones', () => {
    // On purpose. A ranking is a statement about a competition, not a list of
    // people to contact; punching a viewer-shaped hole in it would renumber
    // everyone below and make two players disagree about who is third.
    const src = read('controllers/leaderboard.controller.ts');
    expect(src).toMatch(/deletedIdSet/);
    expect(src).not.toMatch(/blockedUserIds/);
  });

  it('notifications are block-gated when SENT, not when listed', () => {
    // SC-134 drops the recipient at fan-out time. A notification you received
    // before you blocked someone stays in your inbox — it is a record of
    // something that happened, and it carries no route back to them.
    const src = read('utils/notify.ts');
    expect(src).toContain('blockedUserIds(actorId)');
  });
});
