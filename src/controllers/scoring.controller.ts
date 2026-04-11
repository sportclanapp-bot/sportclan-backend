import { Request, Response } from 'express';
import { supabase } from '../utils/supabase';
import { notifyUsers } from '../utils/notify';

// Fire-and-forget: push the big moments of a live match (wickets, goals) to
// every participant in the match. Failures are swallowed — the fan-out must
// never block the scorer's UI.
async function fanoutScoreUpdate(
  matchId: string,
  title: string,
  body: string,
): Promise<void> {
  try {
    const { data: participants } = await supabase
      .from('match_participants')
      .select('user_id')
      .eq('match_id', matchId);
    const userIds = (participants || []).map((p) => p.user_id);
    if (userIds.length === 0) return;
    await notifyUsers(userIds, {
      type: 'score_update',
      title,
      body,
      data: { matchId, screen: 'MatchDetail' },
    });
  } catch {
    // best-effort
  }
}

async function authorizeScorer(matchId: string, userId: string) {
  const { data: match } = await supabase
    .from('matches')
    .select('id, created_by, umpire_id, score_summary, sport_id')
    .eq('id', matchId)
    .maybeSingle();
  if (!match) return { ok: false as const, status: 404, error: 'Match not found' };
  if (match.created_by !== userId && match.umpire_id !== userId) {
    return { ok: false as const, status: 403, error: 'Only the umpire or creator can score' };
  }
  return { ok: true as const, match };
}

// POST /scoring/:matchId/event
export async function createEvent(req: Request, res: Response) {
  const userId = req.userId;
  if (!userId) return res.status(401).json({ error: 'Unauthorized' });
  try {
    const matchId = String(req.params.matchId);
    const { event_type, period, clock_seconds, payload } = req.body || {};
    if (!event_type) return res.status(400).json({ error: 'event_type is required' });

    const auth = await authorizeScorer(matchId, userId);
    if (!auth.ok) return res.status(auth.status).json({ error: auth.error });
    const match = auth.match;

    const { data: event, error } = await supabase
      .from('match_events')
      .insert({
        match_id: matchId,
        event_type,
        period: period ?? null,
        clock_seconds: clock_seconds ?? null,
        payload: payload || {},
        created_by: userId,
      })
      .select('*')
      .single();
    if (error || !event) return res.status(500).json({ error: error?.message || 'Failed to log event' });

    // Best-effort cricket score summary update
    try {
      const summary: any = match.score_summary || {};
      if (event_type === 'ball') {
        const side = (payload?.team_side as string) || 'A';
        const inning = summary[side] || { runs: 0, balls: 0, wickets: 0 };
        const runs = Number(payload?.runs ?? 0);
        const isExtra = !!payload?.is_extra;
        inning.runs = (inning.runs || 0) + runs;
        if (!isExtra) inning.balls = (inning.balls || 0) + 1;
        summary[side] = inning;
        await supabase
          .from('matches')
          .update({ score_summary: summary, updated_at: new Date().toISOString() })
          .eq('id', matchId);
      } else if (event_type === 'wicket') {
        const side = (payload?.team_side as string) || 'A';
        const inning = summary[side] || { runs: 0, balls: 0, wickets: 0 };
        inning.wickets = (inning.wickets || 0) + 1;
        if (!payload?.is_extra) inning.balls = (inning.balls || 0) + 1;
        summary[side] = inning;
        await supabase
          .from('matches')
          .update({ score_summary: summary, updated_at: new Date().toISOString() })
          .eq('id', matchId);
      }
    } catch {
      // ignore best-effort update errors
    }

    // PRD 12.1: fan out push notifications for wickets and goals. We don't
    // await — the scorer shouldn't block on push delivery.
    try {
      if (event_type === 'wicket') {
        const side = (payload?.team_side as string) || 'A';
        const playerName = (payload?.batter_name as string) || (payload?.player_name as string) || 'Batter';
        const runs = payload?.batter_runs ?? payload?.runs_scored ?? '';
        const inning: any = (match.score_summary || {})[side] || {};
        const scoreStr = `${inning.runs ?? 0}/${(inning.wickets ?? 0) + 1}`;
        const teamLabel = `Team ${side}`;
        const title = 'Wicket!';
        const body = runs !== ''
          ? `${playerName} out for ${runs} | ${teamLabel} ${scoreStr}`
          : `${playerName} out | ${teamLabel} ${scoreStr}`;
        void fanoutScoreUpdate(matchId, title, body);
      } else if (event_type === 'goal') {
        const side = (payload?.team_side as string) || 'A';
        const teamLabel = (payload?.team_name as string) || `Team ${side}`;
        const summary: any = match.score_summary || {};
        const a = summary.A?.goals ?? summary.A?.score ?? 0;
        const b = summary.B?.goals ?? summary.B?.score ?? 0;
        const newA = side === 'A' ? a + 1 : a;
        const newB = side === 'B' ? b + 1 : b;
        const title = 'GOAL!';
        const body = `${teamLabel} scores! ${newA}-${newB}`;
        void fanoutScoreUpdate(matchId, title, body);
      }
    } catch {
      // ignore
    }

    return res.json({ event });
  } catch (e) {
    return res.status(500).json({ error: 'Internal server error' });
  }
}

// GET /scoring/:matchId/events
export async function listEvents(req: Request, res: Response) {
  const userId = req.userId;
  if (!userId) return res.status(401).json({ error: 'Unauthorized' });
  try {
    const matchId = String(req.params.matchId);
    const { since, limit } = req.query as Record<string, string | undefined>;
    let query = supabase
      .from('match_events')
      .select('*')
      .eq('match_id', matchId)
      .order('created_at', { ascending: true })
      .limit(Math.min(parseInt(limit || '500', 10), 1000));
    if (since) query = query.gt('created_at', since);
    const { data, error } = await query;
    if (error) return res.status(500).json({ error: error.message });
    return res.json({ events: data || [] });
  } catch (e) {
    return res.status(500).json({ error: 'Internal server error' });
  }
}

// POST /scoring/:matchId/undo
export async function undoEvent(req: Request, res: Response) {
  const userId = req.userId;
  if (!userId) return res.status(401).json({ error: 'Unauthorized' });
  try {
    const matchId = String(req.params.matchId);
    const auth = await authorizeScorer(matchId, userId);
    if (!auth.ok) return res.status(auth.status).json({ error: auth.error });

    const { data: latest } = await supabase
      .from('match_events')
      .select('id')
      .eq('match_id', matchId)
      .eq('created_by', userId)
      .order('created_at', { ascending: false })
      .limit(1)
      .maybeSingle();
    if (!latest) return res.status(404).json({ error: 'No event to undo' });
    const { error } = await supabase.from('match_events').delete().eq('id', latest.id);
    if (error) return res.status(500).json({ error: error.message });
    return res.json({ deleted: true });
  } catch (e) {
    return res.status(500).json({ error: 'Internal server error' });
  }
}
