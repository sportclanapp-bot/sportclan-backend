/**
 * B15 (V069) · "Who can tag you" — users.tag_privacy was stored and never
 * enforced; the Privacy screen said "Tag controls arrive with @mentions" while
 * @mentions already existed. Now a mention notification (post or chat) only
 * reaches someone whose setting allows the author:
 *   everyone  → anyone
 *   followers → only people who follow them (the same meaning message_privacy
 *               'followers' has in dmSendGate)
 *   nobody    → no one
 * The text of the post or message is the author's and is not changed.
 */
import { supabase } from './supabase';

export type TagPrivacy = 'everyone' | 'followers' | 'nobody';

/** Pure rule, for tests: may `authorFollows` (does the author follow them?) tag them? */
export function mayTag(privacy: TagPrivacy | null | undefined, authorFollowsThem: boolean): boolean {
  if (privacy === 'nobody') return false;
  if (privacy === 'followers') return authorFollowsThem;
  return true;
}

/** The subset of `ids` the author may notify with an @mention. Fails open on a read error. */
export async function taggableBy(authorId: string, ids: string[]): Promise<string[]> {
  if (ids.length === 0) return [];
  try {
    const [{ data: users, error }, { data: follows }] = await Promise.all([
      supabase.from('users').select('id, tag_privacy').in('id', ids),
      supabase.from('follow_relationships').select('following_id').eq('follower_id', authorId).in('following_id', ids),
    ]);
    if (error) return ids;
    const followed = new Set((follows ?? []).map((f: { following_id: string }) => f.following_id));
    const privacy = new Map((users ?? []).map((u: { id: string; tag_privacy: TagPrivacy | null }) => [u.id, u.tag_privacy]));
    return ids.filter((id) => mayTag(privacy.get(id) ?? 'everyone', followed.has(id)));
  } catch {
    return ids;
  }
}
