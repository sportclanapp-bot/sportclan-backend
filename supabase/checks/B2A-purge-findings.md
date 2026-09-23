# B2-a · what account purge should actually do

**Status: investigation only. `purgeExpiredAccountsCore` is still not wired, and
must not be wired as written.** Nothing in this document has been implemented.

Block 2 returned 77 foreign keys pointing at `users`. Read against what the
Delete account screen promises, the function as written would do the opposite of
two of its three promises — and then fail anyway.

---

## 0 · Two findings that come before the grouping

**The purge cannot run at all.** Ten FKs are `NO ACTION`: `users.referred_by`,
`matches.mvp_user_id`, `season_medals.user_id`, `kudos.from_user_id`,
`kudos.to_user_id`, `venues.created_by`, `match_ratings.rater_id`,
`match_event_audit.changed_by`, `team_expenses.created_by`,
`team_expenses.paid_by`. `NO ACTION` does not block a delete on its own — it
blocks one when a referencing row exists. Every one of these is a row a normal,
active user creates: give kudos, be named MVP, be rated after a match, pay for
the pitch. So the purge throws for essentially any real account.

And it throws for **all of them at once**. The function collects every expired id
and issues one `DELETE ... IN (ids)`. One blocking row anywhere in the batch
fails the whole statement, and the next run rebuilds the same batch and fails
identically. It is not "mostly works with a few stragglers"; it is permanently
stuck from the first real account.

**Two of the screen's three promises are already false — before the purge.**
This is the bigger finding, because it is live today.

| The screen says | What actually happens at delete time |
|---|---|
| "Posts you made stay visible (without your name)." | The post is **hidden entirely**. `community.controller.ts` embeds `author:users!author_id!inner` + `excludeDeletedEmbed`, and an inner join drops the **parent row**, not the name. Same for `post_comments`. |
| "Match scores in tournaments you played stay in the records." | **True.** `activeUser.ts` deliberately exempts match participants, chat messages and notification actors — they stay, anonymised. |
| "Reviews you wrote about other users remain anonymous." | The review is **hidden entirely** (`users.controller.ts` `getReviews`, `excludeDeletedEmbed(..., 'reviewer')`), and it is excluded from the provider's average too. |

So the reading-order problem is not "the purge breaks the promise in 30 days".
It is "the promise was never kept, and the purge would then delete the rows as
well".

---

## 1 · What the soft delete already does

Everything user-visible, which is why nobody noticed the purge never ran.

**At delete time** (`deleteAccount`): `name` → "Deleted User", `username` →
`deleted_<8 hex>`, `email`/`profile_picture_url`/`bio`/`gender`/`dob` → null;
`deleted_at` set. All refresh tokens deleted, access tokens revoked (SC-384),
push tokens deleted. Captaincy of every team transferred by an atomic RPC
(SC-79). `phone` is deliberately **kept** so the number stays locked out.

**On every read afterwards** (`activeUser.ts`, ~20 call sites): the account is
gone from search, discovery, rivals, the leaderboard, the feed, comments, kudos,
team rosters, reviews, match-join requests and the weekly digest.

**So what is left for the 30-day purge to erase** is only the residue on the
`users` row itself: `phone`, `referral_code`, `city_id`, `coin_balance`,
`created_at`. That is a much smaller job than "hard-delete the account", and it
is the whole of the remaining privacy obligation.

---

## 2 · The grouping

### Group A — delete. Personal, private, meaningless without the person.
Already `CASCADE`, and correct: `user_sport_profiles`, `rating_history`,
`transactions`, `coin_events`, `push_tokens`, `refresh_tokens`, `notifications`,
`user_challenges`, `profile_posts`, `gift_transactions`.
**Needs: nothing.**

### Group B — keep, detached from the person. Authored or shared content.
Currently `CASCADE`, and every one of these is wrong:

| Table | What CASCADE destroys |
|---|---|
| `teams.created_by` | The **whole team** — roster, history, expenses — because its founder left. |
| `tournaments.created_by` | The tournament, its fixtures and its results. |
| `matches.created_by` | Matches **other people played in**, taking the opponent's record with them. |
| `community_posts.author_id`, `post_comments.author_id` | The content the screen promises stays. |
| `messages.sender_id` | One side of someone else's conversation. |
| `user_reviews` (both sides) | Reviews written about others, and the reviews others wrote. |
| `innings_stats`, `match_participants` | Their scorecard lines out of other people's matches. |

**Needs: schema change** — `SET NULL` (with the column made nullable) or a
tombstone user. **Plus code**: `teams`, `tournaments` and `matches` declare
`created_by uuid NOT NULL` (migration 004), so `SET NULL` needs the NOT NULL
dropped first, and ~9 sites compare `created_by === userId` (a null reads as
"not the creator", which is the safe answer).

### Group C — keep as is. Aggregate and record-keeping.
Already `SET NULL` and correct: `matches.umpire_id`, `match_events.created_by`,
`matches.voided_by`, `team_join_requests.decided_by`.
**Needs: nothing.**

### Group D — the ten `NO ACTION` blockers.
Each needs a deliberate answer, not a blanket one: `kudos` and `season_medals`
are about the person (delete or detach); `venues.created_by` and
`team_expenses.*` are shared records that must survive (`SET NULL`);
`matches.mvp_user_id` is a record of who won it (`SET NULL`);
`match_event_audit.changed_by` is an audit trail and should never be rewritten
(`SET NULL`); `users.referred_by` is someone else's referral (`SET NULL`).
**Needs: schema change.**

---

## 3 · Three ways forward

### Option A — stop hard-deleting. Scrub the residue instead. *(recommended)*
Replace the `DELETE` with an `UPDATE` that nulls `phone` (releasing the number),
`referral_code`, `city_id` and `coin_balance`, and stamps `purged_at`.

- **Migration:** one nullable timestamp column. Nothing else.
- **Code:** ~15 lines in `account.controller.ts`.
- **Risk:** near zero. No FK is touched, so nothing cascades and nothing throws.
- **What it delivers:** the row becomes a permanent anonymous tombstone holding
  no personal data. Content stays attached to it — which is precisely what
  "posts stay without your name" describes. It also makes the promise
  *achievable*, because the author row still exists to join to.
- **What it does not do:** it leaves a row per deleted account forever. That row
  contains no personal data, which is the standard reading of "erased".

### Option B — make the cascades correct.
~22 FK alterations, `NOT NULL` dropped on three columns, a tombstone user, and
every read path that assumes a creator exists reviewed.
**Migration: large** (one file, but it rewrites the referential shape of the
schema). Correct, and not something to do in the week before launch.

### Option C — change the screen to match reality.
Reword the three bullets to say posts, comments and reviews are removed.
Cheapest, and the worst product: it also makes the app's deletion *more*
destructive than it needs to be, and bullet 2 would become false anyway the
moment `matches.created_by` cascades.

---

## 4 · Recommendation

**Do Option A before launch, and fix the screen's wording in the same change.**

The purge is currently a no-op, and a no-op is safer than either alternative
shipped in a hurry. Option A converts it into a job that does the only thing
still outstanding (erase the residual PII) and cannot fail.

Separately, and independently of the purge: decide whether the two false bullets
should be made true (relax the `!inner` author filters so posts and reviews stay,
anonymised) or reworded. That is a product call, not a data-safety one — but it
is live today and worth deciding now rather than at 30 days.

**Option B belongs after launch**, on a schema that has real data and a
maintenance window, and only if keeping tombstone rows turns out to be a problem.
