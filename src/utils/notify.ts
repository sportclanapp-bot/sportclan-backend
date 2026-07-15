// Notification helpers — insert into the notifications table AND fire a push
// to the target user's devices. Best-effort: a failure in one path never
// blocks the caller (and never throws) because push is always optional.
import { supabase } from './supabase';
import { sendPushToTokens } from './fcm';
import { blockedUserIds } from './blocks';
import { deletedIdSet } from './activeUser';

// Soft-deleted lookup in bounded chunks — deletedIdSet does one `.in()`, which a
// very large fan-out would overflow (the SC-4/SC-10 `.in()`-at-scale class).
async function deletedInChunks(ids: string[]): Promise<Set<string>> {
  const out = new Set<string>();
  for (let i = 0; i < ids.length; i += 500) {
    const s = await deletedIdSet(ids.slice(i, i + 500));
    s.forEach((x) => out.add(x));
  }
  return out;
}

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
  // SC-204: post engagement (comment / like / comment-reaction) is social-gated.
  comment: 'social',
  like: 'social',
  reaction: 'social',
  // SC-235: post @mention — a tagged user is notified they were mentioned in a
  // post. Social-gated (a mention is social engagement), so the Social toggle
  // silences it. Must be here or it would be an ungated bypass (the SC-232 class).
  mention: 'social',
  invite: 'social',
  play_invite: 'social',
  invite_accepted: 'social',
  invite_declined: 'social',
  // Tournament-entry decisions are left UNMAPPED (ungated) below — they're
  // organiser/team-critical and should always deliver.
  // Gifts
  gift: 'gifts',
  gift_received: 'gifts',
  // Milestones
  rating_milestone: 'milestones',
  // SC-232: the per-match ELO delta ping (fired for every ranked completion) was
  // ungated — it respected neither 'matches' nor 'milestones', so a user could
  // not silence it. Group it with its sibling rating_milestone under Milestones.
  rating_change: 'milestones',
  achievement: 'milestones',
  // Digests & nudges
  weekly_digest: 'digests',
  reengagement: 'digests',
  // SC-233 (intentional, by design — do NOT gate): match_cancelled /
  // match_abandoned are deliberately UNMAPPED here, so they ignore the 'matches'
  // toggle and always deliver. Rationale: a cancellation/abandonment is a
  // critical, actionable, one-time status change — not match-noise. A user
  // missing that their match died is worse than an unwanted ping. This is
  // consistent with the other ungated status-changes (tournament entry
  // decisions, added_to_team, match_umpire_assigned/assigned_as_official).
  // NOT a bug.
  //
  // SC-239: tournament_cancelled is likewise UNMAPPED by design (ungated — always
  // delivers), the tournament-level sibling of match_cancelled. An entrant losing
  // track of a cancelled tournament is a critical status miss, not noise. Named
  // here so it reads as classified-ungated, not accidentally-unmapped.
  //
  // SC-253: tournament_champion is UNMAPPED by design too (ungated — always
  // delivers). It fires once, when a tournament crowns its winner — a one-time
  // terminal result to the people who played, not recurring engagement noise.
  // Sibling of tournament_cancelled.
};

// Opt-out model: a category is allowed unless the user has explicitly set it
// to `false`. Unmapped types (account-critical) are always allowed. Returns the
// subset of userIds who should receive a notification of this type.
export async function allowedRecipients(userIds: string[], type: string): Promise<string[]> {
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

// Push-only — sends to the user's devices WITHOUT inserting a notifications row.
// For callers that insert their own row (e.g. the cron jobs, which need to detect
// insert failure to release their notification_sends claim, SC-143) but still want
// a push. Assumes prefs were already checked by the caller (SC-140).
export async function sendPushToUser(userId: string, payload: Omit<NotifyArgs, 'userId'>): Promise<void> {
  try {
    const { data: tokens } = await supabase.from('push_tokens').select('token').eq('user_id', userId);
    if (tokens && tokens.length > 0) {
      await sendPushToTokens(
        tokens.map((t) => t.token),
        { title: payload.title, body: payload.body, data: { type: payload.type, ...(payload.data ?? {}) } },
      );
    }
  } catch (err) {
    // eslint-disable-next-line no-console
    console.error('[notify] push-only failed', payload.type, err);
  }
}

// Bulk push-only — one token fetch for MANY users (each with their own payload),
// then a per-user send. Lets a batched cron job (SC-141) push a whole chunk with a
// single push_tokens round-trip instead of one per user. No notifications rows.
export async function sendPushToUsers(
  items: { userId: string; type: string; title: string; body: string; data?: Record<string, string> }[],
): Promise<void> {
  if (items.length === 0) return;
  try {
    const ids = items.map((i) => i.userId);
    const { data: tokens } = await supabase.from('push_tokens').select('user_id, token').in('user_id', ids);
    const byUser = new Map<string, string[]>();
    for (const t of tokens ?? []) {
      const arr = byUser.get(t.user_id) ?? [];
      arr.push(t.token);
      byUser.set(t.user_id, arr);
    }
    for (const it of items) {
      const toks = byUser.get(it.userId);
      if (toks && toks.length > 0) {
        await sendPushToTokens(toks, { title: it.title, body: it.body, data: { type: it.type, ...(it.data ?? {}) } });
      }
    }
  } catch (err) {
    // eslint-disable-next-line no-console
    console.error('[notify] bulk push failed', err);
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

// Fan-out to many users. Filters the recipient set (self/blocked/deleted/prefs),
// then inserts + pushes in bounded chunks.
//   opts.actorId — the user whose action triggered this fan-out. When present,
//   the actor is never notified of their own action (SC-135) and anyone
//   blocked-either-direction with them is dropped (SC-134). Omit it for system/
//   ungated fan-outs (e.g. season announcements) or match-critical notifications
//   a block must never suppress.
export async function notifyUsers(
  userIds: string[],
  payload: Omit<NotifyArgs, 'userId'>,
  opts: { actorId?: string } = {},
): Promise<void> {
  try {
    // dedup (existing) → self → blocked → deleted → prefs (existing).
    let ids = Array.from(new Set(userIds.filter(Boolean)));
    const { actorId } = opts;
    if (actorId) ids = ids.filter((id) => id !== actorId); // SC-135: no self-notify
    if (actorId && ids.length > 0) {
      const blocked = await blockedUserIds(actorId); // SC-134: block either-direction
      if (blocked.size > 0) ids = ids.filter((id) => !blocked.has(id));
    }
    if (ids.length > 0) {
      const deleted = await deletedInChunks(ids); // SC-136: no rows for deleted accounts
      if (deleted.size > 0) ids = ids.filter((id) => !deleted.has(id));
    }
    const uniqueIds = await allowedRecipients(ids, payload.type);
    if (uniqueIds.length === 0) return;

    const rows = uniqueIds.map((userId) => ({
      user_id: userId,
      type: payload.type,
      title: payload.title,
      body: payload.body,
      data: payload.data ?? {},
    }));

    // SC-137: chunk the insert so a large fan-out can't hit a payload/statement
    // ceiling. Stays non-blocking (SC-112), but a TOTAL drop is logged loudly —
    // never silently swallowed.
    const CHUNK = 500;
    let inserted = 0;
    let lastErr: unknown = null;
    for (let i = 0; i < rows.length; i += CHUNK) {
      const slice = rows.slice(i, i + CHUNK);
      const { error } = await supabase.from('notifications').insert(slice);
      if (error) lastErr = error;
      else inserted += slice.length;
    }
    if (inserted === 0 && rows.length > 0) {
      // eslint-disable-next-line no-console
      console.error(`[notify] fanout TOTAL FAILURE (0/${rows.length})`, payload.type, lastErr);
    } else if (lastErr) {
      // eslint-disable-next-line no-console
      console.error(`[notify] fanout PARTIAL (${inserted}/${rows.length})`, payload.type, lastErr);
    }

    // Push in the same chunks (bounds the `.in()` token fetch too).
    for (let i = 0; i < uniqueIds.length; i += CHUNK) {
      const slice = uniqueIds.slice(i, i + CHUNK);
      const { data: tokens } = await supabase.from('push_tokens').select('token').in('user_id', slice);
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
    }
  } catch (err) {
    // eslint-disable-next-line no-console
    console.error('[notify] fanout failed', payload.type, err);
  }
}

/**
 * Notify `args.userId` about `actorId`'s action — UNLESS the two have blocked
 * each other (either direction). Used by approval/decision notifications so a
 * block is never crossed. Best-effort; fails open on lookup error.
 */
export async function notifyUnlessBlocked(actorId: string, args: NotifyArgs): Promise<void> {
  try {
    if (actorId && actorId !== args.userId) {
      const blocked = await blockedUserIds(args.userId);
      if (blocked.has(actorId)) return;
    }
  } catch {
    // fail open — a block-lookup error must not drop a legitimate notification
  }
  await notifyUser(args);
}
