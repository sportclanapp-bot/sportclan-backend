import { Request, Response } from 'express';
import { supabase } from '../utils/supabase';
import { calculateElo } from '../utils/ratingEngine';
import { notifyUser, notifyUsers, matchAudienceIds } from '../utils/notify';
import { isTournamentOrganiser, canOfficiateMatch } from '../utils/tournamentAuth';
import { blockedUserIds } from '../utils/blocks';
import { upsertVenue } from './venues.controller';
import { awardCoins } from '../utils/coins';
import { resolveSportId } from '../utils/sportId';
import { parsePagination, pageMeta, isRangeError } from '../utils/pagination';
import { sanitizeError } from '../utils/response';
import { validateSportForCreate } from '../utils/sports';
import { isTerminalMatchStatus, ARRAY_LIMITS, tooManyItems } from '../utils/validation';
import { calculateAndSetMVP } from './matchFeatures.controller';
import { advanceTournamentWinner } from './tournaments.controller';
import { recomputeSummary, writeCricketInningsStats } from './scoring.controller';

// POST /matches — create. FREE for all (Change #6).
export async function createMatch(req: Request, res: Response) {
  const userId = req.userId;
  if (!userId) return res.status(401).json({ error: 'Unauthorized' });
  try {
    const {
      sport_id,
      team_a_id,
      team_b_id,
      team_a_name,
      team_b_name,
      scheduled_at,
      venue,
      city_id,
      format,
      overs,
      tournament_id,
      is_open,
      players_needed,
      is_ranked,
      join_policy,
    } = req.body || {};
    if (!sport_id) return res.status(400).json({ error: 'sport_id is required' });
    // SC-279: per-match join policy. 'open' (default) = instant join_open_match;
    // 'approval' routes joins through match_join_requests (creator approves).
    const joinPolicy = join_policy === 'approval' ? 'approval' : 'open';
    // Validate the sport (unknown/malformed/deactivated → clean 400, not a 500).
    const sportErr = await validateSportForCreate(sport_id);
    if (sportErr) return res.status(400).json({ error: sportErr });
    // A ranked match counts toward ELO / leaderboards, so it must be played
    // between two REGISTERED teams (free-text sides have no roster to attribute
    // stats to). Per-side lineup (>=2) is enforced at completion (A5-003 P3).
    if (is_ranked && (!team_a_id || !team_b_id)) {
      return res.status(400).json({ error: 'Ranked matches require two registered teams.' });
    }
    // SC-245: a team can't play itself — a nonsensical fixture and (if ranked)
    // an ambiguous winner/attribution. Reject when both sides are the SAME
    // registered team. Free-text-name-only sides have no id to compare, so this
    // only fires for the team-vs-team path.
    if (team_a_id && team_b_id && team_a_id === team_b_id) {
      return res.status(400).json({ error: 'A team can’t play itself — pick two different teams.', code: 'SAME_TEAM' });
    }
    const { data, error } = await supabase
      .from('matches')
      .insert({
        sport_id,
        tournament_id: tournament_id || null,
        team_a_id: team_a_id || null,
        team_b_id: team_b_id || null,
        team_a_name: team_a_name || null,
        team_b_name: team_b_name || null,
        scheduled_at: scheduled_at || null,
        venue: venue || null,
        city_id: city_id || null,
        format: format || null,
        overs: overs ?? null,
        status: 'scheduled',
        is_open: !!is_open,
        players_needed: players_needed ?? 0,
        is_ranked: !!is_ranked,
        join_policy: joinPolicy,
        created_by: userId,
      })
      .select('*')
      .single();
    if (error || !data) return res.status(500).json({ error: sanitizeError(error) || 'Failed to create match' });

    // SC-281: seed the CREATOR into an open/pickup match. A pickup organiser is
    // a player ("I + N more"), but createMatch never added them to
    // match_participants — so they got no matches_played/MVP credit at
    // completion and the slot math was off by one (players_needed = players
    // needed BESIDES the creator). Side 'A' (same default as join_open_match).
    // Best-effort: a failure here doesn't fail the create.
    if (data.is_open) {
      const { error: seedErr } = await supabase
        .from('match_participants')
        .insert({ match_id: data.id, user_id: userId, team_side: 'A' });
      if (seedErr && (seedErr as { code?: string }).code !== '23505') {
        console.warn('[create-match] creator seed failed', (seedErr as { message?: string }).message); // eslint-disable-line no-console
      }
    }

    // Best-effort venue upsert — tracks frequently-used venues for the
    // autocomplete in CreateMatchScreen. Errors are swallowed.
    if (venue && typeof venue === 'string') {
      void upsertVenue(venue, city_id ?? null, userId);
    }

    return res.json({ match: data });
  } catch (e) {
    return res.status(500).json({ error: 'Internal server error' });
  }
}

// GET /matches/open — list open matches (is_open=true, not yet completed).
// Optional sport_id and city_id filters. Ordered by scheduled_at ascending so
// the soonest match shows first.
export async function listOpenMatches(req: Request, res: Response) {
  const userId = req.userId;
  if (!userId) return res.status(401).json({ error: 'Unauthorized' });
  try {
    const { sport_id, city_id } = req.query as Record<string, string | undefined>;
    const resolvedSportId = await resolveSportId(sport_id);
    // SC-263: a "suggested for you" match you CREATED, one that's already FULL, or
    // one you've already JOINED is a silly suggestion. Exclude all three. (Single
    // caller = HomeScreen, verified — safe to filter server-side. Sport/city
    // relevance ranking is a later feature, not this bug.)
    const { data: joinedRows } = await supabase
      .from('match_participants').select('match_id').eq('user_id', userId);
    const joinedIds = Array.from(new Set((joinedRows ?? []).map((r) => r.match_id as string)));
    let query = supabase
      .from('matches')
      .select('*')
      .eq('is_open', true)
      .in('status', ['scheduled', 'upcoming'])
      .neq('created_by', userId) // not your own
      .gt('players_needed', 0) // not full (also drops null)
      .order('scheduled_at', { ascending: true })
      .limit(100);
    if (joinedIds.length > 0) query = query.not('id', 'in', `(${joinedIds.join(',')})`);
    if (resolvedSportId) query = query.eq('sport_id', resolvedSportId);
    if (city_id) query = query.eq('city_id', city_id);
    const { data, error } = await query;
    if (error) return res.status(500).json({ error: sanitizeError(error) });
    const matches = data ?? [];

    // SC-273: relevance ranking. A deterministic, EXPLAINABLE weighted sort —
    // not AI/ML. We reorder the open matches by how relevant each is to THIS
    // user, using data we already have. SOFT not HARD: this only re-orders;
    // nothing is filtered out here (the only excludes are the SC-263
    // correctness ones above). A user with no sports / no city contributes 0
    // on those axes and degrades cleanly to soonest-first — never an empty
    // card. All context reads are best-effort: any failure just means that
    // signal scores 0, so a DB hiccup degrades ordering, it never errors.
    //
    // Weights, and why:
    //   sport you play    +100   dominant axis — a match in a sport you don't
    //                            play is near-useless however near/soon it is.
    //   same city          +40   you can physically show up; ranks below sport
    //                            but above any combination of refinements
    //                            (40 > 15 + 15).
    //   close ELO band  +15/+8   a competitive, balanced game — within 150 /
    //                            300 rating points of the match creator in the
    //                            match's sport (only when you're rated in it).
    //   timing     +15/10/5/0    a soon match needs players NOW (≤48h / ≤7d /
    //                            ≤30d / farther); a stale past-dated open match
    //                            is penalised −25.
    // Everything is additive onto 0, ties break by soonest scheduled_at then id
    // (fully deterministic).
    if (matches.length > 1) {
      const [meRes, sportsRes, myRatingsRes] = await Promise.all([
        supabase.from('users').select('city_id').eq('id', userId).maybeSingle(),
        supabase.from('user_sports').select('sport_id').eq('user_id', userId),
        supabase.from('user_sport_profiles').select('sport_id, rating').eq('user_id', userId),
      ]);
      const myCityId = (meRes.data?.city_id as string | null) ?? null;
      const mySports = new Set<string>((sportsRes.data ?? []).map((r) => r.sport_id as string));
      const myRating = new Map<string, number>();
      for (const r of myRatingsRes.data ?? []) {
        if (r.sport_id != null && r.rating != null) myRating.set(r.sport_id as string, Number(r.rating));
      }

      // Match skill proxy = the creator's rating in the match's sport. One
      // bounded query for all candidate creators.
      const creatorIds = Array.from(
        new Set(matches.map((m) => m.created_by as string | null).filter(Boolean) as string[]),
      );
      const creatorRating = new Map<string, number>(); // key `${creatorId}:${sportId}`
      if (creatorIds.length > 0) {
        const { data: crs } = await supabase
          .from('user_sport_profiles')
          .select('user_id, sport_id, rating')
          .in('user_id', creatorIds);
        for (const r of crs ?? []) {
          if (r.rating != null) creatorRating.set(`${r.user_id}:${r.sport_id}`, Number(r.rating));
        }
      }

      const now = Date.now();
      const DAY = 86400000;
      const relevance = (m: (typeof matches)[number]): number => {
        let s = 0;
        const sport = m.sport_id as string | null;
        if (sport && mySports.has(sport)) s += 100;
        if (myCityId && m.city_id && m.city_id === myCityId) s += 40;
        if (sport && myRating.has(sport)) {
          const cr = creatorRating.get(`${m.created_by}:${sport}`);
          if (cr != null) {
            const gap = Math.abs(myRating.get(sport)! - cr);
            if (gap <= 150) s += 15;
            else if (gap <= 300) s += 8;
          }
        }
        const when = m.scheduled_at ? new Date(m.scheduled_at as string).getTime() : NaN;
        if (!Number.isNaN(when)) {
          const dt = when - now;
          if (dt < 0) s -= 25;
          else if (dt <= 2 * DAY) s += 15;
          else if (dt <= 7 * DAY) s += 10;
          else if (dt <= 30 * DAY) s += 5;
        }
        return s;
      };

      const scored = matches.map((m) => ({
        m,
        s: relevance(m),
        t: m.scheduled_at ? new Date(m.scheduled_at as string).getTime() : Infinity,
      }));
      scored.sort((a, b) => (b.s - a.s) || (a.t - b.t) || String(a.m.id).localeCompare(String(b.m.id)));
      return res.json({ matches: scored.map((x) => x.m) });
    }

    return res.json({ matches });
  } catch (e) {
    return res.status(500).json({ error: 'Internal server error' });
  }
}

// POST /matches/:id/rate  { matchQuality: 1-5, wouldPlayAgain: boolean }
// Inserts one row per (match, rater) into match_ratings. Returns the
// existing row if the user has already rated this match.
export async function rateMatchHandler(req: Request, res: Response) {
  const userId = req.userId;
  if (!userId) return res.status(401).json({ error: 'Unauthorized' });
  try {
    const { id } = req.params;
    const { matchQuality, wouldPlayAgain } = req.body ?? {};
    if (typeof matchQuality !== 'number' || matchQuality < 1 || matchQuality > 5) {
      return res.status(400).json({ error: 'matchQuality must be 1-5' });
    }
    if (typeof wouldPlayAgain !== 'boolean') {
      return res.status(400).json({ error: 'wouldPlayAgain must be boolean' });
    }

    // SC-108: the match must exist and be completed — you can only rate a match
    // that actually happened.
    const { data: match } = await supabase
      .from('matches')
      .select('id, status')
      .eq('id', id)
      .maybeSingle();
    if (!match) return res.status(404).json({ error: 'Match not found' });
    if (match.status !== 'completed') {
      return res.status(400).json({ error: 'Can only rate a completed match' });
    }

    // Dedupe — one rating per user per match.
    const { data: existing } = await supabase
      .from('match_ratings')
      .select('*')
      .eq('match_id', id)
      .eq('rater_id', userId)
      .maybeSingle();
    if (existing) return res.json({ success: true, rating: existing, alreadyRated: true });

    const { data, error } = await supabase
      .from('match_ratings')
      .insert({
        match_id: id,
        rater_id: userId,
        match_quality: matchQuality,
        would_play_again: wouldPlayAgain,
      })
      .select('*')
      .single();
    if (error) return res.status(500).json({ error: sanitizeError(error) });

    return res.json({ success: true, rating: data });
  } catch (e) {
    return res.status(500).json({ error: 'Internal server error' });
  }
}

// PATCH /matches/:id/toss  { tossWinnerTeamId, tossChoice }
// Stores the toss outcome on the match row so the scoring screen can
// display it in its header.
export async function setMatchTossHandler(req: Request, res: Response) {
  const userId = req.userId;
  if (!userId) return res.status(401).json({ error: 'Unauthorized' });
  const { id } = req.params;
  const { tossWinnerTeamId, tossWinnerSide, tossChoice } = req.body || {};
  if (!tossChoice) return res.status(400).json({ error: 'tossChoice is required' });

  const { data: match } = await supabase
    .from('matches')
    .select('created_by, umpire_id, status, score_summary, tournament_id')
    .eq('id', id)
    .maybeSingle();
  if (!match) return res.status(404).json({ error: 'Match not found' });
  if (!(await canOfficiateMatch(match, userId))) {
    return res.status(403).json({ error: match.tournament_id ? 'Only a tournament organiser or the umpire can record the toss' : 'Only the creator or umpire can record the toss' });
  }
  // SC-42: a finished match is immutable — no toss changes.
  if (isTerminalMatchStatus(match.status)) {
    return res.status(409).json({ error: 'This match is finished and can no longer be changed' });
  }

  // Recording the toss is the moment play begins, so flip the match to `live`
  // here. Without this the match stayed `scheduled` while being actively
  // scored — the live scoreboard / scorecard / timeline (status-gated) showed
  // 0-0, and the hub listed it under "upcoming" instead of "live". Guard so we
  // never downgrade an already completed/cancelled match.
  const update: Record<string, unknown> = {
    toss_winner_team_id: tossWinnerTeamId ?? null,
    toss_choice: tossChoice,
    updated_at: new Date().toISOString(),
  };
  // Persist the toss winner by SIDE inside score_summary (JSONB, no schema
  // change) so the batting order is correct for free-text-team matches where
  // toss_winner_team_id is null (L-003). recomputeSummary preserves this key.
  if (tossWinnerSide === 'A' || tossWinnerSide === 'B') {
    const ss = (match.score_summary as Record<string, unknown>) || {};
    ss.toss_winner_side = tossWinnerSide;
    update.score_summary = ss;
  }
  if (match.status === 'scheduled' || match.status === 'upcoming') {
    update.status = 'live';
  }

  const { data, error } = await supabase
    .from('matches')
    .update(update)
    .eq('id', id)
    .select('*')
    .single();
  if (error) return res.status(500).json({ error: sanitizeError(error) });

  return res.json({ match: data });
}

// POST /matches/:id/join — join an open match as a player.
// Inserts a match_participants row with team_side='A' (simple heuristic —
// future iterations can balance sides automatically).
export async function joinOpenMatch(req: Request, res: Response) {
  const userId = req.userId;
  if (!userId) return res.status(401).json({ error: 'Unauthorized' });
  try {
    const { id } = req.params;

    // SC-279: an 'approval' match can't be instant-joined — the creator gates it.
    // Tell the FE to use the request flow. Read is cheap and before any mutation.
    const { data: policyRow } = await supabase
      .from('matches').select('join_policy').eq('id', id).maybeSingle();
    if (policyRow?.join_policy === 'approval') {
      return res.status(409).json({
        error: 'This match requires the creator’s approval. Request to join instead.',
        code: 'APPROVAL_REQUIRED',
      });
    }

    // SC-261: joining a match drops you into its shared match chat with the
    // creator and every current participant — so it's block-gated exactly like
    // joinTeamByCode: a user blocked (either direction) with the creator OR any
    // participant can't join, else a block is bypassed into a shared space.
    // Creator-only would still leak a blocked CO-PLAYER into the chat. Checked in
    // the controller (not the capacity RPC) so the RPC stays capacity-only.
    const blocked = await blockedUserIds(userId);
    if (blocked.size > 0) {
      const { data: mrow } = await supabase
        .from('matches').select('created_by').eq('id', id).maybeSingle();
      const { data: parts } = await supabase
        .from('match_participants').select('user_id').eq('match_id', id);
      const others = new Set<string>([
        ...(mrow?.created_by ? [mrow.created_by as string] : []),
        ...((parts ?? []).map((p) => p.user_id as string)),
      ]);
      if ([...others].some((uid) => blocked.has(uid))) {
        return res.status(403).json({ error: 'You can’t join this match.', code: 'BLOCKED_FROM_MATCH' });
      }
    }

    // SC-59: capacity check + participant insert + players_needed decrement are
    // done atomically in one transaction (join_open_match, migration 039). The
    // old JS read-modify-write on a stale snapshot let N concurrent joins all
    // pass the check and oversell a match's open slots without bound. The RPC
    // takes a row lock on the match so joins serialize; already-joined users are
    // handled idempotently under the lock (no 23505 leak — SC-63).
    const { data, error } = await supabase.rpc('join_open_match', {
      p_match_id: id,
      p_user_id: userId,
    });
    if (error) return res.status(500).json({ error: sanitizeError(error) });

    const row = (Array.isArray(data) ? data[0] : data) as
      | { status: string; players_needed: number | null }
      | undefined;
    const status = row?.status;
    const playersNeeded = row?.players_needed ?? 0;

    switch (status) {
      case 'joined':
        // SC-260: tell the pickup organiser someone joined — their whole reason
        // to care. Best-effort, 'matches'-gated (see PREF_CATEGORY).
        void notifyMatchParticipation(id, userId, 'joined');
        return res.json({ success: true, players_needed: playersNeeded });
      case 'already_joined':
        return res.json({ success: true, alreadyJoined: true, players_needed: playersNeeded });
      case 'full':
        return res.status(409).json({ error: 'Match is full' });
      case 'not_open':
        return res.status(400).json({ error: 'Match is not open' });
      case 'not_found':
        return res.status(404).json({ error: 'Match not found' });
      default:
        return res.status(500).json({ error: 'Internal server error' });
    }
  } catch (e) {
    return res.status(500).json({ error: 'Internal server error' });
  }
}

// SC-260: notify the match creator when a player joins/leaves their open match.
// Best-effort (never blocks the join/leave); self-actions don't self-notify
// (actorId filter). 'matches'-gated via PREF_CATEGORY. actor != creator only.
async function notifyMatchParticipation(
  matchId: string,
  actorId: string,
  kind: 'joined' | 'left',
): Promise<void> {
  try {
    const { data: m } = await supabase
      .from('matches')
      .select('created_by, sport_id, team_a_name, team_b_name')
      .eq('id', matchId)
      .maybeSingle();
    if (!m?.created_by || m.created_by === actorId) return;
    const { data: actor } = await supabase.from('users').select('name').eq('id', actorId).maybeSingle();
    let sportName = 'match';
    if (m.sport_id) {
      const { data: sp } = await supabase.from('sports').select('name').eq('id', m.sport_id).maybeSingle();
      if (sp?.name) sportName = `${sp.name} match`;
    }
    const who = actor?.name ?? 'A player';
    await notifyUsers(
      [m.created_by as string],
      {
        type: kind === 'joined' ? 'match_joined' : 'match_left',
        title: kind === 'joined' ? 'New player joined' : 'A player left',
        body: `${who} ${kind === 'joined' ? 'joined' : 'left'} your ${sportName}.`,
        data: { matchId, screen: 'MatchDetail' },
      },
      { actorId },
    );
  } catch {
    // best-effort
  }
}

// POST /matches/:id/leave — SC-262: a joined player withdraws from an open match.
// Symmetric to join_open_match: frees the slot (players_needed +1, is_open=true)
// atomically under a row lock (leave_open_match, migration 061) so concurrent
// leaves can't lose the increment. Allowed ONLY while status ∈ (scheduled,
// upcoming) — leaving a live match would strand the scorecard, a completed one
// is history. Self-leave only. The creator MAY leave as a player: created_by is
// immutable and independent of participation, so no captain-orphan (unlike
// SC-243 teams). NOTE: players_needed is a soft "still looking" hint — a
// lineup-added participant (never decremented it) leaving bumps it by 1, an
// accepted imprecision, not an invariant.
export async function leaveMatch(req: Request, res: Response) {
  const userId = req.userId;
  if (!userId) return res.status(401).json({ error: 'Unauthorized' });
  try {
    const { id } = req.params;
    const { data, error } = await supabase.rpc('leave_open_match', {
      p_match_id: id,
      p_user_id: userId,
    });
    if (error) return res.status(500).json({ error: sanitizeError(error) });
    const row = (Array.isArray(data) ? data[0] : data) as
      | { status: string; players_needed: number | null }
      | undefined;
    const status = row?.status;
    const playersNeeded = row?.players_needed ?? 0;
    switch (status) {
      case 'left':
        void notifyMatchParticipation(id, userId, 'left');
        return res.json({ success: true, players_needed: playersNeeded });
      case 'not_participant':
        return res.status(400).json({ error: 'You are not in this match' });
      case 'not_leavable':
        return res.status(409).json({ error: 'This match can no longer be left' });
      case 'not_found':
        return res.status(404).json({ error: 'Match not found' });
      default:
        return res.status(500).json({ error: 'Internal server error' });
    }
  } catch (e) {
    return res.status(500).json({ error: 'Internal server error' });
  }
}

// GET /matches
// Attach ELO (both sides' ratings for the match's sport) to chess matches so
// the FE card/detail can show real ratings for ranked 1v1. Guests/casual
// players have no rating → null (never faked). Batch-safe (few queries total).
async function attachChessElo(matches: any[]): Promise<void> {
  if (!matches || matches.length === 0) return;
  const sportIds = [...new Set(matches.map((m) => m.sport_id).filter(Boolean))];
  if (sportIds.length === 0) return;
  const { data: sports } = await supabase.from('sports').select('id, slug').in('id', sportIds);
  const chessSportId = (sports || []).find(
    (s: any) => String(s.slug).toLowerCase().replace(/[-_\s]/g, '') === 'chess',
  )?.id;
  if (!chessSportId) return;
  const chessMatches = matches.filter((m) => m.sport_id === chessSportId);
  if (chessMatches.length === 0) return;
  const ids = chessMatches.map((m) => m.id);
  const { data: parts } = await supabase
    .from('match_participants')
    .select('match_id, team_side, user_id')
    .in('match_id', ids);
  const uids = [...new Set((parts || []).map((p: any) => p.user_id).filter(Boolean))];
  const ratingByUser: Record<string, number> = {};
  if (uids.length > 0) {
    const { data: profs } = await supabase
      .from('user_sport_profiles')
      .select('user_id, rating')
      .eq('sport_id', chessSportId)
      .in('user_id', uids);
    for (const pr of profs || []) ratingByUser[(pr as any).user_id] = Number((pr as any).rating);
  }
  const bySide: Record<string, { A: number | null; B: number | null }> = {};
  for (const m of chessMatches) bySide[m.id] = { A: null, B: null };
  for (const pt of parts || []) {
    const side: 'A' | 'B' = (pt as any).team_side === 'B' ? 'B' : 'A';
    const r = ratingByUser[(pt as any).user_id];
    if (r != null && bySide[(pt as any).match_id]![side] == null) bySide[(pt as any).match_id]![side] = r;
  }
  for (const m of chessMatches) m.elo = bySide[m.id];
}

export async function listMatches(req: Request, res: Response) {
  const userId = req.userId;
  if (!userId) return res.status(401).json({ error: 'Unauthorized' });
  try {
    const { sport_id, status, tournament_id, team_id, mine } = req.query as Record<string, string | undefined>;
    // Accept either a UUID or a slug/name for sport_id — the mobile app
    // has some legacy call sites that still pass 'cricket' / 'badminton'.
    const resolvedSportId = await resolveSportId(sport_id);
    const p = parsePagination(req.query as Record<string, unknown>);
    let query = supabase
      .from('matches')
      .select('*', { count: 'exact' })
      .order('scheduled_at', { ascending: false })
      .range(p.from, p.to);
    if (resolvedSportId) query = query.eq('sport_id', resolvedSportId);
    if (status) query = query.eq('status', status);
    if (tournament_id) query = query.eq('tournament_id', tournament_id);
    if (team_id) query = query.or(`team_a_id.eq.${team_id},team_b_id.eq.${team_id}`);
    if (mine === '1') query = query.eq('created_by', userId);
    const { data, error, count } = await query;
    if (error && !isRangeError(error)) return res.status(500).json({ error: sanitizeError(error) });
    const matches = data || [];
    await attachChessElo(matches); // chess cards show both players' real ELO
    return res.json({ matches, ...pageMeta(count, p) });
  } catch (e) {
    return res.status(500).json({ error: 'Internal server error' });
  }
}

// SC-16 · Reconcile abandoned live matches. A match flips to 'live' on its first
// scoring event; if the umpire never taps "End match", it lingers 'live' forever
// and shows up as a zombie LIVE card on Home/hub. This bulk-marks matches that
// have been 'live' with no activity (`updated_at`, bumped on every scoring
// event) for STALE_LIVE_HOURS as 'abandoned' — a status the enum already allows.
//
// Safe by construction: ELO/attribution are only applied on *completion*, so an
// abandoned match never scored ratings and needs no reversal. Idempotent and
// bulk (filters on the indexed `status` column), so running it hourly across
// multiple instances is fine. 6h with no scoring input is well beyond any real
// match's live gap, so this won't kill an in-progress game.
const STALE_LIVE_HOURS = 6;

export async function sweepStaleLiveMatches(): Promise<{ abandoned: number }> {
  const cutoff = new Date(Date.now() - STALE_LIVE_HOURS * 3600_000).toISOString();
  const { data: stale, error } = await supabase
    .from('matches')
    .select('id')
    .eq('status', 'live')
    .lt('updated_at', cutoff);
  if (error || !stale || stale.length === 0) return { abandoned: 0 };
  await supabase
    .from('matches')
    .update({ status: 'abandoned', updated_at: new Date().toISOString() })
    .in('id', stale.map((m) => m.id));
  return { abandoned: stale.length };
}

// GET /matches/:id/commentary — returns match_events formatted into
// human-readable commentary lines. Cheap — reads only the events table.
export async function getCommentary(req: Request, res: Response) {
  const userId = req.userId;
  if (!userId) return res.status(401).json({ error: 'Unauthorized' });
  try {
    const { id } = req.params;
    const { data: match } = await supabase
      .from('matches')
      .select('id, sport_id, team_a_name, team_b_name')
      .eq('id', id)
      .maybeSingle();
    if (!match) return res.status(404).json({ error: 'Match not found' });

    const { data: events, error } = await supabase
      .from('match_events')
      .select('id, event_type, period, clock_seconds, payload, created_at')
      .eq('match_id', id)
      .order('created_at', { ascending: true })
      .limit(2000); // SC-117: safety cap (matches scoring.listEvents ceiling)
    if (error) return res.status(500).json({ error: sanitizeError(error) });

    const isCricket = !!match.sport_id && String(match.sport_id).toLowerCase().includes('cric');
    let legalBalls = 0;
    const enriched: Array<any> = [];
    for (const ev of events ?? []) {
      const p: any = ev.payload ?? {};

      // For cricket, compute the over.ball label from a running legal-ball
      // count. Wides and no-balls don't advance the legal count.
      let overBallLabel: string | null = null;
      if (isCricket) {
        const isLegal = !(p.is_extra || ev.event_type === 'extra' || p.type === 'Wd' || p.type === 'Nb');
        if (isLegal) legalBalls += 1;
        const displayBalls = isLegal ? legalBalls : legalBalls + 1;
        const overNum = Math.floor((displayBalls - 1) / 6);
        const ballInOver = ((displayBalls - 1) % 6) + 1;
        overBallLabel = `${overNum}.${ballInOver}`;
      }

      let commentary = ev.event_type as string;
      let isWicket = false;
      let isBoundary = false;
      if (ev.event_type === 'wicket' || (ev.event_type === 'ball' && p.wicket)) {
        isWicket = true;
        const batter = p.batsmanName || p.player_name || p.batter || 'Batter';
        commentary = `OUT! ${batter}${p.runs != null ? ` — ${p.runs} runs` : ''}`;
      } else if (ev.event_type === 'ball') {
        const runs = Number(p.runs ?? 0);
        if (runs === 4) {
          commentary = 'FOUR! Beautiful shot';
          isBoundary = true;
        } else if (runs === 6) {
          commentary = 'SIX! That\u2019s massive!';
          isBoundary = true;
        } else if (runs === 0) {
          commentary = 'Dot ball';
        } else {
          commentary = `${runs} run${runs === 1 ? '' : 's'}`;
        }
      } else if (ev.event_type === 'extra') {
        if (p.type === 'Wd') commentary = 'Wide ball';
        else if (p.type === 'Nb') commentary = 'No ball called';
        else commentary = `Extra: ${p.type ?? ''}`;
      } else if (ev.event_type === 'goal') {
        const team = p.team_name || `Team ${p.team_side ?? ''}`;
        const a = p.score_a ?? '';
        const b = p.score_b ?? '';
        commentary = `\u26BD GOAL! ${team} scores!${a !== '' ? ` ${a}-${b}` : ''}`;
        isBoundary = true;
      } else if (ev.event_type === 'yellow_card') {
        commentary = `\uD83D\uDFE8 Yellow card${p.player ? ` for ${p.player}` : ''}`;
      } else if (ev.event_type === 'red_card') {
        commentary = `\uD83D\uDFE5 Red card${p.player ? ` for ${p.player}` : ''}`;
        isWicket = true;
      } else if (ev.event_type === 'score' || ev.event_type === 'point') {
        // Generic point-based sports (badminton, TT, pickleball, volleyball)
        const team = p.team_name || `Team ${p.team_side ?? '?'}`;
        const pts = p.points ?? p.runs ?? 1;
        commentary = `${pts === 1 ? 'Point' : `${pts} points`} to ${team}`;
      } else if (ev.event_type === 'basket') {
        const pts = p.points ?? 2;
        const team = p.team_name || `Team ${p.team_side ?? '?'}`;
        commentary = `\uD83C\uDFC0 ${pts}-pointer! ${team}`;
      } else if (ev.event_type === 'foul') {
        const team = p.team_name || `Team ${p.team_side ?? '?'}`;
        commentary = `Foul by ${team}${p.bonus ? ' — BONUS free throws' : ''}`;
      } else if (ev.event_type === 'move') {
        // Chess
        commentary = `\u265F\uFE0F Move ${p.moveNumber ?? ''} — game in progress`;
      } else if (ev.event_type === 'timeout') {
        commentary = `\u23F8\uFE0F Timeout called by ${p.team_name ?? 'team'}`;
      } else if (ev.event_type === 'assist') {
        commentary = `\uD83C\uDD70\uFE0F Assist${p.player ? ` by ${p.player}` : ''}`;
      } else if (ev.event_type === 'sub') {
        commentary = `\uD83D\uDD04 Substitution${p.player ? ` — ${p.player}` : ''}`;
      } else if (ev.event_type === 'queen') {
        // Carrom
        commentary = `\uD83D\uDC51 Queen pocketed! +5 points`;
      } else {
        commentary = `${ev.event_type}${p && Object.keys(p).length > 0 ? ` ${JSON.stringify(p).slice(0, 80)}` : ''}`;
      }

      enriched.push({
        id: ev.id,
        over_ball: overBallLabel,
        event_type: ev.event_type,
        // The app's CommentaryLine reads `text` (and falls back to `payload`).
        // We were only sending `commentary`, so the timeline never saw the
        // computed string and recomputed it from a missing payload — every
        // ball rendered as "Dot ball". Send `text` (the rich string) and the
        // raw `payload` so both the primary path and the fallback are correct.
        // `commentary` is kept for backwards-compatibility with any other reader.
        commentary,
        text: commentary,
        payload: p,
        timestamp: ev.created_at,
        is_wicket: isWicket,
        is_boundary: isBoundary,
      });
    }

    // Return newest-first.
    enriched.reverse();
    return res.json({
      commentary: enriched,
      match: {
        id: match.id,
        sport_id: match.sport_id,
        team_a_name: match.team_a_name,
        team_b_name: match.team_b_name,
      },
    });
  } catch (e) {
    return res.status(500).json({ error: 'Internal server error' });
  }
}

// GET /matches/:id
export async function getMatch(req: Request, res: Response) {
  const userId = req.userId;
  if (!userId) return res.status(401).json({ error: 'Unauthorized' });
  try {
    const { id } = req.params;
    const { data: match, error } = await supabase.from('matches').select('*').eq('id', id).maybeSingle();
    if (error || !match) return res.status(404).json({ error: 'Match not found' });
    const { data: participants } = await supabase
      .from('match_participants')
      .select('id, team_side, role, jersey_number, batting_order, user:user_id (id, name, username, profile_picture_url)')
      .eq('match_id', id);
    const { count } = await supabase
      .from('match_events')
      .select('id', { count: 'exact', head: true })
      .eq('match_id', id);

    // Compute the average match-quality rating from match_ratings on read.
    // Cheap — there are only a handful of ratings per match.
    const { data: ratings } = await supabase
      .from('match_ratings')
      .select('match_quality')
      .eq('match_id', id);
    const matchWithRating: any = { ...match };
    if (ratings && ratings.length > 0) {
      const sum = ratings.reduce((acc, r: any) => acc + (r.match_quality ?? 0), 0);
      matchWithRating.avg_rating = Math.round((sum / ratings.length) * 10) / 10;
      matchWithRating.rating_count = ratings.length;
    }

    // Follow state (SC-A1) — is the caller following this match, and how many
    // followers does it have.
    const [{ count: followerCount }, { data: myFollow }] = await Promise.all([
      supabase.from('match_followers').select('id', { count: 'exact', head: true }).eq('match_id', id),
      supabase.from('match_followers').select('id').eq('match_id', id).eq('user_id', userId).maybeSingle(),
    ]);
    matchWithRating.follower_count = followerCount ?? 0;
    matchWithRating.is_following = !!myFollow;

    // SC-259: expose the parent tournament's FORMAT so the client can tell a real
    // knockout bracket match (needs a decisive winner / walkover advancing-team)
    // from a round_robin/league match (round=1 but NOT a bracket — may draw /
    // plainly abandon). Mirrors the server's isKnockoutBracketMatch discriminator;
    // `round` alone can't distinguish them. Null for casual (no tournament).
    if (match.tournament_id) {
      const { data: tf } = await supabase
        .from('tournaments').select('format').eq('id', match.tournament_id).maybeSingle();
      matchWithRating.tournament_format = (tf as any)?.format ?? null;
    }

    // Chess: attach both players' real ELO for this sport (ranked 1v1). Null for
    // guests/casual — never faked.
    await attachChessElo([matchWithRating]);

    return res.json({ match: matchWithRating, participants: participants || [], events_count: count || 0 });
  } catch (e) {
    return res.status(500).json({ error: 'Internal server error' });
  }
}

// PATCH /matches/:id — creator or umpire only
export async function updateMatch(req: Request, res: Response) {
  const userId = req.userId;
  if (!userId) return res.status(401).json({ error: 'Unauthorized' });
  try {
    const { id } = req.params;
    const { data: match } = await supabase
      .from('matches')
      .select('created_by, umpire_id, status, team_a_id, team_b_id, tournament_id')
      .eq('id', id)
      .maybeSingle();
    if (!match) return res.status(404).json({ error: 'Match not found' });
    // Organiser-only for TOURNAMENT matches: structural edits (teams / schedule /
    // ground / status) to a tournament fixture belong to the organiser
    // (match.created_by), NOT the assigned umpire — the umpire scores (officiating
    // is unchanged), they don't reschedule/reteam. Casual matches keep
    // creator-OR-umpire.
    const isTournamentMatch = !!match.tournament_id;
    // Structural edit: a tournament fixture → any organiser (creator/co-org), NOT
    // the umpire (they score, not reschedule). Casual match → creator OR umpire.
    const authed = isTournamentMatch
      ? await isTournamentOrganiser(match.tournament_id, userId)
      : (match.created_by === userId || match.umpire_id === userId);
    if (!authed) {
      return res.status(403).json({
        error: isTournamentMatch
          ? 'Only the tournament organiser can change a tournament fixture.'
          : 'Only the creator or umpire can update',
      });
    }
    const allowedKeys = [
      'status',
      'score_summary',
      'winner_team_id',
      'squad_locked_at',
      'scorecard_locked_at',
      'scheduled_at',
      'venue',
      'city_id',
      'format',
      'overs',
      'team_a_id',
      'team_b_id',
      'team_a_name',
      'team_b_name',
    ];
    const update: Record<string, any> = {};
    for (const key of allowedKeys) {
      if (req.body && key in req.body) update[key] = req.body[key];
    }
    // SC-85: a finished match's result is frozen. Editing status/winner/score/
    // team identity on a terminal match would let it be resurrected (status->live)
    // and re-completed, DOUBLE-applying ELO + matches_played (unbounded inflation),
    // or rewrite a recorded winner without touching the already-applied ratings.
    // Benign display/metadata fields (venue, names, scheduled_at, ...) stay editable.
    const FROZEN_ON_TERMINAL = ['status', 'winner_team_id', 'score_summary', 'team_a_id', 'team_b_id'];
    if (isTerminalMatchStatus(match.status) && FROZEN_ON_TERMINAL.some((k) => k in update)) {
      return res.status(409).json({ error: 'This match is already finished — its result and status are locked.' });
    }
    // SC-245: don't let an edit PATCH a valid A-vs-B match into self-vs-self.
    // Compare the EFFECTIVE pair after applying the patch (a side left out of the
    // body keeps its current value), so setting only team_b_id = team_a_id is
    // caught too. Only fires when both effective sides are the same team id.
    {
      const effA = 'team_a_id' in update ? update.team_a_id : match.team_a_id;
      const effB = 'team_b_id' in update ? update.team_b_id : match.team_b_id;
      if (effA && effB && effA === effB) {
        return res.status(400).json({ error: 'A team can’t play itself — pick two different teams.', code: 'SAME_TEAM' });
      }
    }
    update.updated_at = new Date().toISOString();
    const { data, error } = await supabase.from('matches').update(update).eq('id', id).select('*').single();
    if (error) return res.status(500).json({ error: sanitizeError(error) });
    // If a winner/completion was set on a tournament bracket match here, advance
    // the bracket too (SC-23) so this path can't leave a stuck fixture.
    if (data?.tournament_id && ('winner_team_id' in update || update.status === 'completed')) {
      try {
        await advanceTournamentWinner(id);
      } catch (advErr) {
        console.error('bracket advancement failed:', advErr instanceof Error ? advErr.message : advErr);
      }
    }
    return res.json({ match: data });
  } catch (e) {
    return res.status(500).json({ error: 'Internal server error' });
  }
}

// POST /matches/:id/participants — bulk add
export async function addParticipants(req: Request, res: Response) {
  const userId = req.userId;
  if (!userId) return res.status(401).json({ error: 'Unauthorized' });
  try {
    const { id } = req.params;
    const { participants } = req.body || {};
    if (!Array.isArray(participants) || participants.length === 0) {
      return res.status(400).json({ error: 'participants array is required' });
    }
    if (tooManyItems(participants, ARRAY_LIMITS.participants)) {
      return res.status(400).json({ error: `Too many participants (max ${ARRAY_LIMITS.participants})` });
    }
    const { data: match } = await supabase
      .from('matches')
      .select('created_by, umpire_id, status, tournament_id')
      .eq('id', id)
      .maybeSingle();
    if (!match) return res.status(404).json({ error: 'Match not found' });
    if (!(await canOfficiateMatch(match, userId))) {
      return res.status(403).json({ error: match.tournament_id ? 'Only a tournament organiser or the umpire can add participants' : 'Only the creator or umpire can add participants' });
    }
    // SC-98/SC-110: a finished match's lineup is frozen — no adding participants
    // to a completed/abandoned/cancelled match.
    if (isTerminalMatchStatus(match.status)) {
      return res.status(409).json({ error: 'This match is already finished.' });
    }
    // SC-110: every participant must be placed on a valid side.
    for (const p of participants as any[]) {
      if (p && p.team_side !== 'A' && p.team_side !== 'B') {
        return res.status(400).json({ error: 'team_side must be A or B' });
      }
    }
    // SC-53: dedupe by user_id (last wins) — a batch containing the same user
    // twice (e.g. a player listed on both sides) would otherwise make Postgres'
    // ON CONFLICT upsert fail with "cannot affect row a second time" → 500.
    const byUser = new Map<string, any>();
    for (const p of participants as any[]) {
      if (p && p.user_id) byUser.set(p.user_id, p);
    }
    const rows = Array.from(byUser.values()).map((p: any) => ({
      match_id: id,
      user_id: p.user_id,
      team_side: p.team_side,
      role: p.role || null,
      jersey_number: p.jersey_number ?? null,
      batting_order: p.batting_order ?? null,
    }));
    if (rows.length === 0) {
      return res.status(400).json({ error: 'participants array is required' });
    }
    // Upsert on the (match_id,user_id) unique key so re-saving a lineup (e.g.
    // editing the playing XI) doesn't collide — A5-003 P3.
    const { data, error } = await supabase
      .from('match_participants')
      .upsert(rows, { onConflict: 'match_id,user_id' })
      .select('*');
    if (error) return res.status(500).json({ error: sanitizeError(error) });
    return res.json({ participants: data || [] });
  } catch (e) {
    return res.status(500).json({ error: 'Internal server error' });
  }
}

// POST /matches/:id/umpire/self-assign
// Lets a user officiate a match they didn't create. Gated to accounts holding
// the umpire/referee role, and only for matches still open for officiating
// (not completed/cancelled/abandoned) that don't already have an umpire.
export async function selfAssignUmpire(req: Request, res: Response) {
  const userId = req.userId;
  if (!userId) return res.status(401).json({ error: 'Unauthorized' });
  try {
    const { id } = req.params;

    // Role gate: only umpire/referee accounts can officiate (SC-20 decision).
    const { data: roles } = await supabase
      .from('user_account_types')
      .select('account_type')
      .eq('user_id', userId)
      .in('account_type', ['umpire', 'referee']);
    if (!roles || roles.length === 0) {
      return res.status(403).json({
        error: 'Only umpire / referee accounts can officiate matches. Add the Umpire role in Edit profile.',
        code: 'NOT_AN_UMPIRE',
      });
    }

    const { data: match } = await supabase
      .from('matches')
      .select('id, umpire_id, created_by, status, team_a_name, team_b_name')
      .eq('id', id)
      .maybeSingle();
    if (!match) return res.status(404).json({ error: 'Match not found' });
    if (match.status === 'completed' || match.status === 'cancelled' || match.status === 'abandoned') {
      return res.status(409).json({ error: 'This match is no longer open for officiating.' });
    }
    if (match.umpire_id) {
      return res.status(409).json({
        error: match.umpire_id === userId ? 'You are already officiating this match.' : 'Match already has an umpire',
      });
    }

    const { data, error } = await supabase
      .from('matches')
      .update({ umpire_id: userId, updated_at: new Date().toISOString() })
      .eq('id', id)
      .select('*')
      .single();
    if (error) return res.status(500).json({ error: sanitizeError(error) });

    // Let the creator know someone picked up officiating (best-effort).
    if (match.created_by && match.created_by !== userId) {
      const matchLabel = (match.team_a_name && match.team_b_name)
        ? `${match.team_a_name} vs ${match.team_b_name}`
        : 'your match';
      try {
        await notifyUser({
          userId: match.created_by,
          type: 'match_umpire_assigned',
          title: 'Umpire assigned',
          body: `An umpire has taken up officiating for ${matchLabel}.`,
          data: { matchId: id, screen: 'MatchDetail' },
        });
      } catch {
        // best-effort
      }
    }

    return res.json({ match: data });
  } catch (e) {
    return res.status(500).json({ error: 'Internal server error' });
  }
}

// ── Follow a match (SC-A1) ────────────────────────────────────────────────────
// POST /matches/:id/follow — get score/completion updates for a match.
export async function followMatch(req: Request, res: Response) {
  const userId = req.userId;
  if (!userId) return res.status(401).json({ error: 'Unauthorized' });
  try {
    const { id } = req.params;
    const { data: match } = await supabase.from('matches').select('id').eq('id', id).maybeSingle();
    if (!match) return res.status(404).json({ error: 'Match not found' });
    const { error } = await supabase.from('match_followers').insert({ match_id: id, user_id: userId });
    // Unique violation = already following → treat as success (idempotent).
    if (error && (error as { code?: string }).code !== '23505') {
      return res.status(500).json({ error: sanitizeError(error) });
    }
    const { count } = await supabase
      .from('match_followers').select('id', { count: 'exact', head: true }).eq('match_id', id);
    return res.json({ is_following: true, follower_count: count ?? 0 });
  } catch {
    return res.status(500).json({ error: 'Internal server error' });
  }
}

// DELETE /matches/:id/follow
export async function unfollowMatch(req: Request, res: Response) {
  const userId = req.userId;
  if (!userId) return res.status(401).json({ error: 'Unauthorized' });
  try {
    const { id } = req.params;
    await supabase.from('match_followers').delete().eq('match_id', id).eq('user_id', userId);
    const { count } = await supabase
      .from('match_followers').select('id', { count: 'exact', head: true }).eq('match_id', id);
    return res.json({ is_following: false, follower_count: count ?? 0 });
  } catch {
    return res.status(500).json({ error: 'Internal server error' });
  }
}

// ── Match group chat (SC-A1) ──────────────────────────────────────────────────
// GET /matches/:id/chat — lazily creates a group chat for the match and adds
// the caller (mirrors the tournament-chat pattern; linkage via matches.chat_id).
export async function getMatchChat(req: Request, res: Response) {
  const userId = req.userId;
  if (!userId) return res.status(401).json({ error: 'Unauthorized' });
  try {
    const { id } = req.params;
    const { data: match } = await supabase
      .from('matches')
      .select('id, chat_id, team_a_name, team_b_name, created_by, umpire_id')
      .eq('id', id)
      .maybeSingle();
    if (!match) return res.status(404).json({ error: 'Match not found' });

    // SC-107: only people actually in this match may access its group chat.
    // Previously ANY authed user was silently inserted into the chat. Gate to
    // the creator, the umpire, or a registered match participant.
    if (match.created_by !== userId && match.umpire_id !== userId) {
      const { data: participant } = await supabase
        .from('match_participants')
        .select('id')
        .eq('match_id', id)
        .eq('user_id', userId)
        .maybeSingle();
      if (!participant) {
        return res.status(403).json({ error: 'Not part of this match' });
      }
    }

    const chatName = `${match.team_a_name ?? 'Team A'} vs ${match.team_b_name ?? 'Team B'} Chat`;
    let chatId: string | null = match.chat_id ?? null;
    if (chatId) {
      const { data: existing } = await supabase.from('chats').select('id').eq('id', chatId).maybeSingle();
      if (!existing) chatId = null;
    }
    if (!chatId) {
      const { data: chat } = await supabase
        .from('chats')
        .insert({ is_group: true, name: chatName, created_by: match.created_by })
        .select('id')
        .single();
      if (!chat) return res.status(500).json({ error: 'Could not create match chat' });
      chatId = chat.id;
      await supabase.from('chat_participants').insert({ chat_id: chatId, user_id: match.created_by, role: 'admin' });
      await supabase.from('matches').update({ chat_id: chatId }).eq('id', id);
    }
    // Ensure the caller is a participant.
    const { data: participant } = await supabase
      .from('chat_participants').select('id').eq('chat_id', chatId).eq('user_id', userId).maybeSingle();
    if (!participant) {
      await supabase.from('chat_participants').insert({ chat_id: chatId, user_id: userId, role: 'member' });
    }
    return res.json({ chat_id: chatId, name: chatName, conversationId: chatId });
  } catch {
    return res.status(500).json({ error: 'Internal server error' });
  }
}

// ── Abandon a match (SC-A1) ───────────────────────────────────────────────────
// SC-257 / SC-258: a match is a KNOCKOUT BRACKET match — one that advances a
// winner and therefore CANNOT end in a draw — only for format=knockout, or the
// knockout stage of groups_knockout (round>0 with no group_label; group matches
// CAN draw). round_robin and league carry round=1 too, but they are NOT brackets:
// a league match can legitimately tie (1 point each, standings already handle it).
// The old `round>0 && !group_label` inference silently treated RR/league as
// brackets (round=1) — blocking ties at completion (SC-257) and forcing a walkover
// winner on abandon (SC-258). The reliable discriminator is the tournament FORMAT,
// not the round value (which is load-bearing for maybeSeedKnockout / getBracket).
async function isKnockoutBracketMatch(match: {
  tournament_id: string | null; round: number | null; group_label: string | null;
}): Promise<boolean> {
  if (!match.tournament_id || match.round == null || match.round <= 0 || match.group_label) return false;
  const { data: t } = await supabase
    .from('tournaments').select('format').eq('id', match.tournament_id).maybeSingle();
  const fmt = (t as any)?.format;
  return fmt === 'knockout' || fmt === 'groups_knockout';
}

// POST /matches/:id/abandon  { advancing_team_id? } — creator/umpire only.
// Casual matches simply go 'abandoned' (no result). For a knockout bracket
// match, a walkover is recorded: the non-forfeiting side (advancing_team_id)
// is set as winner and routed through the SAME advanceTournamentWinner engine,
// honouring the "can't rewrite once the next round started" guard.
export async function abandonMatch(req: Request, res: Response) {
  const userId = req.userId;
  if (!userId) return res.status(401).json({ error: 'Unauthorized' });
  try {
    const { id } = req.params;
    const { advancing_team_id } = req.body || {};
    const { data: match } = await supabase
      .from('matches')
      .select('id, created_by, umpire_id, status, tournament_id, round, group_label, next_match_id, team_a_id, team_b_id, team_a_name, team_b_name')
      .eq('id', id)
      .maybeSingle();
    if (!match) return res.status(404).json({ error: 'Match not found' });
    if (!(await canOfficiateMatch(match, userId))) {
      return res.status(403).json({ error: match.tournament_id ? 'Only a tournament organiser or the umpire can abandon' : 'Only the creator or umpire can abandon' });
    }
    if (match.status !== 'scheduled' && match.status !== 'live') {
      return res.status(409).json({ error: 'Only a scheduled or live match can be abandoned.' });
    }

    // SC-258: only a real knockout bracket match needs an advancing team on
    // abandon. RR/league (round=1) and groups_knockout GROUP matches just go
    // 'abandoned' with no winner (a no-result → a draw in the standings).
    const isBracketMatch = await isKnockoutBracketMatch(match);
    let walkoverWinner: string | null = null;

    if (isBracketMatch) {
      // Walkover requires knowing who advances.
      if (!advancing_team_id || (advancing_team_id !== match.team_a_id && advancing_team_id !== match.team_b_id)) {
        return res.status(400).json({
          error: 'A bracket match needs the advancing (non-forfeiting) team to walk over.',
          code: 'WALKOVER_TEAM_REQUIRED',
        });
      }
      // Honour the same guard as fixture edits: can't decide a result once the
      // next round has already started.
      if (match.next_match_id) {
        const { data: child } = await supabase.from('matches').select('status').eq('id', match.next_match_id).maybeSingle();
        if (child && child.status !== 'scheduled') {
          return res.status(409).json({ error: 'The next round has already started — resolve it there instead.' });
        }
      }
      walkoverWinner = advancing_team_id;
    }

    const { data: updated, error } = await supabase
      .from('matches')
      .update({ status: 'abandoned', winner_team_id: walkoverWinner, updated_at: new Date().toISOString() })
      .eq('id', id)
      .select('*')
      .single();
    if (error) return res.status(500).json({ error: sanitizeError(error) });

    // Route through the shared engine for ANY tournament match: a bracket
    // walkover advances its winner; an abandoned RR/league match (SC-255) still
    // lets crownLeagueChampion crown the leader if this was the last fixture; an
    // abandoned groups_knockout group match still triggers maybeSeedKnockout.
    if (match.tournament_id) {
      try { await advanceTournamentWinner(id); } catch (e) { console.error('abandon advance failed:', e instanceof Error ? e.message : e); }
    }

    // Notify the audience (best-effort). SC-270: lineup UNION entrant teams'
    // members — a bracket fixture has no participants until scoring, so
    // participants-only told nobody a pre-lineup abandonment happened.
    try {
      const ids = (await matchAudienceIds(id, match.team_a_id, match.team_b_id)).filter((uid) => uid !== userId);
      const label = (match.team_a_name && match.team_b_name) ? `${match.team_a_name} vs ${match.team_b_name}` : 'Your match';
      if (ids.length > 0) {
        await notifyUsers(ids, {
          type: 'match_abandoned',
          title: 'Match abandoned',
          body: `${label} was abandoned.`,
          data: { matchId: id, screen: 'MatchDetail' },
        });
      }
    } catch { /* best-effort */ }

    return res.json({ match: updated });
  } catch {
    return res.status(500).json({ error: 'Internal server error' });
  }
}

// DELETE /matches/:id — cancel (creator only)
export async function cancelMatch(req: Request, res: Response) {
  const userId = req.userId;
  if (!userId) return res.status(401).json({ error: 'Unauthorized' });
  try {
    const { id } = req.params;
    const { data: match } = await supabase
      .from('matches')
      .select('id, created_by, team_a_name, team_b_name, status, tournament_id, team_a_id, team_b_id')
      .eq('id', id)
      .maybeSingle();
    if (!match) return res.status(404).json({ error: 'Match not found' });
    const authed = match.tournament_id ? await isTournamentOrganiser(match.tournament_id, userId) : match.created_by === userId;
    if (!authed) return res.status(403).json({ error: match.tournament_id ? 'Only the tournament organiser can cancel this match.' : 'Only the creator can cancel' });
    // SC-84: a finished match is terminal — cancelling it would strand the ELO
    // and stats it already applied (ghost ratings). Only scheduled/live cancel.
    // Mirrors the isTerminalMatchStatus guard in completeMatch/abandonMatch.
    if (isTerminalMatchStatus(match.status)) {
      return res.status(409).json({ error: 'This match is already finished and cannot be cancelled.' });
    }
    const { data, error } = await supabase
      .from('matches')
      .update({ status: 'cancelled', updated_at: new Date().toISOString() })
      .eq('id', id)
      .select('*')
      .single();
    if (error) return res.status(500).json({ error: sanitizeError(error) });

    // PRD Addition #17: notify the audience of the cancellation. SC-270: lineup
    // UNION entrant teams' members — a bracket fixture has no participants until
    // scoring, so participants-only told nobody a pre-lineup cancellation happened.
    try {
      const participantIds = await matchAudienceIds(id, match.team_a_id, match.team_b_id);
      const matchLabel = (match.team_a_name && match.team_b_name)
        ? `${match.team_a_name} vs ${match.team_b_name}`
        : 'Your match';
      if (participantIds.length > 0) {
        await notifyUsers(participantIds, {
          type: 'match_cancelled',
          title: 'Match cancelled',
          body: `${matchLabel} has been cancelled by the organiser`,
          data: { matchId: id, screen: 'MatchDetail' },
        });
      }
    } catch {
      // best-effort
    }

    return res.json({ match: data });
  } catch (e) {
    return res.status(500).json({ error: 'Internal server error' });
  }
}

// POST /matches/:id/complete — finalize match, calculate ELO, update profiles.
// Body: { winner_team_id?: string } — omit for draw.
export async function completeMatch(req: Request, res: Response) {
  const userId = req.userId;
  if (!userId) return res.status(401).json({ error: 'Unauthorized' });
  try {
    const { id } = req.params;
    const { winner_team_id, walkover, walkover_reason } = req.body || {};

    const { data: match } = await supabase
      .from('matches')
      .select('id, sport_id, team_a_id, team_b_id, status, created_by, umpire_id, team_a_name, team_b_name, is_ranked, tournament_id, round, group_label, next_match_id')
      .eq('id', id)
      .maybeSingle();
    if (!match) return res.status(404).json({ error: 'Match not found' });
    // Authorization before status (SC-33): a non-owner must get 403, not learn
    // the match state via a 400.
    if (!(await canOfficiateMatch(match, userId))) {
      return res.status(403).json({ error: match.tournament_id ? 'Only a tournament organiser or the umpire can complete' : 'Only the creator or umpire can complete' });
    }
    if (match.status === 'completed') return res.status(400).json({ error: 'Match already completed' });
    // SC-42: an abandoned/cancelled match is already terminal — can't complete it.
    if (isTerminalMatchStatus(match.status)) {
      return res.status(409).json({ error: 'This match is already finished' });
    }
    // SC-42: don't complete a match that was never played — a scheduled match
    // with no scoring events and no explicit result. (The organiser
    // "record result" flow supplies winner_team_id, which stays allowed.)
    if (match.status === 'scheduled' && !winner_team_id) {
      const { count } = await supabase
        .from('match_events')
        .select('id', { count: 'exact', head: true })
        .eq('match_id', id);
      if (!count) {
        return res.status(400).json({ error: 'Cannot complete a match that has not started' });
      }
    }

    // SC-254: a walkover/forfeit records a winner WITHOUT a lineup or any scoring
    // — a real tournament need (a team no-shows). It sets the winner, marks
    // score_summary.walkover=true, advances the bracket, and applies NO
    // attribution (no ELO / matches_played / W-L / coins), the same "forfeit, not
    // a played game" rule as the team-withdraw walkover (walkoverOnWithdraw in
    // tournaments.controller). That withdraw path uses status='abandoned'; this
    // organiser-driven single-match walkover instead stays status='completed' — a
    // decided result that advances the bracket. A walkover must name a winner.
    if (walkover && !winner_team_id) {
      return res.status(400).json({ error: 'A walkover needs a winning team.' });
    }

    // SC-23: knockout bracket matches can't end in a draw — a decisive winner is
    // required so the bracket can advance. (Group-stage matches, round=0, and
    // non-bracket formats may draw.)
    // SC-257: only a real knockout bracket match needs a decisive winner (a
    // bracket can't advance on a tie). round_robin / league (round=1) and
    // groups_knockout GROUP matches may legitimately draw — a tie is a valid
    // 1-point-each league result, and standings already handle it.
    const isBracketMatch = await isKnockoutBracketMatch(match);
    if (isBracketMatch && !winner_team_id) {
      return res.status(400).json({
        error: 'Bracket matches need a decisive winner — pick the winning team (a bracket can\'t advance on a tie).',
        code: 'BRACKET_NEEDS_WINNER',
      });
    }

    // SC-268: a DECISIVE sport (sports.allows_draw = false — badminton, TT,
    // pickleball, volleyball, tennis, carrom, basketball) can't end without a
    // winner. Draw-capable sports (cricket/chess/football/hockey, allows_draw
    // = true) fall through and may legitimately tie. This GENERALISES + REPLACES
    // the old basketball-specific SC-227 block — basketball is just one
    // allows_draw=false sport. Orthogonal to the bracket guard above (format vs
    // sport), which stays FIRST so a knockout tie reports BRACKET_NEEDS_WINNER.
    // Fires only on a genuine no-winner completion: the live scorer already sets
    // winner_team_id via ruleset.detectWinner for these sports, so the only way
    // here is e.g. an organiser "record result" that left the winner blank.
    // `=== false` (not `!allows_draw`) so it fails OPEN if the column is ever
    // absent — never wrongly blocks a legitimate tie.
    if (!winner_team_id) {
      const { data: sportRow } = await supabase
        .from('sports').select('allows_draw').eq('id', match.sport_id).maybeSingle();
      if ((sportRow as { allows_draw?: boolean } | null)?.allows_draw === false) {
        return res.status(400).json({
          error: "This sport can't end level — pick the winning team (play on until there's a winner).",
          code: 'NEEDS_DECISIVE_WINNER',
        });
      }
    }

    // Get participants grouped by team side
    const { data: participants } = await supabase
      .from('match_participants')
      .select('user_id, team_side')
      .eq('match_id', id);
    const now = new Date().toISOString();
    const ratingHistoryRows: Array<{ user_id: string; sport_id: string; match_id: string; old_rating: number; new_rating: number; delta: number }> = [];
    let allPlayerIds: string[] = [];

    // Ranked matches must have a real lineup before they can close — otherwise
    // the ELO impact would be meaningless (a side with no registered player would
    // be rated against the 1200 avgRating fallback below = phantom-rating farming).
    // SC-74: the check was originally ">=2 per side", which assumed TEAM sports
    // and permanently blocked legitimate 1v1/singles ranked play (chess, carrom,
    // and singles tennis/badminton/table-tennis/pickleball) from ever completing.
    // The protection that actually matters is "no EMPTY side" — each side must
    // have at least ONE registered participant. match_participants only ever holds
    // real user_ids (guests ride in event payloads as guest:<id> and never enter
    // this table), and ranked guest scoring is already rejected at createEvent, so
    // ">=1 registered per side" keeps the anti-phantom guarantee while allowing
    // 1v1. Casual matches have no such requirement.
    // SC-254: a walkover is exempt from the lineup requirement — a forfeited
    // match has no lineup by definition; it just records the winner + advances.
    if (match.is_ranked && !walkover) {
      const aCount = (participants ?? []).filter((p) => p.team_side === 'A').length;
      const bCount = (participants ?? []).filter((p) => p.team_side === 'B').length;
      if (aCount < 1 || bCount < 1) {
        return res.status(400).json({ error: 'Ranked matches need at least one registered player on each side. Set the lineup first.' });
      }
    }

    // ── SC-126: compute ELO + stat deltas in JS (E1-verified math, UNCHANGED),
    // then persist the core (profiles + rating_history + status) in ONE atomic
    // transaction via finalize_match (migration 051). ELO runs only for ranked
    // matches with a roster; casual matches just get status→completed.
    // SC-254: a walkover skips ALL attribution — no ELO/mp/W-L (allPlayerIds stays
    // empty, so the win-coins/streaks block and rating_change notifications below
    // are naturally skipped too). A forfeit is not a played game.
    const corePayloadProfiles: Array<Record<string, any>> = [];
    if (match.is_ranked && !walkover && participants && participants.length > 0) {
      const teamA = participants.filter((p) => p.team_side === 'A').map((p) => p.user_id);
      const teamB = participants.filter((p) => p.team_side === 'B').map((p) => p.user_id);
      allPlayerIds = [...teamA, ...teamB];

      let outcome: 1 | 0 | 0.5 = 0.5;
      if (winner_team_id) outcome = winner_team_id === match.team_a_id ? 1 : 0;

      const { data: existingProfiles } = await supabase
        .from('user_sport_profiles')
        .select('user_id, rating, matches_played, wins, losses, draws')
        .eq('sport_id', match.sport_id)
        .in('user_id', allPlayerIds);
      const profileMap = new Map<string, { rating: number; matches_played: number; wins: number; losses: number; draws: number }>();
      for (const p of existingProfiles || []) profileMap.set(p.user_id, p);
      // Missing profiles default to a fresh 1200/0 baseline — identical to the old
      // insert-then-read path, so the ELO numbers are unchanged.
      const getProfile = (uid: string) =>
        profileMap.get(uid) ?? { rating: 1200, matches_played: 0, wins: 0, losses: 0, draws: 0 };
      const avgRating = (ids: string[]) =>
        (ids.length === 0 ? 1200 : ids.reduce((s, uid) => s + getProfile(uid).rating, 0) / ids.length);
      const avgMatches = (ids: string[]) =>
        (ids.length === 0 ? 0 : Math.floor(ids.reduce((s, uid) => s + getProfile(uid).matches_played, 0) / ids.length));

      const [resultA, resultB] = calculateElo(
        { rating: avgRating(teamA), matchesPlayed: avgMatches(teamA) },
        { rating: avgRating(teamB), matchesPlayed: avgMatches(teamB) },
        outcome,
      );

      for (const uid of allPlayerIds) {
        const profile = getProfile(uid);
        const isTeamA = teamA.includes(uid);
        const result = isTeamA ? resultA : resultB;
        const oldRating = profile.rating;
        const clampedRating = Math.max(100, Math.round((oldRating + result.delta) * 100) / 100);
        const isWinner = winner_team_id ? (isTeamA ? outcome === 1 : outcome === 0) : false;
        const isLoser = winner_team_id ? (isTeamA ? outcome === 0 : outcome === 1) : false;
        corePayloadProfiles.push({
          user_id: uid,
          sport_id: match.sport_id,
          // Absolute values — read by the pre-054 finalize_match (and the JS fallback).
          rating: clampedRating,
          matches_played: profile.matches_played + 1,
          wins: profile.wins + (isWinner ? 1 : 0),
          losses: profile.losses + (isLoser ? 1 : 0),
          draws: profile.draws + (!winner_team_id ? 1 : 0),
          // SC-131 deltas — read by finalize_match (mig 054), applied ADDITIVELY so
          // concurrent completions of a player's different matches don't lose an update.
          // Both shapes travel together, so the JS is drop-in with either function version.
          rating_delta: Math.round(result.delta * 100) / 100,
          win_inc: isWinner ? 1 : 0,
          loss_inc: isLoser ? 1 : 0,
          draw_inc: !winner_team_id ? 1 : 0,
        });
        ratingHistoryRows.push({
          user_id: uid,
          sport_id: match.sport_id,
          match_id: id,
          old_rating: oldRating,
          new_rating: clampedRating,
          delta: Math.round((clampedRating - oldRating) * 100) / 100,
        });
      }
    }

    // ── SC-283: CASUAL participation attribution (matches_played + W/L/D count
    // for casual too — the field is matches_played, not ranked_matches_played;
    // the person DID play). Rating/coins stay RANKED-ONLY (below).
    //   Anti-farm: participants.length >= 2. match_participants rows are ALWAYS
    //   real user_ids (a free-text "opponent" name contributes no participant),
    //   so solo-vs-phantom = 1 participant = no-op → solo-farming is structurally
    //   dead, and casual attribution naturally scopes to real pickups.
    //   Mechanism: reuse finalize_match's ATOMIC per-player FOR-UPDATE path with
    //   rating_delta:0 (rating unchanged). finalize_match unconditionally writes
    //   one rating_history row per profile, so we DELETE the delta-0 rows right
    //   after (casual isn't rated — a rating_history row would pollute the ranked
    //   trajectory + SC-275 advanced-stats, which reads rating_history as the
    //   ranked universe). No migration.
    let casualAttribution = false;
    if (!match.is_ranked && !walkover && participants && participants.length >= 2) {
      casualAttribution = true;
      allPlayerIds = participants.map((p) => p.user_id);
      // Winner by SIDE — casual/free-text matches have no winner_team_id, so the
      // result is score-derived (computed early; recomputeSummary is idempotent).
      let casualWinnerSide: 'A' | 'B' | null = null;
      try {
        const ss = (await recomputeSummary(id)) as Record<string, any> | null;
        const aS = Number(ss?.A?.score ?? ss?.A?.runs ?? 0);
        const bS = Number(ss?.B?.score ?? ss?.B?.runs ?? 0);
        casualWinnerSide = aS > bS ? 'A' : bS > aS ? 'B' : null;
        if (winner_team_id === match.team_a_id) casualWinnerSide = 'A';
        else if (winner_team_id === match.team_b_id) casualWinnerSide = 'B';
      } catch { /* no scores → draw */ }
      for (const p of participants) {
        const isWin = casualWinnerSide != null && p.team_side === casualWinnerSide;
        const isLoss = casualWinnerSide != null && p.team_side !== casualWinnerSide;
        corePayloadProfiles.push({
          user_id: p.user_id,
          sport_id: match.sport_id,
          rating_delta: 0, // no rating movement — casual isn't rated
          win_inc: isWin ? 1 : 0,
          loss_inc: isLoss ? 1 : 0,
          draw_inc: casualWinnerSide == null ? 1 : 0,
        });
      }
    }

    // ── ATOMIC CORE (finalize_match, migration 051): profiles + rating_history +
    // status→completed in ONE transaction. Any failure → full rollback (match stays
    // not-completed, retryable); the in-txn status CAS blocks the double-apply.
    // Falls back to the sequential path until 051 is applied (deploy-order dependency).
    const p_results = {
      winner_team_id: winner_team_id || null,
      now,
      profiles: corePayloadProfiles,
      rating_history: ratingHistoryRows,
    };
    let updatedMatch: any = null;
    const fin = await supabase.rpc('finalize_match', { p_match_id: id, p_results });
    if (fin.error && fin.error.code === 'PGRST202') {
      // Pre-migration fallback: same values, sequential (NOT atomic — 051 closes this).
      for (const pr of corePayloadProfiles) {
        await supabase
          .from('user_sport_profiles')
          .upsert({ ...pr, last_match_at: now, updated_at: now }, { onConflict: 'user_id,sport_id' });
      }
      if (ratingHistoryRows.length > 0) {
        const { error: rhErr } = await supabase.from('rating_history').insert(ratingHistoryRows);
        if (rhErr) console.error('rating_history insert failed:', rhErr.message);
      }
      const { data: um, error: updateErr } = await supabase
        .from('matches')
        .update({ status: 'completed', winner_team_id: winner_team_id || null, updated_at: now })
        .eq('id', id)
        .select('*')
        .single();
      if (updateErr) return res.status(500).json({ error: sanitizeError(updateErr) });
      updatedMatch = um;
    } else if (fin.error) {
      return res.status(500).json({ error: sanitizeError(fin.error) });
    } else {
      const out = fin.data as { applied?: boolean; match?: any } | null;
      if (out && out.applied === false) {
        return res.status(400).json({ error: 'Match already completed' });
      }
      updatedMatch = out?.match ?? null;
    }

    // SC-283: casual isn't rated — remove the delta-0 rating_history rows
    // finalize_match wrote for a casual match, so casual never pollutes the
    // rating trajectory or the ranked analytics (SC-275 reads rating_history as
    // the ranked-match universe). Scoped by match_id — a casual match has no
    // legit rating_history, so this only removes our own delta-0 rows.
    if (casualAttribution) {
      const { error: rhDelErr } = await supabase.from('rating_history').delete().eq('match_id', id);
      if (rhDelErr) console.warn('[SC-283] casual rating_history cleanup failed:', rhDelErr.message); // eslint-disable-line no-console
    }

    // ── Post-core best-effort (never blocks completion; all idempotent) ──
    // (walkover leaves allPlayerIds empty, so this is skipped either way — the
    // explicit !walkover keeps the "no coins/streaks on a forfeit" intent local.)
    // SC-283: WIN-COINS stay RANKED-ONLY — coins are the economy anchor (they buy
    // gifts), a casual win must never mint currency.
    if (match.is_ranked && !walkover && allPlayerIds.length > 0) {
      // Award 5 coins to winners — idempotent per (user,match) via coin_events.
      if (winner_team_id) {
        const winnerSide = winner_team_id === match.team_a_id ? 'A' : 'B';
        const winnerIds = (participants ?? []).filter((p) => p.team_side === winnerSide).map((p) => p.user_id);
        for (const uid of winnerIds) void awardCoins(uid, `win_match_${id}`, 5);
      }
    }

    // SC-283: Activity streaks are PARTICIPATION (activity, not skill) — they move
    // for casual (>=2 participants) AND ranked. allPlayerIds carries the >=2 casual
    // guard already, and is empty for a solo/phantom match → no-op. Best-effort.
    if (!walkover && allPlayerIds.length > 0) {
      try {
        const todayStr = new Date().toISOString().slice(0, 10);
        const { data: currentUsers } = await supabase
          .from('users')
          .select('id, streak_count, last_match_date')
          .in('id', allPlayerIds);
        for (const u of currentUsers || []) {
          const last = u.last_match_date as string | null;
          let nextStreak = 1;
          if (last === todayStr) {
            nextStreak = u.streak_count ?? 1;
          } else if (last) {
            const lastMs = new Date(last + 'T00:00:00Z').getTime();
            const todayMs = new Date(todayStr + 'T00:00:00Z').getTime();
            const diffDays = Math.round((todayMs - lastMs) / 86400000);
            nextStreak = diffDays === 1 ? (u.streak_count ?? 0) + 1 : 1;
          }
          await supabase
            .from('users')
            .update({ streak_count: nextStreak, last_match_date: todayStr })
            .eq('id', u.id);
        }
      } catch {
        // swallow — streaks are a nice-to-have
      }
    }

    // Recompute the canonical summary from the event log, then derive the winner
    // BY SIDE and a human result string from the canonical per-side `score`.
    // The old code read seeded keys (ss.team_a_score/…) that the live scorer
    // never writes → "Match Draw" for app-scored matches (A5-007); and it relied
    // on winner_team_id, which is null for free-text-team matches → no winner
    // recorded even with a clear winner (L-001/L-002). winner_side fixes both.
    try {
      const { data: sportRow } = await supabase.from('sports').select('slug').eq('id', match.sport_id).maybeSingle();
      const slug = sportRow?.slug ?? '';
      const setSports = ['badminton', 'tennis', 'tabletennis', 'pickleball', 'volleyball'];
      const ss = ((await recomputeSummary(id)) ?? updatedMatch?.score_summary ?? {}) as Record<string, any>;
      const aName = match.team_a_name ?? 'Team A';
      const bName = match.team_b_name ?? 'Team B';
      const aScore = Number(ss?.A?.score ?? ss?.A?.runs ?? 0);
      const bScore = Number(ss?.B?.score ?? ss?.B?.runs ?? 0);

      // Authoritative winner by side (works without team ids). Prefer a
      // client-supplied winner_team_id when it maps to a real team.
      let winnerSide: 'A' | 'B' | null = aScore > bScore ? 'A' : bScore > aScore ? 'B' : null;
      if (winner_team_id) {
        if (winner_team_id === match.team_a_id) winnerSide = 'A';
        else if (winner_team_id === match.team_b_id) winnerSide = 'B';
      }

      let resultText = '';
      if (winnerSide) {
        const winnerName = winnerSide === 'A' ? aName : bName;
        const hi = Math.max(aScore, bScore);
        const lo = Math.min(aScore, bScore);
        if (slug === 'cricket') {
          resultText = `${winnerName} won by ${hi - lo} run${hi - lo === 1 ? '' : 's'}`;
        } else if (slug === 'chess') {
          resultText = `${winnerName} won`;
        } else if (setSports.includes(slug)) {
          resultText = `${winnerName} won ${hi}-${lo}`; // score = sets won
        } else {
          resultText = `${winnerName} won ${hi}-${lo}`; // goals / points / boards
        }
      } else {
        resultText = slug === 'chess' ? 'Match Draw' : `Match Draw ${aScore}-${bScore}`;
      }

      ss.result = resultText;
      ss.winner_side = winnerSide;
      // SC-254: mark a walkover so it's distinguishable from a genuine 0-0 played
      // result, and override the score-derived text ("… won by 0 runs") with the
      // forfeit label. winner_team_id is always present on a walkover → winnerSide
      // is set here.
      if (walkover && winnerSide) {
        ss.walkover = true;
        if (walkover_reason) ss.walkover_reason = String(walkover_reason).slice(0, 200);
        const wName = winnerSide === 'A' ? aName : bName;
        ss.result = `${wName} won by walkover`;
      }
      const patch: Record<string, any> = { score_summary: ss };
      // Backfill winner_team_id when the client didn't send it but a real team
      // maps to the winning side. Free-text matches keep null team ids (winner
      // is recorded via winner_side only).
      if (!winner_team_id && winnerSide) {
        const wid = winnerSide === 'A' ? match.team_a_id : match.team_b_id;
        if (wid) patch.winner_team_id = wid;
      }
      await supabase.from('matches').update(patch).eq('id', id);
    } catch { /* best effort */ }

    // A5-004 — derive per-player innings_stats from the attributed event log so
    // career batting/bowling stats are real (not the scorer-aggregated fallback).
    // Best-effort + idempotent; no-ops for non-cricket / unattributed matches.
    try {
      await writeCricketInningsStats(id);
    } catch (statErr) {
      console.error('innings_stats write failed:', statErr instanceof Error ? statErr.message : statErr);
    }

    // FEATURE 1 — Player of the Match. Compute + persist mvp_user_id now that
    // the match is completed and all scoring events exist. Best-effort: a
    // failure here must never block completion. Only matches with real
    // participants + scored events yield an MVP (casual name-only matches won't).
    try {
      await calculateAndSetMVP(id);
    } catch (mvpErr) {
      console.error('MVP calculation failed:', mvpErr instanceof Error ? mvpErr.message : mvpErr);
    }

    // Resolve sport name for nicer notification copy — falls back to ID.
    let sportName = 'rating';
    try {
      const { data: sport } = await supabase
        .from('sports')
        .select('name')
        .eq('id', match.sport_id)
        .maybeSingle();
      if (sport?.name) sportName = sport.name;
    } catch {
      // fall through
    }

    // PRD 12.1: notify each player of their rating delta.
    for (const row of ratingHistoryRows) {
      const sign = row.delta >= 0 ? '+' : '';
      void notifyUser({
        userId: row.user_id,
        type: 'rating_change',
        title: `${sportName} rating updated`,
        body: `Your ${sportName} rating changed: ${row.old_rating} \u2192 ${row.new_rating} (${sign}${row.delta})`,
        data: { sportId: match.sport_id, screen: 'SportProfile' },
      });
    }

    // PRD Section 4: if the match had an assigned umpire, prompt all
    // participants to rate them.
    if (match.umpire_id) {
      const matchLabel = (match.team_a_name && match.team_b_name)
        ? `${match.team_a_name} vs ${match.team_b_name}`
        : 'your match';
      // SC-249: derive the recipients from the actual match_participants rows,
      // NOT allPlayerIds — allPlayerIds is only populated inside the ranked-ELO
      // branch above, so a CASUAL umpired match had zero recipients and never
      // prompted anyone to rate the umpire. The participants list is fetched
      // regardless of is_ranked, so this fires for casual + ranked alike.
      const participantIds = Array.from(
        new Set((participants ?? []).map((p) => p.user_id).filter(Boolean)),
      ).filter((uid) => uid !== match.umpire_id);
      if (participantIds.length > 0) {
        void notifyUsers(participantIds, {
          type: 'umpire_rating_prompt',
          title: 'Rate your umpire',
          body: `Rate your umpire for ${matchLabel}`,
          data: { umpireId: match.umpire_id, matchId: id, screen: 'UmpireRatings' },
        });
      }
    }

    // If this is a tournament bracket match, propagate the winner into the next
    // round (and auto-complete the tournament if it was the final). Best-effort;
    // the winner_team_id was finalised above (incl. side-derived backfill).
    if (match.tournament_id) {
      try {
        await advanceTournamentWinner(id);
      } catch (advErr) {
        console.error('bracket advancement failed:', advErr instanceof Error ? advErr.message : advErr);
      }
    }

    return res.json({
      match: updatedMatch,
      ratings: ratingHistoryRows.map((r) => ({
        user_id: r.user_id,
        old_rating: r.old_rating,
        new_rating: r.new_rating,
        delta: r.delta,
      })),
    });
  } catch (e) {
    return res.status(500).json({ error: 'Internal server error' });
  }
}
