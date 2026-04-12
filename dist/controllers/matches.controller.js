"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.completeMatch = exports.cancelMatch = exports.selfAssignUmpire = exports.addParticipants = exports.updateMatch = exports.getMatch = exports.getCommentary = exports.listMatches = exports.joinOpenMatch = exports.setMatchTossHandler = exports.rateMatchHandler = exports.listOpenMatches = exports.createMatch = void 0;
const supabase_1 = require("../utils/supabase");
const ratingEngine_1 = require("../utils/ratingEngine");
const notify_1 = require("../utils/notify");
const venues_controller_1 = require("./venues.controller");
const coins_1 = require("../utils/coins");
const sportId_1 = require("../utils/sportId");
const response_1 = require("../utils/response");
// POST /matches — create. FREE for all (Change #6).
async function createMatch(req, res) {
    const userId = req.userId;
    if (!userId)
        return res.status(401).json({ error: 'Unauthorized' });
    try {
        const { sport_id, team_a_id, team_b_id, team_a_name, team_b_name, scheduled_at, venue, city_id, format, overs, tournament_id, is_open, players_needed, } = req.body || {};
        if (!sport_id)
            return res.status(400).json({ error: 'sport_id is required' });
        const { data, error } = await supabase_1.supabase
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
            created_by: userId,
        })
            .select('*')
            .single();
        if (error || !data)
            return res.status(500).json({ error: (0, response_1.sanitizeError)(error) || 'Failed to create match' });
        // Best-effort venue upsert — tracks frequently-used venues for the
        // autocomplete in CreateMatchScreen. Errors are swallowed.
        if (venue && typeof venue === 'string') {
            void (0, venues_controller_1.upsertVenue)(venue, city_id ?? null, userId);
        }
        return res.json({ match: data });
    }
    catch (e) {
        return res.status(500).json({ error: 'Internal server error' });
    }
}
exports.createMatch = createMatch;
// GET /matches/open — list open matches (is_open=true, not yet completed).
// Optional sport_id and city_id filters. Ordered by scheduled_at ascending so
// the soonest match shows first.
async function listOpenMatches(req, res) {
    const userId = req.userId;
    if (!userId)
        return res.status(401).json({ error: 'Unauthorized' });
    try {
        const { sport_id, city_id } = req.query;
        const resolvedSportId = await (0, sportId_1.resolveSportId)(sport_id);
        let query = supabase_1.supabase
            .from('matches')
            .select('*')
            .eq('is_open', true)
            .in('status', ['scheduled', 'upcoming'])
            .order('scheduled_at', { ascending: true })
            .limit(100);
        if (resolvedSportId)
            query = query.eq('sport_id', resolvedSportId);
        if (city_id)
            query = query.eq('city_id', city_id);
        const { data, error } = await query;
        if (error)
            return res.status(500).json({ error: (0, response_1.sanitizeError)(error) });
        return res.json({ matches: data ?? [] });
    }
    catch (e) {
        return res.status(500).json({ error: 'Internal server error' });
    }
}
exports.listOpenMatches = listOpenMatches;
// POST /matches/:id/rate  { matchQuality: 1-5, wouldPlayAgain: boolean }
// Inserts one row per (match, rater) into match_ratings. Returns the
// existing row if the user has already rated this match.
async function rateMatchHandler(req, res) {
    const userId = req.userId;
    if (!userId)
        return res.status(401).json({ error: 'Unauthorized' });
    const { id } = req.params;
    const { matchQuality, wouldPlayAgain } = req.body || {};
    if (typeof matchQuality !== 'number' || matchQuality < 1 || matchQuality > 5) {
        return res.status(400).json({ error: 'matchQuality must be 1-5' });
    }
    if (typeof wouldPlayAgain !== 'boolean') {
        return res.status(400).json({ error: 'wouldPlayAgain must be boolean' });
    }
    // Dedupe — one rating per user per match.
    const { data: existing } = await supabase_1.supabase
        .from('match_ratings')
        .select('*')
        .eq('match_id', id)
        .eq('rater_id', userId)
        .maybeSingle();
    if (existing)
        return res.json({ success: true, rating: existing, alreadyRated: true });
    const { data, error } = await supabase_1.supabase
        .from('match_ratings')
        .insert({
        match_id: id,
        rater_id: userId,
        match_quality: matchQuality,
        would_play_again: wouldPlayAgain,
    })
        .select('*')
        .single();
    if (error)
        return res.status(500).json({ error: (0, response_1.sanitizeError)(error) });
    return res.json({ success: true, rating: data });
}
exports.rateMatchHandler = rateMatchHandler;
// PATCH /matches/:id/toss  { tossWinnerTeamId, tossChoice }
// Stores the toss outcome on the match row so the scoring screen can
// display it in its header.
async function setMatchTossHandler(req, res) {
    const userId = req.userId;
    if (!userId)
        return res.status(401).json({ error: 'Unauthorized' });
    const { id } = req.params;
    const { tossWinnerTeamId, tossChoice } = req.body || {};
    if (!tossChoice)
        return res.status(400).json({ error: 'tossChoice is required' });
    const { data: match } = await supabase_1.supabase
        .from('matches')
        .select('created_by, umpire_id')
        .eq('id', id)
        .maybeSingle();
    if (!match)
        return res.status(404).json({ error: 'Match not found' });
    if (match.created_by !== userId && match.umpire_id !== userId) {
        return res.status(403).json({ error: 'Only the creator or umpire can record the toss' });
    }
    const { data, error } = await supabase_1.supabase
        .from('matches')
        .update({
        toss_winner_team_id: tossWinnerTeamId ?? null,
        toss_choice: tossChoice,
        updated_at: new Date().toISOString(),
    })
        .eq('id', id)
        .select('*')
        .single();
    if (error)
        return res.status(500).json({ error: (0, response_1.sanitizeError)(error) });
    return res.json({ match: data });
}
exports.setMatchTossHandler = setMatchTossHandler;
// POST /matches/:id/join — join an open match as a player.
// Inserts a match_participants row with team_side='A' (simple heuristic —
// future iterations can balance sides automatically).
async function joinOpenMatch(req, res) {
    const userId = req.userId;
    if (!userId)
        return res.status(401).json({ error: 'Unauthorized' });
    try {
        const { id } = req.params;
        const { data: match } = await supabase_1.supabase
            .from('matches')
            .select('id, is_open, status, players_needed')
            .eq('id', id)
            .maybeSingle();
        if (!match)
            return res.status(404).json({ error: 'Match not found' });
        if (!match.is_open)
            return res.status(400).json({ error: 'Match is not open' });
        if (match.status === 'completed' || match.status === 'cancelled') {
            return res.status(400).json({ error: 'Match has ended' });
        }
        // Don't double-join.
        const { data: existing } = await supabase_1.supabase
            .from('match_participants')
            .select('id')
            .eq('match_id', id)
            .eq('user_id', userId)
            .maybeSingle();
        if (existing)
            return res.json({ success: true, alreadyJoined: true });
        const { error } = await supabase_1.supabase
            .from('match_participants')
            .insert({ match_id: id, user_id: userId, team_side: 'A' });
        if (error)
            return res.status(500).json({ error: (0, response_1.sanitizeError)(error) });
        // Decrement players_needed (never below 0). If it hits 0, close the match.
        const nextNeeded = Math.max(0, (match.players_needed ?? 0) - 1);
        await supabase_1.supabase
            .from('matches')
            .update({
            players_needed: nextNeeded,
            is_open: nextNeeded > 0,
            updated_at: new Date().toISOString(),
        })
            .eq('id', id);
        return res.json({ success: true, players_needed: nextNeeded });
    }
    catch (e) {
        return res.status(500).json({ error: 'Internal server error' });
    }
}
exports.joinOpenMatch = joinOpenMatch;
// GET /matches
async function listMatches(req, res) {
    const userId = req.userId;
    if (!userId)
        return res.status(401).json({ error: 'Unauthorized' });
    try {
        const { sport_id, status, tournament_id, team_id, mine } = req.query;
        // Accept either a UUID or a slug/name for sport_id — the mobile app
        // has some legacy call sites that still pass 'cricket' / 'badminton'.
        const resolvedSportId = await (0, sportId_1.resolveSportId)(sport_id);
        let query = supabase_1.supabase.from('matches').select('*').order('scheduled_at', { ascending: false }).limit(100);
        if (resolvedSportId)
            query = query.eq('sport_id', resolvedSportId);
        if (status)
            query = query.eq('status', status);
        if (tournament_id)
            query = query.eq('tournament_id', tournament_id);
        if (team_id)
            query = query.or(`team_a_id.eq.${team_id},team_b_id.eq.${team_id}`);
        if (mine === '1')
            query = query.eq('created_by', userId);
        const { data, error } = await query;
        if (error)
            return res.status(500).json({ error: (0, response_1.sanitizeError)(error) });
        return res.json({ matches: data || [] });
    }
    catch (e) {
        return res.status(500).json({ error: 'Internal server error' });
    }
}
exports.listMatches = listMatches;
// GET /matches/:id/commentary — returns match_events formatted into
// human-readable commentary lines. Cheap — reads only the events table.
async function getCommentary(req, res) {
    const userId = req.userId;
    if (!userId)
        return res.status(401).json({ error: 'Unauthorized' });
    try {
        const { id } = req.params;
        const { data: match } = await supabase_1.supabase
            .from('matches')
            .select('id, sport_id, team_a_name, team_b_name')
            .eq('id', id)
            .maybeSingle();
        if (!match)
            return res.status(404).json({ error: 'Match not found' });
        const { data: events, error } = await supabase_1.supabase
            .from('match_events')
            .select('id, event_type, period, clock_seconds, payload, created_at')
            .eq('match_id', id)
            .order('created_at', { ascending: true });
        if (error)
            return res.status(500).json({ error: (0, response_1.sanitizeError)(error) });
        const isCricket = !!match.sport_id && String(match.sport_id).toLowerCase().includes('cric');
        let legalBalls = 0;
        const enriched = [];
        for (const ev of events ?? []) {
            const p = ev.payload ?? {};
            // For cricket, compute the over.ball label from a running legal-ball
            // count. Wides and no-balls don't advance the legal count.
            let overBallLabel = null;
            if (isCricket) {
                const isLegal = !(p.is_extra || ev.event_type === 'extra' || p.type === 'Wd' || p.type === 'Nb');
                if (isLegal)
                    legalBalls += 1;
                const displayBalls = isLegal ? legalBalls : legalBalls + 1;
                const overNum = Math.floor((displayBalls - 1) / 6);
                const ballInOver = ((displayBalls - 1) % 6) + 1;
                overBallLabel = `${overNum}.${ballInOver}`;
            }
            let commentary = ev.event_type;
            let isWicket = false;
            let isBoundary = false;
            if (ev.event_type === 'wicket' || (ev.event_type === 'ball' && p.wicket)) {
                isWicket = true;
                const batter = p.batsmanName || p.player_name || p.batter || 'Batter';
                commentary = `OUT! ${batter}${p.runs != null ? ` — ${p.runs} runs` : ''}`;
            }
            else if (ev.event_type === 'ball') {
                const runs = Number(p.runs ?? 0);
                if (runs === 4) {
                    commentary = 'FOUR! Beautiful shot';
                    isBoundary = true;
                }
                else if (runs === 6) {
                    commentary = 'SIX! That\u2019s massive!';
                    isBoundary = true;
                }
                else if (runs === 0) {
                    commentary = 'Dot ball';
                }
                else {
                    commentary = `${runs} run${runs === 1 ? '' : 's'}`;
                }
            }
            else if (ev.event_type === 'extra') {
                if (p.type === 'Wd')
                    commentary = 'Wide ball';
                else if (p.type === 'Nb')
                    commentary = 'No ball called';
                else
                    commentary = `Extra: ${p.type ?? ''}`;
            }
            else if (ev.event_type === 'goal') {
                const team = p.team_name || `Team ${p.team_side ?? ''}`;
                const a = p.score_a ?? '';
                const b = p.score_b ?? '';
                commentary = `\u26BD GOAL! ${team} scores!${a !== '' ? ` ${a}-${b}` : ''}`;
                isBoundary = true;
            }
            else if (ev.event_type === 'yellow_card') {
                commentary = `\uD83D\uDFE8 Yellow card${p.player ? ` for ${p.player}` : ''}`;
            }
            else if (ev.event_type === 'red_card') {
                commentary = `\uD83D\uDFE5 Red card${p.player ? ` for ${p.player}` : ''}`;
                isWicket = true;
            }
            else if (ev.event_type === 'score' || ev.event_type === 'point') {
                // Generic point-based sports (badminton, TT, pickleball, volleyball)
                const team = p.team_name || `Team ${p.team_side ?? '?'}`;
                const pts = p.points ?? p.runs ?? 1;
                commentary = `${pts === 1 ? 'Point' : `${pts} points`} to ${team}`;
            }
            else if (ev.event_type === 'basket') {
                const pts = p.points ?? 2;
                const team = p.team_name || `Team ${p.team_side ?? '?'}`;
                commentary = `\uD83C\uDFC0 ${pts}-pointer! ${team}`;
            }
            else if (ev.event_type === 'foul') {
                const team = p.team_name || `Team ${p.team_side ?? '?'}`;
                commentary = `Foul by ${team}${p.bonus ? ' — BONUS free throws' : ''}`;
            }
            else if (ev.event_type === 'move') {
                // Chess
                commentary = `\u265F\uFE0F Move ${p.moveNumber ?? ''} — game in progress`;
            }
            else if (ev.event_type === 'timeout') {
                commentary = `\u23F8\uFE0F Timeout called by ${p.team_name ?? 'team'}`;
            }
            else if (ev.event_type === 'assist') {
                commentary = `\uD83C\uDD70\uFE0F Assist${p.player ? ` by ${p.player}` : ''}`;
            }
            else if (ev.event_type === 'sub') {
                commentary = `\uD83D\uDD04 Substitution${p.player ? ` — ${p.player}` : ''}`;
            }
            else if (ev.event_type === 'queen') {
                // Carrom
                commentary = `\uD83D\uDC51 Queen pocketed! +5 points`;
            }
            else {
                commentary = `${ev.event_type}${p && Object.keys(p).length > 0 ? ` ${JSON.stringify(p).slice(0, 80)}` : ''}`;
            }
            enriched.push({
                id: ev.id,
                over_ball: overBallLabel,
                event_type: ev.event_type,
                commentary,
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
    }
    catch (e) {
        return res.status(500).json({ error: 'Internal server error' });
    }
}
exports.getCommentary = getCommentary;
// GET /matches/:id
async function getMatch(req, res) {
    const userId = req.userId;
    if (!userId)
        return res.status(401).json({ error: 'Unauthorized' });
    try {
        const { id } = req.params;
        const { data: match, error } = await supabase_1.supabase.from('matches').select('*').eq('id', id).maybeSingle();
        if (error || !match)
            return res.status(404).json({ error: 'Match not found' });
        const { data: participants } = await supabase_1.supabase
            .from('match_participants')
            .select('id, team_side, role, jersey_number, batting_order, user:user_id (id, name, username, profile_picture_url)')
            .eq('match_id', id);
        const { count } = await supabase_1.supabase
            .from('match_events')
            .select('id', { count: 'exact', head: true })
            .eq('match_id', id);
        // Compute the average match-quality rating from match_ratings on read.
        // Cheap — there are only a handful of ratings per match.
        const { data: ratings } = await supabase_1.supabase
            .from('match_ratings')
            .select('match_quality')
            .eq('match_id', id);
        const matchWithRating = { ...match };
        if (ratings && ratings.length > 0) {
            const sum = ratings.reduce((acc, r) => acc + (r.match_quality ?? 0), 0);
            matchWithRating.avg_rating = Math.round((sum / ratings.length) * 10) / 10;
            matchWithRating.rating_count = ratings.length;
        }
        return res.json({ match: matchWithRating, participants: participants || [], events_count: count || 0 });
    }
    catch (e) {
        return res.status(500).json({ error: 'Internal server error' });
    }
}
exports.getMatch = getMatch;
// PATCH /matches/:id — creator or umpire only
async function updateMatch(req, res) {
    const userId = req.userId;
    if (!userId)
        return res.status(401).json({ error: 'Unauthorized' });
    try {
        const { id } = req.params;
        const { data: match } = await supabase_1.supabase
            .from('matches')
            .select('created_by, umpire_id')
            .eq('id', id)
            .maybeSingle();
        if (!match)
            return res.status(404).json({ error: 'Match not found' });
        if (match.created_by !== userId && match.umpire_id !== userId) {
            return res.status(403).json({ error: 'Only the creator or umpire can update' });
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
        const update = {};
        for (const key of allowedKeys) {
            if (req.body && key in req.body)
                update[key] = req.body[key];
        }
        update.updated_at = new Date().toISOString();
        const { data, error } = await supabase_1.supabase.from('matches').update(update).eq('id', id).select('*').single();
        if (error)
            return res.status(500).json({ error: (0, response_1.sanitizeError)(error) });
        return res.json({ match: data });
    }
    catch (e) {
        return res.status(500).json({ error: 'Internal server error' });
    }
}
exports.updateMatch = updateMatch;
// POST /matches/:id/participants — bulk add
async function addParticipants(req, res) {
    const userId = req.userId;
    if (!userId)
        return res.status(401).json({ error: 'Unauthorized' });
    try {
        const { id } = req.params;
        const { participants } = req.body || {};
        if (!Array.isArray(participants) || participants.length === 0) {
            return res.status(400).json({ error: 'participants array is required' });
        }
        const { data: match } = await supabase_1.supabase
            .from('matches')
            .select('created_by, umpire_id')
            .eq('id', id)
            .maybeSingle();
        if (!match)
            return res.status(404).json({ error: 'Match not found' });
        if (match.created_by !== userId && match.umpire_id !== userId) {
            return res.status(403).json({ error: 'Only the creator or umpire can add participants' });
        }
        const rows = participants.map((p) => ({
            match_id: id,
            user_id: p.user_id,
            team_side: p.team_side,
            role: p.role || null,
            jersey_number: p.jersey_number ?? null,
            batting_order: p.batting_order ?? null,
        }));
        const { data, error } = await supabase_1.supabase.from('match_participants').insert(rows).select('*');
        if (error)
            return res.status(500).json({ error: (0, response_1.sanitizeError)(error) });
        return res.json({ participants: data || [] });
    }
    catch (e) {
        return res.status(500).json({ error: 'Internal server error' });
    }
}
exports.addParticipants = addParticipants;
// POST /matches/:id/umpire/self-assign
async function selfAssignUmpire(req, res) {
    const userId = req.userId;
    if (!userId)
        return res.status(401).json({ error: 'Unauthorized' });
    try {
        const { id } = req.params;
        const { data: match } = await supabase_1.supabase
            .from('matches')
            .select('id, umpire_id')
            .eq('id', id)
            .maybeSingle();
        if (!match)
            return res.status(404).json({ error: 'Match not found' });
        if (match.umpire_id)
            return res.status(409).json({ error: 'Match already has an umpire' });
        const { data, error } = await supabase_1.supabase
            .from('matches')
            .update({ umpire_id: userId, updated_at: new Date().toISOString() })
            .eq('id', id)
            .select('*')
            .single();
        if (error)
            return res.status(500).json({ error: (0, response_1.sanitizeError)(error) });
        return res.json({ match: data });
    }
    catch (e) {
        return res.status(500).json({ error: 'Internal server error' });
    }
}
exports.selfAssignUmpire = selfAssignUmpire;
// DELETE /matches/:id — cancel (creator only)
async function cancelMatch(req, res) {
    const userId = req.userId;
    if (!userId)
        return res.status(401).json({ error: 'Unauthorized' });
    try {
        const { id } = req.params;
        const { data: match } = await supabase_1.supabase
            .from('matches')
            .select('id, created_by, team_a_name, team_b_name')
            .eq('id', id)
            .maybeSingle();
        if (!match)
            return res.status(404).json({ error: 'Match not found' });
        if (match.created_by !== userId)
            return res.status(403).json({ error: 'Only the creator can cancel' });
        const { data, error } = await supabase_1.supabase
            .from('matches')
            .update({ status: 'cancelled', updated_at: new Date().toISOString() })
            .eq('id', id)
            .select('*')
            .single();
        if (error)
            return res.status(500).json({ error: (0, response_1.sanitizeError)(error) });
        // PRD Addition #17: notify every participant of the cancellation.
        try {
            const { data: participants } = await supabase_1.supabase
                .from('match_participants')
                .select('user_id')
                .eq('match_id', id);
            const participantIds = (participants || []).map((p) => p.user_id);
            const matchLabel = (match.team_a_name && match.team_b_name)
                ? `${match.team_a_name} vs ${match.team_b_name}`
                : 'Your match';
            if (participantIds.length > 0) {
                await (0, notify_1.notifyUsers)(participantIds, {
                    type: 'match_cancelled',
                    title: 'Match cancelled',
                    body: `${matchLabel} has been cancelled by the organiser`,
                    data: { matchId: id, screen: 'MatchDetail' },
                });
            }
        }
        catch {
            // best-effort
        }
        return res.json({ match: data });
    }
    catch (e) {
        return res.status(500).json({ error: 'Internal server error' });
    }
}
exports.cancelMatch = cancelMatch;
// POST /matches/:id/complete — finalize match, calculate ELO, update profiles.
// Body: { winner_team_id?: string } — omit for draw.
async function completeMatch(req, res) {
    const userId = req.userId;
    if (!userId)
        return res.status(401).json({ error: 'Unauthorized' });
    try {
        const { id } = req.params;
        const { winner_team_id } = req.body || {};
        const { data: match } = await supabase_1.supabase
            .from('matches')
            .select('id, sport_id, team_a_id, team_b_id, status, created_by, umpire_id, team_a_name, team_b_name')
            .eq('id', id)
            .maybeSingle();
        if (!match)
            return res.status(404).json({ error: 'Match not found' });
        if (match.status === 'completed')
            return res.status(400).json({ error: 'Match already completed' });
        if (match.created_by !== userId && match.umpire_id !== userId) {
            return res.status(403).json({ error: 'Only the creator or umpire can complete' });
        }
        // Get participants grouped by team side
        const { data: participants } = await supabase_1.supabase
            .from('match_participants')
            .select('user_id, team_side')
            .eq('match_id', id);
        if (!participants || participants.length === 0) {
            return res.status(400).json({ error: 'No participants in match' });
        }
        const teamA = participants.filter((p) => p.team_side === 'A').map((p) => p.user_id);
        const teamB = participants.filter((p) => p.team_side === 'B').map((p) => p.user_id);
        const allPlayerIds = [...teamA, ...teamB];
        // Determine outcome: 1 = A wins, 0 = B wins, 0.5 = draw
        let outcome = 0.5;
        if (winner_team_id) {
            outcome = winner_team_id === match.team_a_id ? 1 : 0;
        }
        // Fetch or create sport profiles for all participants
        const { data: existingProfiles } = await supabase_1.supabase
            .from('user_sport_profiles')
            .select('id, user_id, rating, matches_played, wins, losses, draws')
            .eq('sport_id', match.sport_id)
            .in('user_id', allPlayerIds);
        const profileMap = new Map();
        for (const p of existingProfiles || []) {
            profileMap.set(p.user_id, p);
        }
        // Create missing profiles
        const missingIds = allPlayerIds.filter((uid) => !profileMap.has(uid));
        if (missingIds.length > 0) {
            const rows = missingIds.map((uid) => ({ user_id: uid, sport_id: match.sport_id }));
            const { data: created } = await supabase_1.supabase
                .from('user_sport_profiles')
                .insert(rows)
                .select('id, user_id, rating, matches_played, wins, losses, draws');
            for (const p of created || []) {
                profileMap.set(p.user_id, p);
            }
        }
        // Calculate average rating per team for ELO
        const avgRating = (ids) => {
            if (ids.length === 0)
                return 1200;
            return ids.reduce((sum, uid) => sum + (profileMap.get(uid)?.rating ?? 1200), 0) / ids.length;
        };
        const avgMatches = (ids) => {
            if (ids.length === 0)
                return 0;
            return Math.floor(ids.reduce((sum, uid) => sum + (profileMap.get(uid)?.matches_played ?? 0), 0) / ids.length);
        };
        const [resultA, resultB] = (0, ratingEngine_1.calculateElo)({ rating: avgRating(teamA), matchesPlayed: avgMatches(teamA) }, { rating: avgRating(teamB), matchesPlayed: avgMatches(teamB) }, outcome);
        const now = new Date().toISOString();
        const ratingHistoryRows = [];
        // Update each player's profile
        for (const uid of allPlayerIds) {
            const profile = profileMap.get(uid);
            const isTeamA = teamA.includes(uid);
            const result = isTeamA ? resultA : resultB;
            const oldRating = profile.rating;
            const newRating = Math.round((oldRating + result.delta) * 100) / 100;
            const clampedRating = Math.max(100, newRating);
            const isWinner = winner_team_id
                ? (isTeamA ? outcome === 1 : outcome === 0)
                : false;
            const isLoser = winner_team_id
                ? (isTeamA ? outcome === 0 : outcome === 1)
                : false;
            await supabase_1.supabase
                .from('user_sport_profiles')
                .update({
                rating: clampedRating,
                matches_played: profile.matches_played + 1,
                wins: profile.wins + (isWinner ? 1 : 0),
                losses: profile.losses + (isLoser ? 1 : 0),
                draws: profile.draws + (!winner_team_id ? 1 : 0),
                last_match_at: now,
                updated_at: now,
            })
                .eq('id', profile.id);
            ratingHistoryRows.push({
                user_id: uid,
                sport_id: match.sport_id,
                match_id: id,
                old_rating: oldRating,
                new_rating: clampedRating,
                delta: Math.round((clampedRating - oldRating) * 100) / 100,
            });
        }
        // Insert rating history
        if (ratingHistoryRows.length > 0) {
            await supabase_1.supabase.from('rating_history').insert(ratingHistoryRows);
        }
        // Award 5 coins to every player on the winning team. Idempotent per
        // (user, match) via awardCoins' unique key on coin_events.
        if (winner_team_id) {
            const winnerIds = winner_team_id === match.team_a_id ? teamA : teamB;
            for (const uid of winnerIds) {
                void (0, coins_1.awardCoins)(uid, `win_match_${id}`, 5);
            }
        }
        // Activity streaks: advance each participant's streak_count based on the
        // gap between today and their last_match_date. Rules:
        //   * same day     → no change (already counted)
        //   * yesterday    → +1
        //   * older / null → reset to 1
        // Best-effort — failures never block match completion.
        try {
            const todayStr = new Date().toISOString().slice(0, 10);
            const { data: currentUsers } = await supabase_1.supabase
                .from('users')
                .select('id, streak_count, last_match_date')
                .in('id', allPlayerIds);
            for (const u of currentUsers || []) {
                const last = u.last_match_date;
                let nextStreak = 1;
                if (last === todayStr) {
                    nextStreak = u.streak_count ?? 1;
                }
                else if (last) {
                    const lastMs = new Date(last + 'T00:00:00Z').getTime();
                    const todayMs = new Date(todayStr + 'T00:00:00Z').getTime();
                    const diffDays = Math.round((todayMs - lastMs) / 86400000);
                    nextStreak = diffDays === 1 ? (u.streak_count ?? 0) + 1 : 1;
                }
                await supabase_1.supabase
                    .from('users')
                    .update({ streak_count: nextStreak, last_match_date: todayStr })
                    .eq('id', u.id);
            }
        }
        catch {
            // swallow — streaks are a nice-to-have
        }
        // Mark match as completed
        const { data: updatedMatch, error: updateErr } = await supabase_1.supabase
            .from('matches')
            .update({
            status: 'completed',
            winner_team_id: winner_team_id || null,
            updated_at: now,
        })
            .eq('id', id)
            .select('*')
            .single();
        if (updateErr)
            return res.status(500).json({ error: (0, response_1.sanitizeError)(updateErr) });
        // FIX 5: Auto-generate sport-specific result text and store in score_summary
        try {
            const { data: sportRow } = await supabase_1.supabase.from('sports').select('slug').eq('id', match.sport_id).maybeSingle();
            const slug = sportRow?.slug ?? '';
            const ss = (updatedMatch?.score_summary ?? {});
            const aName = match.team_a_name ?? 'Team A';
            const bName = match.team_b_name ?? 'Team B';
            const aScore = ss.team_a_score ?? '';
            const bScore = ss.team_b_score ?? '';
            let resultText = '';
            if (winner_team_id) {
                const winnerName = winner_team_id === match.team_a_id ? aName : bName;
                if (slug === 'cricket') {
                    const diff = Math.abs(Number(String(aScore).split('/')[0]) - Number(String(bScore).split('/')[0]));
                    resultText = winner_team_id === match.team_a_id
                        ? `${winnerName} won by ${diff} runs`
                        : `${winnerName} won by ${10 - Number(String(bScore).split('/')[1] ?? 0)} wickets`;
                }
                else if (['badminton', 'tennis', 'tabletennis', 'pickleball', 'volleyball'].includes(slug)) {
                    const setsA = (ss.team_a_sets ?? ss.team_a_games ?? []);
                    const setsB = (ss.team_b_sets ?? ss.team_b_games ?? []);
                    const wA = setsA.filter((_, i) => (setsA[i] ?? 0) > (setsB[i] ?? 0)).length;
                    const wB = setsB.filter((_, i) => (setsB[i] ?? 0) > (setsA[i] ?? 0)).length;
                    resultText = `${winnerName} won ${Math.max(wA, wB)}-${Math.min(wA, wB)}`;
                }
                else if (['football', 'hockey'].includes(slug)) {
                    resultText = `${winnerName} won ${aScore}-${bScore}`;
                }
                else if (slug === 'basketball') {
                    resultText = `${winnerName} won ${aScore}-${bScore}`;
                }
                else if (slug === 'chess') {
                    resultText = `${winnerName} won`;
                }
                else if (slug === 'carrom') {
                    resultText = `${winnerName} won ${aScore}-${bScore}`;
                }
                else {
                    resultText = `${winnerName} won`;
                }
            }
            else {
                resultText = ['football', 'hockey'].includes(slug) ? `Match Draw ${aScore}-${bScore}` : 'Match Draw';
            }
            if (resultText) {
                ss.result = resultText;
                await supabase_1.supabase.from('matches').update({ score_summary: ss }).eq('id', id);
            }
        }
        catch { /* best effort */ }
        // Resolve sport name for nicer notification copy — falls back to ID.
        let sportName = 'rating';
        try {
            const { data: sport } = await supabase_1.supabase
                .from('sports')
                .select('name')
                .eq('id', match.sport_id)
                .maybeSingle();
            if (sport?.name)
                sportName = sport.name;
        }
        catch {
            // fall through
        }
        // PRD 12.1: notify each player of their rating delta.
        for (const row of ratingHistoryRows) {
            const sign = row.delta >= 0 ? '+' : '';
            void (0, notify_1.notifyUser)({
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
            const participantIds = allPlayerIds.filter((uid) => uid !== match.umpire_id);
            if (participantIds.length > 0) {
                void (0, notify_1.notifyUsers)(participantIds, {
                    type: 'umpire_rating_prompt',
                    title: 'Rate your umpire',
                    body: `Rate your umpire for ${matchLabel}`,
                    data: { umpireId: match.umpire_id, matchId: id, screen: 'UmpireRatings' },
                });
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
    }
    catch (e) {
        return res.status(500).json({ error: 'Internal server error' });
    }
}
exports.completeMatch = completeMatch;
//# sourceMappingURL=matches.controller.js.map