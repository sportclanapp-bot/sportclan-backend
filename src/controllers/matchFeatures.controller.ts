import { Request, Response } from 'express';
import { supabase } from '../utils/supabase';
import { sanitizeError } from '../utils/response';
import { calculateDLSTarget } from '../utils/dls';

// ────────────────────────────────────────────────────────────────────────────
// FEATURE 1 — MVP / Player of the Match
// ────────────────────────────────────────────────────────────────────────────

export async function calculateAndSetMVP(matchId: string): Promise<string | null> {
  // Get match events and participants
  const { data: events } = await supabase
    .from('match_events')
    .select('payload, created_by')
    .eq('match_id', matchId);
  const { data: participants } = await supabase
    .from('match_participants')
    .select('user_id')
    .eq('match_id', matchId);

  if (!events?.length || !participants?.length) return null;

  // Score each participant based on events
  const scores = new Map<string, number>();
  for (const p of participants) scores.set(p.user_id, 0);

  for (const ev of events) {
    const payload: any = ev.payload ?? {};
    const userId = ev.created_by;
    if (!userId || !scores.has(userId)) continue;
    const current = scores.get(userId) ?? 0;
    const runs = payload.runs ?? 0;
    const wicket = payload.wicket ? 25 : 0;
    scores.set(userId, current + runs + wicket);
  }

  // Find top scorer
  let mvpId: string | null = null;
  let maxScore = 0;
  for (const [uid, score] of scores) {
    if (score > maxScore) { maxScore = score; mvpId = uid; }
  }

  if (mvpId) {
    await supabase.from('matches').update({ mvp_user_id: mvpId }).eq('id', matchId);
  }
  return mvpId;
}

export async function getMatchMVP(req: Request, res: Response) {
  try {
    const { id } = req.params;
    const { data: match } = await supabase
      .from('matches')
      .select('mvp_user_id')
      .eq('id', id)
      .maybeSingle();
    if (!match?.mvp_user_id) return res.json({ mvp: null });

    const { data: user } = await supabase
      .from('users')
      .select('id, name, username, profile_picture_url, is_premium')
      .eq('id', match.mvp_user_id)
      .maybeSingle();
    return res.json({ mvp: user });
  } catch {
    return res.status(500).json({ error: 'Internal server error' });
  }
}

// ────────────────────────────────────────────────────────────────────────────
// FEATURE 3 — Squad Availability
// ────────────────────────────────────────────────────────────────────────────

export async function getMatchAvailability(req: Request, res: Response) {
  try {
    const { id } = req.params;
    const { data, error } = await supabase
      .from('match_availability')
      .select('id, user_id, team_id, status, user:users!user_id(id, name, profile_picture_url)')
      .eq('match_id', id);
    if (error) return res.status(500).json({ error: sanitizeError(error) });
    return res.json({ availability: data ?? [] });
  } catch {
    return res.status(500).json({ error: 'Internal server error' });
  }
}

export async function setMatchAvailability(req: Request, res: Response) {
  const userId = req.userId;
  if (!userId) return res.status(401).json({ error: 'Unauthorized' });
  try {
    const { id } = req.params;
    const { status, team_id } = req.body || {};
    if (!status || !['available', 'unavailable', 'maybe'].includes(status)) {
      return res.status(400).json({ error: 'status must be available, unavailable, or maybe' });
    }

    const { data, error } = await supabase
      .from('match_availability')
      .upsert(
        { match_id: id, user_id: userId, team_id: team_id ?? null, status, updated_at: new Date().toISOString() },
        { onConflict: 'match_id,user_id' },
      )
      .select('*')
      .single();
    if (error) return res.status(500).json({ error: sanitizeError(error) });
    return res.json({ availability: data });
  } catch {
    return res.status(500).json({ error: 'Internal server error' });
  }
}

// ────────────────────────────────────────────────────────────────────────────
// FEATURE 5 — DLS Method
// ────────────────────────────────────────────────────────────────────────────

export async function applyDLS(req: Request, res: Response) {
  const userId = req.userId;
  if (!userId) return res.status(401).json({ error: 'Unauthorized' });
  try {
    const { id } = req.params;
    const { team1_score, total_overs, team2_overs_remaining, team2_wickets } = req.body || {};

    if (team1_score == null || total_overs == null || team2_overs_remaining == null || team2_wickets == null) {
      return res.status(400).json({ error: 'team1_score, total_overs, team2_overs_remaining, team2_wickets required' });
    }

    const result = calculateDLSTarget(
      Number(team1_score),
      Number(total_overs),
      Number(team2_overs_remaining),
      Number(team2_wickets),
    );

    // Store in match score_summary
    const { data: match } = await supabase
      .from('matches')
      .select('score_summary')
      .eq('id', id)
      .maybeSingle();
    const ss = (match?.score_summary ?? {}) as Record<string, unknown>;
    ss.dls_target = result.revisedTarget;
    ss.dls_applied = true;
    ss.dls_resources = { team1: result.resourcesTeam1, team2: result.resourcesTeam2 };

    await supabase.from('matches').update({ score_summary: ss }).eq('id', id);

    return res.json(result);
  } catch {
    return res.status(500).json({ error: 'Internal server error' });
  }
}

// ────────────────────────────────────────────────────────────────────────────
// FEATURE 6 — Live Match Edit
// ────────────────────────────────────────────────────────────────────────────

export async function editMatchEvent(req: Request, res: Response) {
  const userId = req.userId;
  if (!userId) return res.status(401).json({ error: 'Unauthorized' });
  try {
    const { id } = req.params;
    const { event_id, changes } = req.body || {};
    if (!event_id || !changes) return res.status(400).json({ error: 'event_id and changes required' });

    // Verify scorer/umpire/creator
    const { data: match } = await supabase
      .from('matches')
      .select('created_by, umpire_id')
      .eq('id', id)
      .maybeSingle();
    if (!match) return res.status(404).json({ error: 'Match not found' });
    if (match.created_by !== userId && match.umpire_id !== userId) {
      return res.status(403).json({ error: 'Only scorer or umpire can edit events' });
    }

    // Get current event
    const { data: event } = await supabase
      .from('match_events')
      .select('id, payload')
      .eq('id', event_id)
      .eq('match_id', id)
      .maybeSingle();
    if (!event) return res.status(404).json({ error: 'Event not found' });

    const oldPayload = event.payload ?? {};
    const newPayload = { ...oldPayload, ...changes };

    // Audit log
    await supabase.from('match_event_audit').insert({
      event_id, match_id: id, changed_by: userId,
      old_payload: oldPayload, new_payload: newPayload, action: 'edit',
    });

    // Update event
    await supabase.from('match_events').update({ payload: newPayload }).eq('id', event_id);

    return res.json({ success: true, event: { id: event_id, payload: newPayload } });
  } catch {
    return res.status(500).json({ error: 'Internal server error' });
  }
}

export async function deleteMatchEvent(req: Request, res: Response) {
  const userId = req.userId;
  if (!userId) return res.status(401).json({ error: 'Unauthorized' });
  try {
    const { id, eventId } = req.params;

    const { data: match } = await supabase
      .from('matches')
      .select('created_by, umpire_id')
      .eq('id', id)
      .maybeSingle();
    if (!match) return res.status(404).json({ error: 'Match not found' });
    if (match.created_by !== userId && match.umpire_id !== userId) {
      return res.status(403).json({ error: 'Only scorer or umpire can delete events' });
    }

    // Get event for audit
    const { data: event } = await supabase
      .from('match_events')
      .select('id, payload')
      .eq('id', eventId)
      .eq('match_id', id)
      .maybeSingle();
    if (!event) return res.status(404).json({ error: 'Event not found' });

    // Audit log
    await supabase.from('match_event_audit').insert({
      event_id: eventId, match_id: id, changed_by: userId,
      old_payload: event.payload ?? {}, new_payload: {}, action: 'delete',
    });

    // Delete
    await supabase.from('match_events').delete().eq('id', eventId);

    return res.json({ success: true });
  } catch {
    return res.status(500).json({ error: 'Internal server error' });
  }
}

// ────────────────────────────────────────────────────────────────────────────
// FEATURE 4 — AI Commentary (stub — requires ANTHROPIC_API_KEY)
// GET /matches/:id/ai-commentary
// ────────────────────────────────────────────────────────────────────────────

export async function getAICommentary(req: Request, res: Response) {
  try {
    const { id } = req.params;

    // Get recent events
    const { data: events } = await supabase
      .from('match_events')
      .select('event_type, payload, created_at')
      .eq('match_id', id)
      .order('created_at', { ascending: false })
      .limit(20);

    if (!events?.length) return res.json({ commentary: [] });

    const apiKey = process.env.ANTHROPIC_API_KEY;
    if (!apiKey) {
      // No API key — return formatted events as basic commentary
      const basic = (events ?? []).reverse().map((e: any) => {
        const p = e.payload ?? {};
        const runs = p.runs ?? 0;
        const wicket = p.wicket ? ' WICKET!' : '';
        return `Ball: ${runs} run${runs !== 1 ? 's' : ''}${wicket}`;
      });
      return res.json({ commentary: basic, aiPowered: false });
    }

    // Call Claude API
    const { data: match } = await supabase
      .from('matches')
      .select('team_a_name, team_b_name, sport_id')
      .eq('id', id)
      .maybeSingle();

    const eventsText = (events ?? []).reverse().map((e: any, i: number) => {
      const p = e.payload ?? {};
      return `Ball ${i + 1}: ${JSON.stringify(p)}`;
    }).join('\n');

    const prompt = `You are an exciting cricket commentator. Generate ball-by-ball commentary for these match events between ${match?.team_a_name ?? 'Team A'} and ${match?.team_b_name ?? 'Team B'}. Each line should be 1-2 sentences, exciting and professional like Sky Sports commentary.\n\nEvents:\n${eventsText}\n\nReturn ONLY the commentary lines, one per event, no numbering.`;

    try {
      const resp = await fetch('https://api.anthropic.com/v1/messages', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-api-key': apiKey,
          'anthropic-version': '2023-06-01',
        },
        body: JSON.stringify({
          model: 'claude-sonnet-4-20250514',
          max_tokens: 1024,
          messages: [{ role: 'user', content: prompt }],
        }),
      });
      const data = await resp.json();
      const text = (data as any)?.content?.[0]?.text ?? '';
      const lines = text.split('\n').filter((l: string) => l.trim());
      return res.json({ commentary: lines, aiPowered: true });
    } catch {
      return res.json({ commentary: [], aiPowered: false });
    }
  } catch {
    return res.status(500).json({ error: 'Internal server error' });
  }
}
