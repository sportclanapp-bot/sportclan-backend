/**
 * B2-a · the deliberate list: what a deleted account hides, and what it leaves.
 *
 * There are two different questions, and SC-77 answered both with "hide it":
 *
 *   Is this a PERSON?   → hide. A deleted account must not be findable,
 *                          followable, rankable or messageable. Unchanged.
 *   Is this CONTENT they wrote? → keep, attributed to the scrubbed row.
 *
 * Conflating the two is what made the Delete account screen lie. It promises
 * "posts you made stay visible (without your name)" and "reviews you wrote
 * remain anonymous" — and an `!inner` join plus excludeDeletedEmbed drops the
 * PARENT row, so both promises were false from the moment anyone deleted their
 * account. This was never a 30-day-purge problem; it was live on day zero.
 *
 * Every read path is listed below with the choice made, so "we decided this
 * deliberately" is something a test can prove rather than something a commit
 * message claims.
 */
import fs from 'fs';
import path from 'path';

const read = (rel: string) =>
  fs.readFileSync(path.join(__dirname, '..', rel), 'utf8')
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/^\s*\/\/.*$/gm, '');

// ─── CONTENT · stays, attributed to "Deleted User" ──────────────────────────
describe('content by a deleted account STAYS', () => {
  it('community feed — the post is what people are reading', () => {
    const src = read('controllers/community.controller.ts');
    expect(src).not.toContain("excludeDeletedEmbed(q, 'author')");
  });

  it('a single post — one you can see in a list and not open is worse', () => {
    const src = read('controllers/community.controller.ts');
    expect(src).not.toContain("is('author.deleted_at', null)");
  });

  it('post comments — removing one rewrites the thread it was part of', () => {
    // Replies to a removed comment were left answering nothing.
    const src = read('controllers/community.controller.ts');
    expect(src).not.toMatch(/post_comments[\s\S]{0,400}author\.deleted_at/);
  });

  it('story counts — a count must agree with the list it counts', () => {
    const src = read('controllers/community.controller.ts');
    expect(src).not.toContain("excludeDeletedEmbed(query, 'author')");
  });

  it('post search — finding the phrase but not the post is the same bug', () => {
    const src = read('controllers/search.controller.ts');
    expect(src).not.toContain("excludeDeletedEmbed(query, 'author')");
  });

  it('reviews — the screen promises they stay, anonymously', () => {
    const src = read('controllers/users.controller.ts');
    expect(src).not.toMatch(/user_reviews[\s\S]{0,400}'reviewer'\)/);
  });

  it('and reviews still COUNT towards the provider’s average', () => {
    // A rating honestly given does not become wrong because the person who
    // gave it left. Hiding it silently rewrote a provider's reputation.
    const src = read('controllers/users.controller.ts');
    const agg = src.slice(src.indexOf('const { data: allRatings }'));
    expect(agg.slice(0, 300)).not.toContain('excludeDeletedEmbed');
  });

  it('every content embed carries deleted_at, so the app can drop the tap', () => {
    // The profile behind it 404s by design; offering the link would be a
    // control that knows it cannot complete.
    for (const [rel, count] of [
      ['controllers/community.controller.ts', 3],
      ['controllers/search.controller.ts', 1],
      ['controllers/users.controller.ts', 1],
    ] as const) {
      const hits = read(rel).match(/profile_picture_url, deleted_at\)/g)?.length ?? 0;
      expect(`${rel}:${hits >= count}`).toBe(`${rel}:true`);
    }
  });
});

// ─── PERSON · stays hidden, exactly as before ───────────────────────────────
describe('the PERSON stays hidden everywhere', () => {
  it.each([
    ['controllers/users.controller.ts', "excludeDeleted(supabase", 'their profile 404s'],
    ['controllers/users.controller.ts', "'users'), 'follower_id'", 'follower list'],
    ['controllers/users.controller.ts', "'users'), 'following_id'", 'following list'],
    ['controllers/community.controller.ts', 'excludeDeleted(supabase', '@mention picker'],
    ['controllers/search.controller.ts', 'excludeDeleted(supabase', 'people search'],
    ['controllers/teams.controller.ts', 'excludeDeletedEmbed(supabase', 'team rosters'],
    ['controllers/kudos.controller.ts', 'excludeDeletedEmbed(supabase', 'who praised you'],
    ['controllers/matchJoinRequests.controller.ts', 'excludeDeletedEmbed(supabase', 'join requests'],
    ['controllers/leaderboard.controller.ts', 'deletedIdSet', 'rankings'],
    ['controllers/insights.controller.ts', "is('deleted_at', null)", 'scorer lists'],
    ['routes/services.routes.ts', "is('users.deleted_at', null)", 'the provider directory'],
  ])('%s — %s (%s)', (rel, needle) => {
    expect(read(rel)).toContain(needle);
  });
});

// ─── The ones decided the other way, with the reason ────────────────────────
describe('deliberately NOT changed', () => {
  it('kudos stay hidden — the value of a kudos IS who gave it', () => {
    // Unlike a post, a kudos carries nothing anyone is reading for its own
    // sake: "Deleted User rated you highly" is a claim from nobody.
    expect(read('controllers/kudos.controller.ts')).toContain('excludeDeletedEmbed');
  });

  it('profile posts stay hidden — the wall they live on 404s anyway', () => {
    // profile_posts are scoped to one profile (`author_id` = that profile).
    // With the profile unreachable there is no surface for them to appear on.
    expect(read('controllers/profilePosts.controller.ts')).toContain('author_id');
  });

  it('chat messages were already exempt and stay that way', () => {
    // activeUser.ts has always excluded messages, match participants and
    // notification actors: hiding them corrupts the OTHER party's thread. Read
    // RAW here — this one asserts the documented intent, which lives in the
    // comments the other assertions strip.
    const raw = fs.readFileSync(path.join(__dirname, '..', 'utils', 'activeUser.ts'), 'utf8');
    expect(raw).toContain('Intentionally NOT applied');
    // And the header must no longer claim the DB cascade-purges content at 30
    // days. It does not, and never did — that claim is what justified hiding
    // the content in the first place.
    expect(raw).not.toContain('cascade-purges all of the user');
  });

  it('the unread badge still ignores a deleted sender', () => {
    // The message stays in the thread; a dead account just cannot raise a ping.
    expect(read('controllers/messages.controller.ts')).toContain('deletedIdSet');
  });
});
