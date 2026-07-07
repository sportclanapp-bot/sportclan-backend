import { Request, Response } from 'express';
import { supabase } from '../utils/supabase';
import { sanitizeError } from '../utils/response';
import { notifyUser, notifyUnlessBlocked } from '../utils/notify';
import { rankTeams } from '../utils/standings';
import { istDay } from '../utils/appTime';

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
        if (a && ss.team_a_score) {
          a.runsScored += parseScore(ss.team_a_score);
          a.oversFaced += parseOvers(ss.team_a_overs ?? '20');
          a.runsConceded += parseScore(ss.team_b_score ?? '0');
          a.oversBowled += parseOvers(ss.team_b_overs ?? '20');
        }
        if (b && ss.team_b_score) {
          b.runsScored += parseScore(ss.team_b_score);
          b.oversFaced += parseOvers(ss.team_b_overs ?? '20');
          b.runsConceded += parseScore(ss.team_a_score ?? '0');
          b.oversBowled += parseOvers(ss.team_a_overs ?? '20');
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
    if (tournament.created_by !== userId) return res.status(403).json({ error: 'Only organiser can add officials' });

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
    const isOrganiser = tournament.created_by === userId;
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
    if (t.created_by !== userId) return res.status(403).json({ error: 'Only the organiser can view analytics' });

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
    .in('city_id', cityIds);
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
  const toSend = cands.filter((u) => !already.has(u.id as string));
  if (toSend.length === 0) return { sent: 0 };

  // Claim (bulk). The single daily cron isn't concurrent, so a bulk insert of
  // the not-yet-sent rows is race-free in practice; the UNIQUE constraint is the
  // backstop. Abort the send if the claim fails so we never notify without a
  // recorded send.
  const { error: claimErr } = await supabase
    .from('notification_sends')
    .insert(toSend.map((u) => ({ user_id: u.id as string, job_type: 'smart_match', sent_on: sentOn })));
  if (claimErr) return { sent: 0 };

  await supabase.from('notifications').insert(
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
  return { sent: toSend.length };
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
      await supabase.from('notifications').insert({
        user_id: userId,
        type: 'rating_milestone',
        title: `Rating milestone! 🎉`,
        body: `You crossed ${m} rating in ${sportName}! Amazing achievement!`,
        data: { milestone: m, sportId, screen: 'SportProfile' },
      });
      try {
        await notifyUser({ userId, type: 'rating_milestone', title: 'Rating milestone!', body: `🎉 You crossed ${m} rating in ${sportName}!` });
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
  const { data: dormant } = await supabase
    .from('users')
    .select('id, name, city_id')
    .lt('last_active_at', sevenDaysAgo)
    .limit(200);

  let sent = 0;
  {
    for (const user of dormant ?? []) {
      if (!(await claimNotificationSend(user.id, 'reengagement', sentOn))) continue;
      // Check for unread messages
      const { count: unread } = await supabase
        .from('notifications')
        .select('id', { count: 'exact', head: true })
        .eq('user_id', user.id)
        .eq('read', false);

      // Check new followers
      const { count: newFollowers } = await supabase
        .from('follow_relationships')
        .select('id', { count: 'exact', head: true })
        .eq('following_id', user.id)
        .gte('created_at', sevenDaysAgo);

      let body: string;
      if ((unread ?? 0) > 0) {
        body = `You have ${unread} unread notifications in SportClan`;
      } else if ((newFollowers ?? 0) > 0) {
        body = `${newFollowers} players followed you while you were away!`;
      } else {
        body = `Your SportClan clan misses you! 🏆 See what's happening`;
      }

      await supabase.from('notifications').insert({
        user_id: user.id,
        type: 'reengagement',
        title: 'We miss you!',
        body,
        data: { screen: 'HomeMain' },
      });
      try {
        await notifyUser({ userId: user.id, type: 'reengagement', title: 'We miss you!', body });
      } catch { /* best effort */ }
      sent++;
    }
  }
  return { sent };
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
  const sentOn = istDateStr();

  // Active users = logged in within 30 days
  const { data: activeUsers } = await supabase
    .from('users')
    .select('id, name')
    .gte('last_active_at', monthAgo)
    .limit(500);

  let sent = 0;
  {
    for (const user of activeUsers ?? []) {
      const [followsRes, matchesRes] = await Promise.all([
        supabase.from('follow_relationships')
          .select('id', { count: 'exact', head: true })
          .eq('following_id', user.id)
          .gte('created_at', weekAgo),
        supabase.from('match_participants')
          .select('match_id', { count: 'exact', head: true })
          .eq('user_id', user.id),
      ]);

      const newFollowers = followsRes.count ?? 0;
      const matchesPlayed = matchesRes.count ?? 0;

      if (newFollowers === 0 && matchesPlayed === 0) continue;
      if (!(await claimNotificationSend(user.id, 'weekly_digest', sentOn))) continue;

      const body = `📊 Your week: +${newFollowers} followers, ${matchesPlayed} matches played`;
      await supabase.from('notifications').insert({
        user_id: user.id,
        type: 'weekly_digest',
        title: 'Your weekly digest',
        body,
        data: { followers: newFollowers, matches: matchesPlayed },
      });
      try {
        await notifyUser({ userId: user.id, type: 'weekly_digest', title: 'Your weekly digest', body });
      } catch { /* best effort */ }
      sent++;
    }
  }
  return { sent };
}

export async function triggerWeeklyDigest(_req: Request, res: Response) {
  try {
    return res.json({ success: true, ...(await runWeeklyDigest()) });
  } catch {
    return res.status(500).json({ error: 'Internal server error' });
  }
}
