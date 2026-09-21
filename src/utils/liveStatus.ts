/**
 * SC-428 · what the server can honestly tell a VIEWER about a live match.
 *
 * A spectator watching a frozen scoreboard cannot tell the difference between a
 * match that has genuinely gone quiet, a scorer who has lost signal, and their
 * own connection dying. The app can answer the third on its own. The first two
 * need the server, because only the server knows when it last heard anything.
 *
 * TWO SIGNALS, and neither is sufficient alone:
 *
 *   lastEventAt        — when the server last RECEIVED a scoring event. Says the
 *                        scoreboard has not moved. Does not say why.
 *   scorerLastActiveAt — the scorer's presence heartbeat (SC-344, `last_active_at`,
 *                        refreshed on app foreground and on a short interval).
 *                        Says whether their app has been talking to us at all.
 *
 * Together they separate the two cases that matter: no events but the scorer is
 * present = the match is quiet (drinks, innings break, an argument about a
 * no-ball); no events AND no heartbeat = the scorer may have lost signal.
 *
 * WHAT THIS CANNOT KNOW, and why the copy must stay hedged:
 *  - The scorer's OUTBOX is on their phone. A scorer with twenty queued points
 *    and one with none look identical from here. This is why the verdict is
 *    "may be offline" and never "is offline".
 *  - Presence is app-level, not scoring-level. A scorer reading the feed on the
 *    same account keeps the heartbeat warm while their scoring never syncs; a
 *    second device does the same.
 *  - Resolution is bounded by the heartbeat window (ONLINE_WINDOW_MS), so a
 *    scorer who dropped ten seconds ago still reads as present.
 *  - A match can have a creator AND an assigned umpire, either of whom may be
 *    scoring. We take the most recent heartbeat of the two: claiming "offline"
 *    because one of them is away would be a lie about the other.
 */

import { supabase } from './supabase';
import { ONLINE_WINDOW_MS } from '../controllers/users.controller';

/** No scoring for this long on a LIVE match is worth telling the viewer about. */
export const QUIET_AFTER_MS = 3 * 60 * 1000;

export type ScorerSignal =
  /** The server has had scoring recently — the scoreboard is genuinely current. */
  | 'scoring'
  /** No recent scoring, but the scorer's app is talking to us. The match is quiet. */
  | 'quiet'
  /** No recent scoring AND no recent heartbeat. Their signal may be gone. */
  | 'maybe_offline'
  /** Not a live match, or we have nothing to judge on. */
  | 'unknown';

export interface MatchLiveStatus {
  /** When the server last received an event for this match. */
  last_event_at: string | null;
  /** Most recent heartbeat across the people entitled to score it. */
  scorer_last_active_at: string | null;
  scorer_signal: ScorerSignal;
  /** The server's clock at the moment of this response. Clients MUST age the
   *  timestamps above against this, not against the device clock — a phone with
   *  a wrong clock would otherwise render a confident and completely wrong
   *  "last update 4 hours ago". */
  server_time: string;
  /** Echoed so a client never has to hardcode the thresholds it renders against. */
  quiet_after_ms: number;
  online_window_ms: number;
}

export function classify(
  status: string | null | undefined,
  lastEventAt: string | null,
  scorerLastActiveAt: string | null,
  now = Date.now(),
): ScorerSignal {
  if (status !== 'live') return 'unknown';
  const age = (iso: string | null) => (iso ? now - new Date(iso).getTime() : Infinity);
  if (age(lastEventAt) < QUIET_AFTER_MS) return 'scoring';
  // No recent scoring. Presence decides between "quiet" and "may have dropped".
  if (age(scorerLastActiveAt) < ONLINE_WINDOW_MS) return 'quiet';
  return 'maybe_offline';
}

/**
 * Best-effort: a failure here must never take down the match payload, so every
 * query is tolerated and the caller simply gets nulls and 'unknown'.
 */
export async function getMatchLiveStatus(match: {
  id: string;
  status?: string | null;
  created_by?: string | null;
  umpire_id?: string | null;
}): Promise<MatchLiveStatus> {
  const nowIso = new Date().toISOString();
  let lastEventAt: string | null = null;
  let scorerLastActiveAt: string | null = null;

  try {
    const { data } = await supabase
      .from('match_events')
      .select('created_at')
      .eq('match_id', match.id)
      .order('created_at', { ascending: false })
      .limit(1);
    lastEventAt = (data?.[0] as { created_at?: string } | undefined)?.created_at ?? null;
  } catch { /* leave null */ }

  const scorerIds = [match.created_by, match.umpire_id].filter(Boolean) as string[];
  if (scorerIds.length > 0) {
    try {
      const { data } = await supabase
        .from('users')
        .select('last_active_at')
        .in('id', scorerIds);
      for (const row of (data ?? []) as { last_active_at?: string | null }[]) {
        const t = row.last_active_at ?? null;
        if (t && (!scorerLastActiveAt || t > scorerLastActiveAt)) scorerLastActiveAt = t;
      }
    } catch { /* leave null */ }
  }

  return {
    last_event_at: lastEventAt,
    scorer_last_active_at: scorerLastActiveAt,
    scorer_signal: classify(match.status, lastEventAt, scorerLastActiveAt),
    server_time: nowIso,
    quiet_after_ms: QUIET_AFTER_MS,
    online_window_ms: ONLINE_WINDOW_MS,
  };
}
