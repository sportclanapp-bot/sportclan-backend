import { Request, Response } from 'express';
import { supabase } from '../utils/supabase';
import { sanitizeError } from '../utils/response';
import { notifyUser, notifyUnlessBlocked, allowedRecipients, sendPushToUsers } from '../utils/notify';
import { rankTeams } from '../utils/standings';
import { istDay } from '../utils/appTime';
import { isTournamentOrganiser } from '../utils/tournamentAuth';

// ────────────────────────────────────────────────────────────────────────────
// TOURNAMENT STANDINGS — points table with 3/1/0 scoring + NRR for cricket
// GET /tournaments/:id/standings
// ────────────────────────────────────────────────────────────────────────────

export async function getTournamentStandings(req: Request, res: Response) {
  try {
    const { id } = req.params;
    const { data: tournament } = await supabase
      .from('tournaments')
      .select('id, sport_id, format, tiebreaker_rules, qualifiers_per_group')
      .eq('id', id)
      .maybeSingle();
    if (!tournament) return res.status(404).json({ error: 'Tournament not found' });

    // Get all entries with team names
    const { data: entries } = await supabase
      .from('tournament_entries')
      .select('team_id, group_label, team:teams!team_id(id, name)')
      .eq('tournament_id', id)
      .in('status', ['approved', 'pending']);

    // Get completed matches
    const { data: matches } = await supabase
      .from('matches')
      .select('id, team_a_id, team_b_id, winner_team_id, score_summary, status')
      .eq('tournament_id', id)
      .eq('status', 'completed');

    // Check if cricket for NRR
    const { data: sport } = await supabase.from('sports').select('slug').eq('id', tournament.sport_id).maybeSingle();
    const isCricket = sport?.slug === 'cricket';

    // Build standings map
    const table = new Map<string, {
      teamId: string; team: string; groupLabel: string | null;
      played: number; won: number; lost: number; drawn: number; points: number;
      nrr: number; runsScored: number; oversFaced: number; runsConceded: number; oversBowled: number;
    }>();

    for (const e of entries ?? []) {
      const t = e.team as any;
      table.set(e.team_id, {
        teamId: e.team_id, team: t?.name ?? 'TBD', groupLabel: e.group_label ?? null,
        played: 0, won: 0, lost: 0, drawn: 0, points: 0,
        nrr: 0, runsScored: 0, oversFaced: 0, runsConceded: 0, oversBowled: 0,
      });
    }

    for (const m of matches ?? []) {
      const a = table.get(m.team_a_id);
      const b = table.get(m.team_b_id);
      if (a) a.played++;
      if (b) b.played++;

      if (m.winner_team_id) {
        const winner = table.get(m.winner_team_id);
        const loserId = m.winner_team_id === m.team_a_id ? m.team_b_id : m.team_a_id;
        const loser = table.get(loserId);
        if (winner) { winner.won++; winner.points += 3; }
        if (loser) { loser.lost++; }
      } else {
        // Draw
        if (a) { a.drawn++; a.points += 1; }
        if (b) { b.drawn++; b.points += 1; }
      }

      // NRR for cricket
      if (isCricket && m.score_summary) {
        const ss: any = m.score_summary;
        const parseScore = (s: string) => {
          const m2 = String(s).match(/^(\d+)/);
          return m2 ? parseInt(m2[1], 10) : 0;
        };
        const parseOvers = (s: string) => {
          const o = parseFloat(String(s));
          return isNaN(o) ? 0 : o;
        };
        // SC-256: the live cricket scorer writes the NESTED per-side summary
        // ({ runs, balls, score, wickets }), NOT the flat team_a_score/overs keys
        // this used to read — so runsScored + NRR were always 0 for cricket.
        // Mirror computeStats' fallback for runs, and derive overs from `balls`
        // (legal deliveries; overs = balls/6) since there's no overs field. The
        // flat keys still win when present (organiser fixture-editor results).
        // KNOWN SIMPLIFICATION: a side bowled out should count its FULL allotted
        // overs for NRR (ICC rule); we use actual balls/6. Deferred refinement.
        const aScore = ss.team_a_score ?? ss?.A?.score;
        const bScore = ss.team_b_score ?? ss?.B?.score;
        const oversOf = (flat: any, side: any) =>
          flat != null ? parseOvers(flat) : (side?.balls != null ? side.balls / 6 : 20);
        if (a && aScore != null) {
          a.runsScored += parseScore(aScore);
          a.oversFaced += oversOf(ss.team_a_overs, ss?.A);
          a.runsConceded += parseScore(bScore ?? '0');
          a.oversBowled += oversOf(ss.team_b_overs, ss?.B);
        }
        if (b && bScore != null) {
          b.runsScored += parseScore(bScore);
          b.oversFaced += oversOf(ss.team_b_overs, ss?.B);
          b.runsConceded += parseScore(aScore ?? '0');
          b.oversBowled += oversOf(ss.team_a_overs, ss?.A);
        }
      }
    }

    // Calculate NRR
    for (const row of table.values()) {
      if (isCricket && row.oversFaced > 0 && row.oversBowled > 0) {
        row.nrr = parseFloat(((row.runsScored / row.oversFaced) - (row.runsConceded / row.oversBowled)).toFixed(3));
      }
    }

    // SC-89: rank with the shared tiebreak ladder (points -> head-to-head ->
    // score-diff -> score-scored -> team_id), honouring configured
    // tiebreaker_rules — the SAME function the KO-qualification path uses, so
    // display and qualification always agree. Ranking is per group (teams only
    // play within their group); a single 'default' group for league formats.
    const tiebreakerRules = ((tournament as any).tiebreaker_rules ?? []) as any[];
    const rows = Array.from(table.values());
    const byGroup = new Map<string, typeof rows>();
    for (const row of rows) {
      const g = row.groupLabel ?? 'default';
      (byGroup.get(g) ?? byGroup.set(g, []).get(g)!).push(row);
    }
    const orderIndex = new Map<string, number>();
    let running = 0;
    for (const g of Array.from(byGroup.keys()).sort()) {
      const ids = rankTeams(byGroup.get(g)!.map((r) => r.teamId), matches ?? [], tiebreakerRules);
      for (const id of ids) orderIndex.set(id, running++);
    }
    const standings = rows.sort(
      (a, b) => (orderIndex.get(a.teamId) ?? 0) - (orderIndex.get(b.teamId) ?? 0),
    );

    // Mark the configured number of qualifiers per group (default 2).
    if (tournament.format === 'groups_knockout') {
      const qpg = Math.max(1, Number((tournament as any).qualifiers_per_group ?? 2));
      const seen = new Map<string, number>();
      for (const row of standings) {
        const g = row.groupLabel ?? 'default';
        const n = seen.get(g) ?? 0;
        if (n < qpg) (row as any).qualified = true;
        seen.set(g, n + 1);
      }
    }

    // SC-25: the FE StandingsRow reads team_name / team_id, but the rows carry
    // team / teamId — so every row rendered a blank name. Alias both (keep the
    // originals for any other consumer).
    const aliased = standings.map((r) => ({
      ...r,
      team_name: (r as any).team,
      team_id: (r as any).teamId,
    }));

    return res.json({ standings: aliased, isCricket });
  } catch {
    return res.status(500).json({ error: 'Internal server error' });
  }
}

// ────────────────────────────────────────────────────────────────────────────
// TOURNAMENT TOP PERFORMERS
// GET /tournaments/:id/top-performers
// ────────────────────────────────────────────────────────────────────────────

export async function getTournamentTopPerformers(req: Request, res: Response) {
  try {
    const { id } = req.params;
    const { data: tournament } = await supabase
      .from('tournaments')
      .select('sport_id')
      .eq('id', id)
      .maybeSingle();
    if (!tournament) return res.status(404).json({ error: 'Tournament not found' });

    // Get all completed matches
    const { data: matches } = await supabase
      .from('matches')
      .select('id, team_a_id, team_b_id, winner_team_id')
      .eq('tournament_id', id)
      .eq('status', 'completed');

    // Count wins per team
    const winCount = new Map<string, number>();
    for (const m of matches ?? []) {
      if (m.winner_team_id) {
        winCount.set(m.winner_team_id, (winCount.get(m.winner_team_id) ?? 0) + 1);
      }
    }

    // Get team names
    const teamIds = Array.from(winCount.keys());
    const { data: teams } = await supabase
      .from('teams')
      .select('id, name')
      .in('id', teamIds.length > 0 ? teamIds : ['__none__']);
    const teamMap = new Map((teams ?? []).map((t: any) => [t.id, t.name]));

    const topWins = Array.from(winCount.entries())
      .map(([teamId, wins]) => ({ teamId, teamName: teamMap.get(teamId) ?? 'Unknown', wins }))
      .sort((a, b) => b.wins - a.wins)
      .slice(0, 3);

    return res.json({ topWins });
  } catch {
    return res.status(500).json({ error: 'Internal server error' });
  }
}

// ────────────────────────────────────────────────────────────────────────────
// TOURNAMENT OFFICIALS
// ────────────────────────────────────────────────────────────────────────────

export async function addTournamentOfficial(req: Request, res: Response) {
  const userId = req.userId;
  if (!userId) return res.status(401).json({ error: 'Unauthorized' });
  try {
    const { id } = req.params;
    const { user_id, role } = req.body || {};
    if (!user_id || !role) return res.status(400).json({ error: 'user_id and role required' });

    const { data: tournament } = await supabase.from('tournaments').select('created_by').eq('id', id).maybeSingle();
    if (!tournament) return res.status(404).json({ error: 'Tournament not found' });
    if (!(await isTournamentOrganiser(id, userId))) return res.status(403).json({ error: 'Only organiser can add officials' });

    const { data, error } = await supabase
      .from('tournament_officials')
      .insert({ tournament_id: id, user_id, role })
      .select('*')
      .single();
    if (error?.code === '23505') return res.json({ success: true, alreadyAdded: true });
    if (error) return res.status(500).json({ error: sanitizeError(error) });

    // Notify the assigned official (consent-by-notification; they can step down
    // via self-remove). Block-respecting, best-effort — never fail the assign.
    try {
      const { data: t } = await supabase.from('tournaments').select('name').eq('id', id).maybeSingle();
      await notifyUnlessBlocked(userId, {
        userId: user_id,
        type: 'assigned_as_official',
        title: 'You’re a tournament official',
        body: `You were assigned as ${role} for ${t?.name ?? 'a tournament'}.`,
        data: { tournamentId: id, actorId: userId, role },
      });
    } catch { /* best-effort */ }
    return res.json({ official: data });
  } catch {
    return res.status(500).json({ error: 'Internal server error' });
  }
}

export async function removeTournamentOfficial(req: Request, res: Response) {
  const userId = req.userId;
  if (!userId) return res.status(401).json({ error: 'Unauthorized' });
  try {
    const { id, officialId } = req.params;
    const { data: tournament } = await supabase.from('tournaments').select('created_by').eq('id', id).maybeSingle();
    if (!tournament) return res.status(404).json({ error: 'Tournament not found' });

    // An official may STEP DOWN (self-remove), mirroring team self-leave; the
    // organiser may remove anyone.
    const { data: official } = await supabase
      .from('tournament_officials').select('user_id').eq('id', officialId).eq('tournament_id', id).maybeSingle();
    if (!official) return res.status(404).json({ error: 'Official not found' });
    const isOrganiser = await isTournamentOrganiser(id, userId);
    const isSelf = official.user_id === userId;
    if (!isOrganiser && !isSelf) {
      return res.status(403).json({ error: 'Only the organiser or the official themselves can remove' });
    }

    await supabase.from('tournament_officials').delete().eq('id', officialId).eq('tournament_id', id);
    return res.json({ success: true });
  } catch {
    return res.status(500).json({ error: 'Internal server error' });
  }
}

export async function getTournamentOfficials(req: Request, res: Response) {
  try {
    const { id } = req.params;
    const { data, error } = await supabase
      .from('tournament_officials')
      .select('id, role, created_at, user:users!user_id(id, name, username, profile_picture_url)')
      .eq('tournament_id', id);
    if (error) return res.status(500).json({ error: sanitizeError(error) });
    return res.json({ officials: data ?? [] });
  } catch {
    return res.status(500).json({ error: 'Internal server error' });
  }
}

// ────────────────────────────────────────────────────────────────────────────
// FEATURE 20 — Tournament Analytics
// GET /tournaments/:id/analytics
// ────────────────────────────────────────────────────────────────────────────

export async function getTournamentAnalytics(req: Request, res: Response) {
  const userId = req.userId;
  if (!userId) return res.status(401).json({ error: 'Unauthorized' });
  try {
    const { id } = req.params;
    const { data: t } = await supabase.from('tournaments').select('created_by').eq('id', id).maybeSingle();
    if (!t) return res.status(404).json({ error: 'Tournament not found' });
    if (!(await isTournamentOrganiser(id, userId))) return res.status(403).json({ error: 'Only the organiser can view analytics' });

    const [entriesRes, matchesRes] = await Promise.all([
      supabase.from('tournament_entries').select('id', { count: 'exact', head: true }).eq('tournament_id', id),
      supabase.from('matches').select('id, status').eq('tournament_id', id),
    ]);

    const matches = matchesRes.data ?? [];
    const completed = matches.filter((m) => m.status === 'completed').length;
    const pending = matches.filter((m) => m.status === 'scheduled' || m.status === 'live').length;
    const total = matches.length || 1;

    return res.json({
      registrations_count: entriesRes.count ?? 0,
      matches_completed: completed,
      matches_pending: pending,
      completion_percentage: Math.round((completed / total) * 100),
    });
  } catch {
    return res.status(500).json({ error: 'Internal server error' });
  }
}

// ────────────────────────────────────────────────────────────────────────────
// FEATURE 18 — Publish Scheduled Posts
// GET /dev/publish-scheduled-posts
// ────────────────────────────────────────────────────────────────────────────

export async function publishScheduledPosts(_req: Request, res: Response) {
  try {
    return res.json(await runPublishScheduledPosts());
  } catch {
    return res.status(500).json({ error: 'Internal server error' });
  }
}

// ────────────────────────────────────────────────────────────────────────────
// FEATURE 1 — Season Recap
// GET /users/:id/season-recap
// ────────────────────────────────────────────────────────────────────────────

export async function getSeasonRecap(req: Request, res: Response) {
  const { id } = req.params;
  try {
    // Current season = last 90 days
    const since = new Date(Date.now() - 90 * 86400000).toISOString();

    const [profilesRes, matchesRes, giftsRecvRes, giftsSentRes, followsRes] = await Promise.all([
      supabase.from('user_sport_profiles')
        .select('sport_id, rating, matches_played, wins, losses, draws')
        .eq('user_id', id),
      supabase.from('match_participants')
        .select('match_id, team_side, match:matches!inner(id, sport_id, status, winner_team_id, score_summary, created_at)')
        .eq('user_id', id)
        .gte('match.created_at', since),
      supabase.from('gift_transactions')
        .select('id', { count: 'exact', head: true })
        .eq('receiver_id', id)
        .gte('created_at', since),
      supabase.from('gift_transactions')
        .select('id', { count: 'exact', head: true })
        .eq('sender_id', id)
        .gte('created_at', since),
      supabase.from('follow_relationships')
        .select('id', { count: 'exact', head: true })
        .eq('following_id', id)
        .gte('created_at', since),
    ]);

    const profiles = profilesRes.data ?? [];
    const matches = (matchesRes.data ?? []).map((p: any) => p.match).filter(Boolean);
    const completed = matches.filter((m: any) => m.status === 'completed');

    // Best sport = highest rating
    const best = profiles.reduce((a: any, b: any) =>
      (b.rating ?? 0) > (a?.rating ?? 0) ? b : a, profiles[0] ?? null);

    const totalWins = profiles.reduce((s: number, p: any) => s + (p.wins ?? 0), 0);
    const totalLosses = profiles.reduce((s: number, p: any) => s + (p.losses ?? 0), 0);
    const totalDraws = profiles.reduce((s: number, p: any) => s + (p.draws ?? 0), 0);

    return res.json({
      recap: {
        totalMatches: completed.length,
        wins: totalWins,
        losses: totalLosses,
        draws: totalDraws,
        bestSportId: best?.sport_id ?? null,
        bestRating: best?.rating ?? 0,
        giftsReceived: giftsRecvRes.count ?? 0,
        giftsGiven: giftsSentRes.count ?? 0,
        followersGained: followsRes.count ?? 0,
        sportProfiles: profiles,
      },
    });
  } catch {
    return res.status(500).json({ error: 'Could not generate season recap' });
  }
}

// ────────────────────────────────────────────────────────────────────────────
// FEATURE 3 — Player of the Week
// GET /leaderboard/player-of-week
// ────────────────────────────────────────────────────────────────────────────

let potwCache: { data: any; at: number } | null = null;
const POTW_TTL = 24 * 60 * 60 * 1000; // 24h

export async function getPlayerOfWeek(req: Request, res: Response) {
  if (potwCache && Date.now() - potwCache.at < POTW_TTL) {
    return res.json(potwCache.data);
  }
  try {
    const weekAgo = new Date(Date.now() - 7 * 86400000).toISOString();
    // Get profiles with recent activity
    const { data: profiles } = await supabase
      .from('user_sport_profiles')
      .select('user_id, sport_id, rating, wins, matches_played, last_match_at')
      .gte('last_match_at', weekAgo)
      .order('rating', { ascending: false })
      .limit(100);

    if (!profiles || profiles.length === 0) {
      return res.json({ players: [] });
    }

    // Score = wins×3 + matches_played×1 + rating×0.01
    const scored = profiles.map((p) => ({
      ...p,
      score: (p.wins ?? 0) * 3 + (p.matches_played ?? 0) * 1 + (p.rating ?? 0) * 0.01,
    }));
    scored.sort((a, b) => b.score - a.score);

    // Top per sport
    const seen = new Set<string>();
    const top: typeof scored = [];
    for (const p of scored) {
      if (seen.has(p.sport_id)) continue;
      seen.add(p.sport_id);
      top.push(p);
    }

    // Enrich with user info
    const userIds = top.map((p) => p.user_id);
    const { data: users } = await supabase
      .from('users')
      .select('id, name, username, profile_picture_url, is_premium')
      .in('id', userIds)
      .is('deleted_at', null); // SC-78: exclude soft-deleted players
    const userMap = new Map((users ?? []).map((u: any) => [u.id, u]));

    const result = {
      // SC-78: drop players whose account is soft-deleted.
      players: top.filter((p) => userMap.has(p.user_id)).slice(0, 11).map((p) => ({
        user: userMap.get(p.user_id) ?? null,
        sport_id: p.sport_id,
        rating: p.rating,
        wins: p.wins,
        matches_played: p.matches_played,
        score: Math.round(p.score),
      })),
    };

    potwCache = { data: result, at: Date.now() };
    return res.json(result);
  } catch {
    return res.status(500).json({ error: 'Could not compute player of the week' });
  }
}

// ────────────────────────────────────────────────────────────────────────────
// FEATURE 6 — Nearby Matches
// GET /matches/nearby?city_id=X
// ────────────────────────────────────────────────────────────────────────────

export async function getNearbyMatches(req: Request, res: Response) {
  const userId = req.userId;
  if (!userId) return res.status(401).json({ error: 'Unauthorized' });
  try {
    const { city_id } = req.query as Record<string, string | undefined>;

    // Resolve city: param or user's own city
    let cityId = city_id;
    if (!cityId) {
      const { data: u } = await supabase.from('users').select('city_id').eq('id', userId).maybeSingle();
      cityId = u?.city_id ?? undefined;
    }
    if (!cityId) return res.json({ today: [], thisWeek: [], thisMonth: [] });

    const now = new Date();
    const endOfToday = new Date(now); endOfToday.setHours(23, 59, 59, 999);
    const endOfWeek = new Date(now.getTime() + 7 * 86400000);
    const endOfMonth = new Date(now.getTime() + 30 * 86400000);

    const { data: matches, error } = await supabase
      .from('matches')
      .select('id, sport_id, team_a_name, team_b_name, scheduled_at, venue, status, is_open, players_needed')
      .eq('city_id', cityId)
      .in('status', ['scheduled', 'live'])
      .order('scheduled_at', { ascending: true })
      .limit(50);
    if (error) return res.status(500).json({ error: sanitizeError(error) });

    const all = matches ?? [];
    const today = all.filter((m) => m.scheduled_at && new Date(m.scheduled_at) <= endOfToday);
    const thisWeek = all.filter((m) => m.scheduled_at && new Date(m.scheduled_at) > endOfToday && new Date(m.scheduled_at) <= endOfWeek);
    const thisMonth = all.filter((m) => m.scheduled_at && new Date(m.scheduled_at) > endOfWeek && new Date(m.scheduled_at) <= endOfMonth);

    return res.json({ today, thisWeek, thisMonth });
  } catch {
    return res.status(500).json({ error: 'Internal server error' });
  }
}

// ────────────────────────────────────────────────────────────────────────────
// FEATURE 9 — Smart Match Notification
// GET /dev/trigger-smart-match-notifications
// ────────────────────────────────────────────────────────────────────────────

// SC-93: the IST calendar day now lives in ../utils/appTime (one source of
// truth). Kept as a thin alias so existing scheduled-job dedupe callers here
// stay unchanged.
export function istDateStr(d: Date = new Date()): string {
  return istDay(d);
}

// Atomically claim "we're sending <jobType> to <userId> on <sentOn>". Returns
// true if this call won the claim (safe to send), false if it was already sent
// (unique violation on notification_sends). This makes the scheduled jobs safe
// to double-fire (multi-instance / overlapping runs) without duplicate pushes.
async function claimNotificationSend(userId: string, jobType: string, sentOn: string): Promise<boolean> {
  const { error } = await supabase
    .from('notification_sends')
    .insert({ user_id: userId, job_type: jobType, sent_on: sentOn });
  if (!error) return true;
  if ((error as { code?: string }).code === '23505') return false; // already sent today
  // On an unexpected error, fail closed (don't send) so we never risk a storm.
  return false;
}

// SC-143: undo a claim when the notification send FAILED, so the user is retried
// on the next run instead of being permanently marked-sent-but-unnotified (the
// dedup would otherwise block the retry forever). Best-effort — a stuck claim only
// delays one retry, never double-sends.
async function releaseNotificationSend(userId: string, jobType: string, sentOn: string): Promise<void> {
  try {
    await supabase
      .from('notification_sends')
      .delete()
      .eq('user_id', userId)
      .eq('job_type', jobType)
      .eq('sent_on', sentOn);
  } catch { /* best effort */ }
}

// SC-141: grouped row-count for `col IN ids` (+ optional filter), tallied in JS. One
// bounded fetch replaces N per-user COUNT(head) round-trips. The sets here are small
// (recent activity / a ≤100-user chunk), well under the fetch cap.
async function groupCount(
  table: string,
  col: string,
  ids: string[],
  apply?: (q: any) => any,
): Promise<Map<string, number>> {
  const counts = new Map<string, number>();
  if (ids.length === 0) return counts;
  let q: any = supabase.from(table).select(col).in(col, ids).limit(50000);
  if (apply) q = apply(q);
  const { data } = await q;
  for (const r of (data ?? []) as any[]) {
    const k = r[col] as string;
    counts.set(k, (counts.get(k) ?? 0) + 1);
  }
  return counts;
}

type NotifRow = { user_id: string; type: string; title: string; body: string; data: Record<string, unknown> };

// SC-141: batch a per-user daily notification job in chunks. Per chunk: one dedup
// lookup -> bulk claim -> bulk insert (per-row fallback on failure) -> best-effort
// push. Preserves the notification_sends dedup (at-most-once/day), the SC-143 claim/
// release (a failed row releases ONLY its own claim so it retries), and per-user
// failure isolation (a chunk-insert failure falls back to per-row — one bad row can
// never lose the chunk).
async function batchNotify(opts: {
  users: { id: string }[];
  jobType: string;
  sentOn: string;
  pushTitle: string;
  prepare: (chunkUsers: { id: string }[]) => Promise<{ rows: NotifRow[]; userIds: string[]; bodies: Map<string, string> }>;
  chunkSize?: number;
}): Promise<{ sent: number }> {
  const CHUNK = opts.chunkSize ?? 100;
  let sent = 0;
  for (let i = 0; i < opts.users.length; i += CHUNK) {
    const chunk = opts.users.slice(i, i + CHUNK);
    const ids = chunk.map((u) => u.id);
    // Dedup: who already got this job today.
    const { data: existing } = await supabase
      .from('notification_sends').select('user_id')
      .eq('job_type', opts.jobType).eq('sent_on', opts.sentOn).in('user_id', ids);
    const already = new Set((existing ?? []).map((r) => r.user_id as string));
    const fresh = chunk.filter((u) => !already.has(u.id));
    if (fresh.length === 0) continue;

    const { rows, userIds, bodies } = await opts.prepare(fresh);
    if (rows.length === 0) continue;

    // Claim (bulk). The single daily cron isn't concurrent, so this is race-free in
    // practice; the UNIQUE(user_id, job_type, sent_on) is the backstop.
    const { error: claimErr } = await supabase.from('notification_sends')
      .insert(userIds.map((uid) => ({ user_id: uid, job_type: opts.jobType, sent_on: opts.sentOn })));
    if (claimErr) continue; // concurrent claim conflict — retried next run

    const okIds: string[] = [];
    const { error: insErr } = await supabase.from('notifications').insert(rows);
    if (insErr) {
      // SC-141/SC-143: per-row fallback so one bad row can't lose the chunk; release
      // the claim of any row that still fails so it retries next run.
      for (let k = 0; k < rows.length; k++) {
        const { error: e2 } = await supabase.from('notifications').insert(rows[k]);
        if (e2) await releaseNotificationSend(userIds[k], opts.jobType, opts.sentOn);
        else okIds.push(userIds[k]);
      }
      console.warn(`[${opts.jobType}] chunk insert failed, per-row fallback`, insErr.message); // eslint-disable-line no-console
    } else {
      okIds.push(...userIds);
    }
    sent += okIds.length;

    // Push (best-effort) — one token fetch for the chunk, only for created rows.
    await sendPushToUsers(okIds.map((uid) => ({ userId: uid, type: opts.jobType, title: opts.pushTitle, body: bodies.get(uid) ?? '' })));
  }
  return { sent };
}

// ── Job: publish due scheduled posts (idempotent — nulling scheduled_at) ──────
export async function runPublishScheduledPosts(): Promise<{ published: number }> {
  const now = new Date().toISOString();
  const { data, error } = await supabase
    .from('community_posts')
    .update({ scheduled_at: null })
    .lte('scheduled_at', now)
    .not('scheduled_at', 'is', null)
    .select('id');
  if (error) throw new Error(error.message);
  return { published: data?.length ?? 0 };
}

// ── Job: smart-match notifications (deduped per user/day) ─────────────────────
export async function runSmartMatchNotifications(): Promise<{ sent: number }> {
  const threeDaysAgo = new Date(Date.now() - 3 * 86400000).toISOString();
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const tomorrow = new Date(today.getTime() + 86400000);
  const sentOn = istDateStr();

  // SC-67 (set-based): the previous SC-66 fix reached every eligible user but did
  // it with a per-user match query paginated over ALL ~10k inactive users — O(N)
  // sequential round-trips, minutes per run, HTTP timeouts. Instead:
  //   (1) ONE query for today's open matches, reduced to one per city, so we only
  //       ever consider cities that actually have something to notify about;
  //   (2) ONE query for inactive (>3d, city-not-null) users IN those cities;
  //   (3) a bounded claim+notify (no per-user SELECT — the match comes from the
  //       in-memory map). Work is O(open-match-cities + candidates-in-them), not
  //       O(all inactive users). Dedupe (notification_sends) is unchanged.
  const { data: openMatches } = await supabase
    .from('matches')
    .select('id, team_a_name, venue, city_id')
    .eq('is_open', true)
    .gte('scheduled_at', today.toISOString())
    .lt('scheduled_at', tomorrow.toISOString())
    .not('city_id', 'is', null);
  if (!openMatches || openMatches.length === 0) return { sent: 0 };

  // One representative open match per city.
  const matchByCity = new Map<string, { id: string; team_a_name: string; venue: string | null }>();
  for (const m of openMatches) {
    const cid = m.city_id as string | null;
    if (cid && !matchByCity.has(cid)) {
      matchByCity.set(cid, { id: m.id as string, team_a_name: m.team_a_name as string, venue: (m.venue as string | null) ?? null });
    }
  }
  const cityIds = [...matchByCity.keys()];
  if (cityIds.length === 0) return { sent: 0 };

  // Inactive, city'd users only in the cities that have a match today.
  const { data: candidates } = await supabase
    .from('users')
    .select('id, city_id, name')
    .lt('last_active_at', threeDaysAgo)
    .in('city_id', cityIds)
    .is('deleted_at', null); // SC-140: never notify a soft-deleted account
  const cands = (candidates ?? []).filter(
    (u) => u.city_id && matchByCity.has(u.city_id as string),
  );
  if (cands.length === 0) return { sent: 0 };

  // BULK dedupe: one query for who already got smart_match today, then send to
  // the rest in a single bulk insert each — no per-user round-trips. This is
  // O(few queries) regardless of how many candidates a busy city has (the
  // per-user claim loop above was still minutes for a ~200-user city). The
  // notification_sends UNIQUE(user_id, job_type, sent_on) remains the source of
  // truth for the dedupe.
  const { data: sentRows } = await supabase
    .from('notification_sends')
    .select('user_id')
    .eq('job_type', 'smart_match')
    .eq('sent_on', sentOn)
    .in('user_id', cands.map((u) => u.id as string));
  const already = new Set((sentRows ?? []).map((r) => r.user_id as string));
  let toSend = cands.filter((u) => !already.has(u.id as string));
  // SC-140: prefs gate the ROW — drop users who turned off the 'matches' category.
  const smAllowed = new Set(await allowedRecipients(toSend.map((u) => u.id as string), 'smart_match'));
  toSend = toSend.filter((u) => smAllowed.has(u.id as string));
  if (toSend.length === 0) return { sent: 0 };

  // Claim (bulk). The single daily cron isn't concurrent, so a bulk insert of
  // the not-yet-sent rows is race-free in practice; the UNIQUE constraint is the
  // backstop. Abort the send if the claim fails so we never notify without a
  // recorded send.
  const { error: claimErr } = await supabase
    .from('notification_sends')
    .insert(toSend.map((u) => ({ user_id: u.id as string, job_type: 'smart_match', sent_on: sentOn })));
  if (claimErr) return { sent: 0 };

  const { error: insErr } = await supabase.from('notifications').insert(
    toSend.map((u) => {
      const m = matchByCity.get(u.city_id as string)!;
      return {
        user_id: u.id as string,
        type: 'smart_match',
        title: 'Match near you today!',
        body: `🎮 ${m.team_a_name} is looking for players at ${m.venue ?? 'a venue nearby'}`,
        data: { matchId: m.id, screen: 'MatchDetail' },
      };
    }),
  );
  if (insErr) {
    // SC-143: the bulk send failed → release the WHOLE batch's claims so it's
    // retried next run instead of being permanently lost (claim-before-send).
    await supabase
      .from('notification_sends')
      .delete()
      .eq('job_type', 'smart_match')
      .eq('sent_on', sentOn)
      .in('user_id', toSend.map((u) => u.id as string));
    console.warn('[smart-match] bulk insert failed, released', toSend.length, 'claims:', insErr.message); // eslint-disable-line no-console
    return { sent: 0 };
  }
  return { sent: toSend.length };
}

// 15-MINUTE PRE-MATCH REMINDER SWEEP. The reminder LOGIC already existed but only
// fired from GET /users/me (app-open) — so a participant NOT in the app never got
// it. This dedicated sweep (wired to a 5-min in-process interval, like the
// scheduled-post publisher) makes it reliable: it scans matches starting in the
// next 15 minutes and notifies each match's PARTICIPANTS + assigned UMPIRE
// (in-app notification always lands; FCM push is best-effort — push delivery is a
// deferred launch gate). Idempotent via notification_sends: job_type
// 'match_reminder:<matchId>' + sent_on = the match's date → once per user/match.
export async function runMatchReminderSweep(): Promise<{ sent: number }> {
  const now = new Date();
  const in15 = new Date(now.getTime() + 15 * 60 * 1000);
  const { data: soon } = await supabase
    .from('matches')
    .select('id, team_a_name, team_b_name, scheduled_at, umpire_id, status')
    .gte('scheduled_at', now.toISOString())
    .lte('scheduled_at', in15.toISOString())
    .in('status', ['scheduled', 'upcoming', 'live']);
  if (!soon || soon.length === 0) return { sent: 0 };

  let sent = 0;
  for (const m of soon) {
    const matchDate = String(m.scheduled_at).slice(0, 10);
    const { data: parts } = await supabase
      .from('match_participants').select('user_id').eq('match_id', m.id);
    const recipients = new Set<string>((parts ?? []).map((p) => p.user_id as string).filter(Boolean));
    if (m.umpire_id) recipients.add(m.umpire_id as string);
    for (const uid of recipients) {
      // Claim first — a UNIQUE(user_id, job_type, sent_on) violation means this
      // user was already reminded for this match (safe across restarts / ticks).
      const { error: claimErr } = await supabase
        .from('notification_sends')
        .insert({ user_id: uid, job_type: `match_reminder:${m.id}`, sent_on: matchDate });
      if (claimErr) continue;
      await notifyUser({
        userId: uid,
        type: 'match_reminder',
        title: 'Match reminder',
        body: `⏰ ${m.team_a_name ?? 'Team A'} vs ${m.team_b_name ?? 'Team B'} starts in ~15 minutes!`,
        data: { matchId: m.id, screen: 'MatchDetail' },
      });
      sent++;
    }
  }
  return { sent };
}

export async function triggerSmartMatchNotifications(_req: Request, res: Response) {
  try {
    return res.json({ success: true, ...(await runSmartMatchNotifications()) });
  } catch {
    return res.status(500).json({ error: 'Internal server error' });
  }
}

// ────────────────────────────────────────────────────────────────────────────
// FEATURE 10 — Rating Milestone Check
// Called after ELO update in completeMatch. Checks if a user crossed a
// milestone boundary and fires a special notification.
// ────────────────────────────────────────────────────────────────────────────

const MILESTONES = [1000, 1100, 1200, 1300, 1400, 1500, 1800];

export async function checkRatingMilestone(
  userId: string,
  sportId: string,
  oldRating: number,
  newRating: number,
): Promise<void> {
  for (const m of MILESTONES) {
    if (oldRating < m && newRating >= m) {
      // Lookup sport name for the message
      const { data: sport } = await supabase
        .from('sports')
        .select('name')
        .eq('id', sportId)
        .maybeSingle();
      const sportName = sport?.name ?? 'your sport';
      // SC-223: single, pref-gated notification. Previously this did a direct
      // insert (ungated, bypassing the Milestones toggle) AND a notifyUser —
      // double-sending when the toggle was ON and leaking one when OFF.
      try {
        await notifyUser({
          userId,
          type: 'rating_milestone',
          title: `Rating milestone! 🎉`,
          body: `You crossed ${m} rating in ${sportName}! Amazing achievement!`,
          data: { milestone: String(m), sportId, screen: 'SportProfile' },
        });
      } catch { /* best effort */ }
      break; // only one milestone per update
    }
  }
}

// ────────────────────────────────────────────────────────────────────────────
// FEATURE 11 — Inactivity Re-engagement
// GET /dev/trigger-reengagement
// ────────────────────────────────────────────────────────────────────────────

export async function runReEngagement(): Promise<{ sent: number }> {
  const sevenDaysAgo = new Date(Date.now() - 7 * 86400000).toISOString();
  const sentOn = istDateStr();

  // SC-215: cooldown + rotation. Previously this deduped only per-day, so a
  // dormant user got "we miss you" EVERY day, and `.limit(200)` with no ordering
  // meant only the first ~200 dormant users were ever reached.
  //  • Cooldown: exclude anyone re-engaged within COOLDOWN_DAYS (notification_sends
  //    sent_on >= cutoff) → at most once per window, not daily.
  //  • Rotation: the cooldown itself rotates the pool (reached users drop out for
  //    the window), and we scan a window far wider than the batch so cooled users
  //    don't starve it — over the window the whole dormant pool gets reached.
  const COOLDOWN_DAYS = 7;
  const BATCH = 200;
  const cooldownCutoffOn = istDateStr(new Date(Date.now() - COOLDOWN_DAYS * 86400000));
  const { data: recent } = await supabase
    .from('notification_sends')
    .select('user_id')
    .eq('job_type', 'reengagement')
    .gte('sent_on', cooldownCutoffOn);
  const cooling = new Set((recent ?? []).map((r) => r.user_id as string));

  const { data: dormant } = await supabase
    .from('users')
    .select('id, name, city_id')
    .lt('last_active_at', sevenDaysAgo)
    .is('deleted_at', null) // SC-140: never notify a soft-deleted account
    .order('last_active_at', { ascending: true }) // most-dormant first
    .limit(BATCH * 12); // wide window so cooled users don't starve the batch
  const eligible = (dormant ?? []).filter((u) => !cooling.has(u.id as string)).slice(0, BATCH);

  // SC-140: prefs gate the ROW (one bulk lookup) — drop users who opted out.
  const reAllowed = new Set(await allowedRecipients(eligible.map((u) => u.id as string), 'reengagement'));
  const users = eligible.filter((u) => reAllowed.has(u.id as string)).map((u) => ({ id: u.id as string }));

  // SC-141: chunked bulk claim+insert (was a per-user loop with ~5 queries/user).
  return batchNotify({
    users, jobType: 'reengagement', sentOn, pushTitle: 'We miss you!',
    prepare: async (chunkUsers) => {
      const ids = chunkUsers.map((u) => u.id);
      const unread = await groupCount('notifications', 'user_id', ids, (q) => q.eq('read', false));
      const followers = await groupCount('follow_relationships', 'following_id', ids, (q) => q.gte('created_at', sevenDaysAgo));
      const rows: NotifRow[] = []; const userIds: string[] = []; const bodies = new Map<string, string>();
      for (const u of chunkUsers) {
        const un = unread.get(u.id) ?? 0; const nf = followers.get(u.id) ?? 0;
        const body = un > 0 ? `You have ${un} unread notifications in SportClan`
          : nf > 0 ? `${nf} players followed you while you were away!`
          : `Your SportClan clan misses you! 🏆 See what's happening`;
        rows.push({ user_id: u.id, type: 'reengagement', title: 'We miss you!', body, data: { screen: 'HomeMain' } });
        userIds.push(u.id); bodies.set(u.id, body);
      }
      return { rows, userIds, bodies };
    },
  });
}

export async function triggerReEngagement(_req: Request, res: Response) {
  try {
    return res.json({ success: true, ...(await runReEngagement()) });
  } catch {
    return res.status(500).json({ error: 'Internal server error' });
  }
}

// ────────────────────────────────────────────────────────────────────────────
// FEATURE 2 — Weekly Digest
// GET /dev/trigger-weekly-digest
// ────────────────────────────────────────────────────────────────────────────

export async function runWeeklyDigest(): Promise<{ sent: number }> {
  const weekAgo = new Date(Date.now() - 7 * 86400000).toISOString();
  const monthAgo = new Date(Date.now() - 30 * 86400000).toISOString();
  const nowIso = new Date().toISOString();
  const sentOn = istDateStr();

  // Active users = logged in within 30 days.
  const { data: activeUsers } = await supabase
    .from('users')
    .select('id, name')
    .gte('last_active_at', monthAgo)
    .is('deleted_at', null) // SC-140: never notify a soft-deleted account
    .limit(500);

  // SC-140: prefs gate the ROW (one bulk lookup).
  const dgAllowed = new Set(await allowedRecipients((activeUsers ?? []).map((u) => u.id as string), 'weekly_digest'));
  const users = (activeUsers ?? []).filter((u) => dgAllowed.has(u.id as string)).map((u) => ({ id: u.id as string }));

  // SC-141: chunked bulk claim+insert (was a per-user loop with ~5 queries/user).
  return batchNotify({
    users, jobType: 'weekly_digest', sentOn, pushTitle: 'Your weekly digest',
    prepare: async (chunkUsers) => {
      const ids = chunkUsers.map((u) => u.id);
      const followers = await groupCount('follow_relationships', 'following_id', ids, (q) => q.gte('created_at', weekAgo));
      // SC-216: "matches played this week". match_participants has NO timestamp,
      // so the all-time count mislabeled lifetime matches as weekly AND defeated
      // the zero-activity skip below (anyone who ever played got a digest). Count
      // via the match date instead — participations in matches whose scheduled_at
      // falls in the past week (bounded to <= now so future-scheduled don't count),
      // joined through the match_participants→matches FK.
      const matches = new Map<string, number>();
      {
        const { data: mp } = await supabase
          .from('match_participants')
          .select('user_id, matches!inner(scheduled_at)')
          .in('user_id', ids)
          .gte('matches.scheduled_at', weekAgo)
          .lte('matches.scheduled_at', nowIso)
          .limit(50000);
        for (const r of (mp ?? []) as Array<{ user_id: string }>) {
          matches.set(r.user_id, (matches.get(r.user_id) ?? 0) + 1);
        }
      }
      const rows: NotifRow[] = []; const userIds: string[] = []; const bodies = new Map<string, string>();
      for (const u of chunkUsers) {
        const nf = followers.get(u.id) ?? 0; const mp = matches.get(u.id) ?? 0;
        if (nf === 0 && mp === 0) continue; // skip users with no weekly activity
        const body = `📊 Your week: +${nf} followers, ${mp} matches played`;
        rows.push({ user_id: u.id, type: 'weekly_digest', title: 'Your weekly digest', body, data: { followers: nf, matches: mp } });
        userIds.push(u.id); bodies.set(u.id, body);
      }
      return { rows, userIds, bodies };
    },
  });
}

export async function triggerWeeklyDigest(_req: Request, res: Response) {
  try {
    return res.json({ success: true, ...(await runWeeklyDigest()) });
  } catch {
    return res.status(500).json({ error: 'Internal server error' });
  }
}
