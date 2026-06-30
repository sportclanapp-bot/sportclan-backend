// Notification helpers — insert into the notifications table AND fire a push
// to the target user's devices. Best-effort: a failure in one path never
// blocks the caller (and never throws) because push is always optional.
import { supabase } from './supabase';
import { sendPushToTokens } from './fcm';

export interface NotifyArgs {
  userId: string;
  type: string;
  title: string;
  body: string;
  data?: Record<string, string>;
}

// Map a notification `type` → a user-facing preference category (A16-006).
// Only engagement/social notifications are gated; account-critical types
// (subscription, payment, admin, security) are intentionally absent so they
// ALWAYS send regardless of preferences.
const PREF_CATEGORY: Record<string, string> = {
  // Matches
  match_reminder: 'matches',
  match_start: 'matches',
  match_result: 'matches',
  score_update: 'matches',
  smart_match: 'matches',
  weekend_nudge: 'matches',
  // Social
  follow: 'social',
  new_follower: 'social',
  kudos: 'social',
  community: 'social',
  invite: 'social',
  play_invite: 'social',
  // Gifts
  gift: 'gifts',
  gift_received: 'gifts',
  // Milestones
  rating_milestone: 'milestones',
  achievement: 'milestones',
  // Digests & nudges
  weekly_digest: 'digests',
  reengagement: 'digests',
};

// Opt-out model: a category is allowed unless the user has explicitly set it
// to `false`. Unmapped types (account-critical) are always allowed. Returns the
// subset of userIds who should receive a notification of this type.
async function allowedRecipients(userIds: string[], type: string): Promise<string[]> {
  const category = PREF_CATEGORY[type];
  if (!category || userIds.length === 0) return userIds; // ungated
  try {
    const { data } = await supabase
      .from('users')
      .select('id, notification_preferences')
      .in('id', userIds);
    if (!data) return userIds;
    const prefById = new Map(data.map((u: any) => [u.id, u.notification_preferences ?? {}]));
    return userIds.filter((id) => {
      const prefs = prefById.get(id);
      // Missing row or missing/true value → allowed; only an explicit false opts out.
      return !prefs || prefs[category] !== false;
    });
  } catch {
    // On any lookup error, fail open — never silently drop a notification.
    return userIds;
  }
}

// Send to one user — inserts a row and pushes.
export async function notifyUser(args: NotifyArgs): Promise<void> {
  try {
    const allowed = await allowedRecipients([args.userId], args.type);
    if (allowed.length === 0) return; // user opted out of this category
    await supabase.from('notifications').insert({
      user_id: args.userId,
      type: args.type,
      title: args.title,
      body: args.body,
      data: args.data ?? {},
    });

    const { data: tokens } = await supabase
      .from('push_tokens')
      .select('token')
      .eq('user_id', args.userId);

    if (tokens && tokens.length > 0) {
      await sendPushToTokens(
        tokens.map((t) => t.token),
        {
          title: args.title,
          body: args.body,
          data: { type: args.type, ...(args.data ?? {}) },
        },
      );
    }
  } catch (err) {
    // eslint-disable-next-line no-console
    console.error('[notify] failed', args.type, err);
  }
}

// Fan-out to many users. Inserts rows in one batch, pushes in one batch.
export async function notifyUsers(userIds: string[], payload: Omit<NotifyArgs, 'userId'>): Promise<void> {
  const deduped = Array.from(new Set(userIds.filter(Boolean)));
  const uniqueIds = await allowedRecipients(deduped, payload.type);
  if (uniqueIds.length === 0) return;
  try {
    const rows = uniqueIds.map((userId) => ({
      user_id: userId,
      type: payload.type,
      title: payload.title,
      body: payload.body,
      data: payload.data ?? {},
    }));
    await supabase.from('notifications').insert(rows);

    const { data: tokens } = await supabase
      .from('push_tokens')
      .select('token')
      .in('user_id', uniqueIds);

    if (tokens && tokens.length > 0) {
      await sendPushToTokens(
        tokens.map((t) => t.token),
        {
          title: payload.title,
          body: payload.body,
          data: { type: payload.type, ...(payload.data ?? {}) },
        },
      );
    }
  } catch (err) {
    // eslint-disable-next-line no-console
    console.error('[notify] fanout failed', payload.type, err);
  }
}
