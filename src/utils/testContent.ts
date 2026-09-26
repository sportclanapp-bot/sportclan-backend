import { supabase } from './supabase';

/**
 * Visual review B03 (V245, decision D3) · test content is hidden from real users.
 *
 * Before launch, prod holds QA and seed data: "Wipe pre-launch" posts,
 * "RT1783270513286_1 vs …" fixtures, "probe" venues, a "<script>" account. It
 * is flagged (`is_test_seed`, migration 097 + checks/APPLY-b03) and deleted at
 * the launch wipe. Until then every PUBLIC discovery read drops flagged rows —
 * for everyone except test accounts, so the QA device accounts keep working
 * and still see each other.
 *
 * Same three shapes as activeUser.ts (the deleted-user filter):
 *   • direct query on a flagged table  → excludeTest(query)
 *   • embedded user join (`!inner`)    → excludeTestEmbed(query, alias)
 *   • aggregate keyed by user_id       → testUserIdSet(ids), drop them in JS
 *
 * Every caller asks hideTestFor(req.userId) first. It answers false — filter
 * nothing, exactly the old behaviour — when the column doesn't exist yet
 * (097 not applied), so a deploy before the migration can't break a listing.
 */

let ready: boolean | null = null;
let readyCheckedAt = 0;

/** Does the is_test_seed column exist? Cached; re-probed once a minute until it does. */
export async function testFlagReady(): Promise<boolean> {
  if (ready === true) return true;
  if (ready === false && Date.now() - readyCheckedAt < 60_000) return false;
  const { error } = await supabase.from('users').select('is_test_seed').limit(1);
  ready = !error;
  readyCheckedAt = Date.now();
  return ready;
}

const viewerCache = new Map<string, { test: boolean; at: number }>();

/**
 * Should this request's discovery reads drop test rows? True for a real
 * (unflagged) viewer and for a signed-out one; false for a test account, and
 * false while the flag column doesn't exist. A failed lookup of the viewer
 * counts as a real viewer — hiding test rows is the safe side.
 */
export async function hideTestFor(userId: string | null | undefined): Promise<boolean> {
  if (!(await testFlagReady())) return false;
  if (!userId) return true;
  const hit = viewerCache.get(userId);
  if (hit && Date.now() - hit.at < 60_000) return !hit.test;
  const { data, error } = await supabase.from('users').select('is_test_seed').eq('id', userId).maybeSingle();
  if (error) return true;
  const test = (data as { is_test_seed?: boolean } | null)?.is_test_seed === true;
  viewerCache.set(userId, { test, at: Date.now() });
  return !test;
}

/** Direct query on users/teams/matches/tournaments/community_posts/chats. */
export function excludeTest<Q>(q: Q): Q {
  return (q as unknown as { eq: (c: string, v: boolean) => Q }).eq('is_test_seed', false);
}

/** Embedded user join(s) declared with `!inner`: drop the parent when the joined row is test. */
export function excludeTestEmbed<Q>(q: Q, ...aliases: string[]): Q {
  let out: unknown = q;
  for (const a of aliases) {
    out = (out as { eq: (c: string, v: boolean) => unknown }).eq(`${a}.is_test_seed`, false);
  }
  return out as Q;
}

/** For aggregates keyed by user_id: which of these ids are test accounts. */
export async function testUserIdSet(ids: string[]): Promise<Set<string>> {
  if (ids.length === 0) return new Set();
  const { data } = await supabase.from('users').select('id').in('id', ids).eq('is_test_seed', true);
  return new Set((data || []).map((u: { id: string }) => u.id));
}

/** Test for the caches (process-local). */
export function __resetTestContentCaches(): void {
  ready = null;
  readyCheckedAt = 0;
  viewerCache.clear();
}
