import { Request, Response } from 'express';
import { supabase } from '../utils/supabase';

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
    } = req.body || {};
    if (!sport_id) return res.status(400).json({ error: 'sport_id is required' });
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
        created_by: userId,
      })
      .select('*')
      .single();
    if (error || !data) return res.status(500).json({ error: error?.message || 'Failed to create match' });
    return res.json({ match: data });
  } catch (e) {
    return res.status(500).json({ error: 'Internal server error' });
  }
}

// GET /matches
export async function listMatches(req: Request, res: Response) {
  const userId = req.userId;
  if (!userId) return res.status(401).json({ error: 'Unauthorized' });
  try {
    const { sport_id, status, tournament_id, team_id, mine } = req.query as Record<string, string | undefined>;
    let query = supabase.from('matches').select('*').order('scheduled_at', { ascending: false }).limit(100);
    if (sport_id) query = query.eq('sport_id', sport_id);
    if (status) query = query.eq('status', status);
    if (tournament_id) query = query.eq('tournament_id', tournament_id);
    if (team_id) query = query.or(`team_a_id.eq.${team_id},team_b_id.eq.${team_id}`);
    if (mine === '1') query = query.eq('created_by', userId);
    const { data, error } = await query;
    if (error) return res.status(500).json({ error: error.message });
    return res.json({ matches: data || [] });
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
    return res.json({ match, participants: participants || [], events_count: count || 0 });
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
      .select('created_by, umpire_id')
      .eq('id', id)
      .maybeSingle();
    if (!match) return res.status(404).json({ error: 'Match not found' });
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
    const update: Record<string, any> = {};
    for (const key of allowedKeys) {
      if (req.body && key in req.body) update[key] = req.body[key];
    }
    update.updated_at = new Date().toISOString();
    const { data, error } = await supabase.from('matches').update(update).eq('id', id).select('*').single();
    if (error) return res.status(500).json({ error: error.message });
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
    const { data: match } = await supabase
      .from('matches')
      .select('created_by, umpire_id')
      .eq('id', id)
      .maybeSingle();
    if (!match) return res.status(404).json({ error: 'Match not found' });
    if (match.created_by !== userId && match.umpire_id !== userId) {
      return res.status(403).json({ error: 'Only the creator or umpire can add participants' });
    }
    const rows = participants.map((p: any) => ({
      match_id: id,
      user_id: p.user_id,
      team_side: p.team_side,
      role: p.role || null,
      jersey_number: p.jersey_number ?? null,
      batting_order: p.batting_order ?? null,
    }));
    const { data, error } = await supabase.from('match_participants').insert(rows).select('*');
    if (error) return res.status(500).json({ error: error.message });
    return res.json({ participants: data || [] });
  } catch (e) {
    return res.status(500).json({ error: 'Internal server error' });
  }
}

// POST /matches/:id/umpire/self-assign
export async function selfAssignUmpire(req: Request, res: Response) {
  const userId = req.userId;
  if (!userId) return res.status(401).json({ error: 'Unauthorized' });
  try {
    const { id } = req.params;
    const { data: match } = await supabase
      .from('matches')
      .select('id, umpire_id')
      .eq('id', id)
      .maybeSingle();
    if (!match) return res.status(404).json({ error: 'Match not found' });
    if (match.umpire_id) return res.status(409).json({ error: 'Match already has an umpire' });
    const { data, error } = await supabase
      .from('matches')
      .update({ umpire_id: userId, updated_at: new Date().toISOString() })
      .eq('id', id)
      .select('*')
      .single();
    if (error) return res.status(500).json({ error: error.message });
    return res.json({ match: data });
  } catch (e) {
    return res.status(500).json({ error: 'Internal server error' });
  }
}

// DELETE /matches/:id — cancel (creator only)
export async function cancelMatch(req: Request, res: Response) {
  const userId = req.userId;
  if (!userId) return res.status(401).json({ error: 'Unauthorized' });
  try {
    const { id } = req.params;
    const { data: match } = await supabase.from('matches').select('created_by').eq('id', id).maybeSingle();
    if (!match) return res.status(404).json({ error: 'Match not found' });
    if (match.created_by !== userId) return res.status(403).json({ error: 'Only the creator can cancel' });
    const { data, error } = await supabase
      .from('matches')
      .update({ status: 'cancelled', updated_at: new Date().toISOString() })
      .eq('id', id)
      .select('*')
      .single();
    if (error) return res.status(500).json({ error: error.message });
    return res.json({ match: data });
  } catch (e) {
    return res.status(500).json({ error: 'Internal server error' });
  }
}
