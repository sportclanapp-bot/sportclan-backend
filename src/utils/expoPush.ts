/**
 * Push delivery through Expo's push service.
 *
 * Replaces fcm.ts, which sent through firebase-admin. That could never have
 * worked: the app registers EXPO push tokens (`ExponentPushToken[…]`, from
 * getExpoPushTokenAsync) and firebase-admin expects FCM registration tokens.
 * Every send was rejected, the rejection was swallowed, and the in-app
 * notification row — written first, separately — meant nobody noticed.
 *
 * Expo's service accepts the token the app already produces, fans out to FCM
 * (and later APNs) with the credential uploaded to EAS, and answers in two
 * stages that this module keeps distinct on purpose:
 *
 *   TICKET  — "I accepted this message and will try." Returned immediately.
 *             A ticket error (e.g. InvalidCredentials, DeviceNotRegistered on
 *             a malformed token) is known now.
 *   RECEIPT — "here is what FCM said." Available ~15 min later, by ticket id.
 *             `DeviceNotRegistered` here means the app is gone from that
 *             device; the token must be deleted or the table fills with the
 *             dead forever.
 *
 * Tickets are persisted (push_tickets, migration 094) so the receipt check
 * survives a restart — Render restarts on every deploy, and an in-memory list
 * would silently lose a cycle each time.
 */
import type { Expo as ExpoClient, ExpoPushMessage, ExpoPushTicket } from 'expo-server-sdk';
import { supabase } from './supabase';

export interface PushPayload {
  title: string;
  body: string;
  data?: Record<string, string>;
}

/**
 * expo-server-sdk v7 is published as pure ESM. Loaded with a static import it
 * fails two ways: ts-jest (CommonJS) cannot parse it, and a plain require() of
 * an ES module depends on which Node version the host runs. A dynamic import
 * works in both worlds and on every supported Node, and it means nothing in
 * this file touches the SDK until a push is actually sent - the same
 * lazy-load rule otpStore.ts uses for @upstash/redis.
 */
let _expo: ExpoClient | null = null;
async function client(): Promise<ExpoClient> {
  if (_expo) return _expo;
  const { Expo } = await import('expo-server-sdk');
  // EXPO_ACCESS_TOKEN is optional: sends work without it, at a lower rate limit.
  _expo = new Expo(process.env.EXPO_ACCESS_TOKEN ? { accessToken: process.env.EXPO_ACCESS_TOKEN } : {});
  return _expo;
}

/**
 * Only tokens in the shape the app produces. Anything else is dropped here.
 * Same rule as Expo.isExpoPushToken, kept local so it can run synchronously
 * without loading the SDK: `ExponentPushToken[...]` or `ExpoPushToken[...]`.
 */
export function isExpoToken(token: string): boolean {
  return typeof token === 'string' && /^Expo(nent)?PushToken\[[^\]]+\]$/.test(token);
}

/**
 * Send one payload to many tokens. Returns the number of tickets Expo accepted.
 *
 * Never throws: push is best-effort and a failure here must not fail the
 * action that triggered it. Malformed tokens are removed on the spot — they
 * can never work and would otherwise be retried on every send.
 */
export async function sendPushToTokens(tokens: string[], payload: PushPayload): Promise<number> {
  const valid = tokens.filter(isExpoToken);
  const bad = tokens.filter((t) => !isExpoToken(t));
  if (bad.length > 0) await deleteTokens(bad, 'not an Expo push token');
  if (valid.length === 0) return 0;

  const messages: ExpoPushMessage[] = valid.map((to) => ({
    to,
    sound: 'default',
    title: payload.title,
    body: payload.body,
    data: payload.data ?? {},
    channelId: 'default',
  }));

  let accepted = 0;
  const pending: { ticket_id: string; token: string }[] = [];
  const dead: string[] = [];
  try {
    const expo = await client();
    for (const chunk of expo.chunkPushNotifications(messages)) {
      let tickets: ExpoPushTicket[];
      try {
        tickets = await expo.sendPushNotificationsAsync(chunk);
      } catch (err) {
        // eslint-disable-next-line no-console
        console.error('[push] chunk send failed', err instanceof Error ? err.message : err);
        continue;
      }
      tickets.forEach((t, i) => {
        const token = chunk[i]?.to as string;
        if (t.status === 'ok') {
          accepted += 1;
          pending.push({ ticket_id: t.id, token });
        } else {
          const code = t.details?.error;
          // eslint-disable-next-line no-console
          console.warn('[push] ticket error', code, t.message);
          if (code === 'DeviceNotRegistered') dead.push(token);
          // InvalidCredentials is a CONFIGURATION fault (FCM key missing from
          // EAS), not a token fault — logged loudly, nothing deleted.
        }
      });
    }
  } catch (err) {
    // eslint-disable-next-line no-console
    console.error('[push] send failed', err instanceof Error ? err.message : err);
  }
  if (dead.length > 0) await deleteTokens(dead, 'DeviceNotRegistered (ticket)');
  if (pending.length > 0) {
    try {
      const { error } = await supabase.from('push_tickets').insert(pending);
      // Pre-migration deploy: the table is not there yet. The send still
      // happened; only the receipt check is lost for these.
      if (error) console.warn('[push] could not record tickets', error.message); // eslint-disable-line no-console
    } catch (err) {
      // eslint-disable-next-line no-console
      console.warn('[push] recording tickets threw', err instanceof Error ? err.message : err);
    }
  }
  return accepted;
}

/**
 * The receipt check. Hourly, on the existing in-process scheduler.
 *
 * Reads tickets older than 15 minutes that have not been checked, asks Expo
 * for their receipts, deletes tokens whose receipt says the device is gone,
 * and marks the tickets checked. Idempotent: a ticket is checked once.
 */
export async function checkPushReceipts(): Promise<{ checked: number; removed: number }> {
  const cutoff = new Date(Date.now() - 15 * 60_000).toISOString();
  const { data: rows, error } = await supabase
    .from('push_tickets')
    .select('ticket_id, token')
    .is('checked_at', null)
    .lt('created_at', cutoff)
    .limit(1000);
  if (error || !rows || rows.length === 0) return { checked: 0, removed: 0 };

  const byTicket = new Map(rows.map((r) => [r.ticket_id as string, r.token as string]));
  const dead: string[] = [];
  let checked = 0;
  const expo = await client();
  for (const chunk of expo.chunkPushNotificationReceiptIds([...byTicket.keys()])) {
    let receipts: Awaited<ReturnType<ExpoClient['getPushNotificationReceiptsAsync']>>;
    try {
      receipts = await expo.getPushNotificationReceiptsAsync(chunk);
    } catch (err) {
      // eslint-disable-next-line no-console
      console.error('[push] receipt fetch failed', err instanceof Error ? err.message : err);
      continue;
    }
    for (const id of chunk) {
      const r = receipts[id];
      // Expo keeps receipts ~24h. Missing = expired or still pending; either way
      // this ticket is done — we do not re-ask forever.
      checked += 1;
      if (r && r.status === 'error' && r.details?.error === 'DeviceNotRegistered') {
        const tok = byTicket.get(id);
        if (tok) dead.push(tok);
      }
    }
  }
  if (dead.length > 0) await deleteTokens([...new Set(dead)], 'DeviceNotRegistered (receipt)');
  await supabase
    .from('push_tickets')
    .update({ checked_at: new Date().toISOString() })
    .in('ticket_id', [...byTicket.keys()]);
  return { checked, removed: new Set(dead).size };
}

async function deleteTokens(tokens: string[], why: string): Promise<void> {
  if (tokens.length === 0) return;
  // Cleanup is housekeeping. It must never turn a delivered (or refused) push
  // into a thrown error for the caller - the supabase client itself can throw
  // (e.g. unconfigured in a local run), not just return an error.
  try {
    const { error } = await supabase.from('push_tokens').delete().in('token', tokens);
    // eslint-disable-next-line no-console
    if (error) console.warn('[push] token cleanup failed', error.message);
    else console.log(`[push] removed ${tokens.length} token(s): ${why}`); // eslint-disable-line no-console
  } catch (err) {
    // eslint-disable-next-line no-console
    console.warn('[push] token cleanup threw', err instanceof Error ? err.message : err);
  }
}
