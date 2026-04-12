import { Request, Response } from 'express';
import { supabase } from '../utils/supabase';
import { resolveSportId } from '../utils/sportId';

function generateEntryCode(): string {
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  let out = '';
  for (let i = 0; i < 6; i++) out += chars[Math.floor(Math.random() * chars.length)];
  return out;
}

// POST /tournaments — Premium required (Change #6)
export async function createTournament(req: Request, res: Response) {
  const userId = req.userId;
  if (!userId) return res.status(401).json({ error: 'Unauthorized' });
  try {
    const { data: user } = await supabase
      .from('users')
      .select('is_premium, premium_expires_at')
      .eq('id', userId)
      .maybeSingle();
    const premiumActive =
      user?.is_premium &&
      (!user.premium_expires_at || new Date(user.premium_expires_at).getTime() > Date.now());
    if (!premiumActive) {
      return res.status(403).json({
        error: 'Premium subscription required to create tournaments',
        code: 'PREMIUM_REQUIRED',
      });
    }

    const {
      sport_id,
      name,
      description,
      format,
      city_id,
      venue,
      start_date,
      end_date,
      entry_fee,
      max_teams,
      prize_pool,
      banner_url,
      tiebreaker_rules,
      sport_metadata,
    } = req.body || {};
    if (!sport_id || !name || !format) {
      return res.status(400).json({ error: 'sport_id, name, format are required' });
    }
    // Whitelist only string values in sport_metadata to avoid arbitrary
    // shape injection. Empty strings and __custom__ sentinel are dropped.
    const metadata: Record<string, string> = {};
    if (sport_metadata && typeof sport_metadata === 'object') {
      for (const [k, v] of Object.entries(sport_metadata)) {
        if (typeof v === 'string' && v && v !== '__custom__') {
          metadata[k] = v;
        }
      }
    }

    // Generate unique entry code (retry a few times on collision)
    let entry_code = generateEntryCode();
    for (let i = 0; i < 5; i++) {
      const { data: existing } = await supabase
        .from('tournaments')
        .select('id')
        .eq('entry_code', entry_code)
        .maybeSingle();
      if (!existing) break;
      entry_code = generateEntryCode();
    }

    const { data: tournament, error } = await supabase
      .from('tournaments')
      .insert({
        sport_id,
        name,
        description: description || null,
        format,
        city_id: city_id || null,
        venue: venue || null,
        start_date: start_date || null,
        end_date: end_date || null,
        entry_fee: entry_fee ?? 0,
        max_teams: max_teams ?? null,
        prize_pool: prize_pool ?? null,
        banner_url: banner_url || null,
        entry_code,
        created_by: userId,
        tiebreaker_rules: tiebreaker_rules ?? [],
        sport_metadata: metadata,
      })
      .select('*')
      .single();
    if (error || !tournament) return res.status(500).json({ error: error?.message || 'Failed to create tournament' });
    return res.json({ tournament });
  } catch (e) {
    return res.status(500).json({ error: 'Internal server error' });
  }
}

// GET /tournaments
export async function listTournaments(req: Request, res: Response) {
  const userId = req.userId;
  if (!userId) return res.status(401).json({ error: 'Unauthorized' });
  try {
    const { sport_id, city_id, status, mine } = req.query as Record<string, string | undefined>;
    const resolvedSportId = await resolveSportId(sport_id);
    let query = supabase.from('tournaments').select('*').order('created_at', { ascending: false }).limit(100);
    if (resolvedSportId) query = query.eq('sport_id', resolvedSportId);
    if (city_id) query = query.eq('city_id', city_id);
    if (status) query = query.eq('status', status);
    if (mine === '1') query = query.eq('created_by', userId);
    const { data, error } = await query;
    if (error) return res.status(500).json({ error: error.message });
    return res.json({ tournaments: data || [] });
  } catch (e) {
    return res.status(500).json({ error: 'Internal server error' });
  }
}

// GET /tournaments/:id
export async function getTournament(req: Request, res: Response) {
  const userId = req.userId;
  if (!userId) return res.status(401).json({ error: 'Unauthorized' });
  try {
    const { id } = req.params;
    const { data: tournament, error } = await supabase
      .from('tournaments')
      .select('*')
      .eq('id', id)
      .maybeSingle();
    if (error || !tournament) return res.status(404).json({ error: 'Tournament not found' });
    const { data: entries } = await supabase
      .from('tournament_entries')
      .select('id, status, seed, group_label, entered_at, team:team_id (id, name, logo_url, sport_id)')
      .eq('tournament_id', id);
    return res.json({ tournament, entries: entries || [] });
  } catch (e) {
    return res.status(500).json({ error: 'Internal server error' });
  }
}

// POST /tournaments/:id/entries — captain enters their team
export async function createEntry(req: Request, res: Response) {
  const userId = req.userId;
  if (!userId) return res.status(401).json({ error: 'Unauthorized' });
  try {
    const { id } = req.params;
    const { team_id } = req.body || {};
    if (!team_id) return res.status(400).json({ error: 'team_id is required' });
    const { data: membership } = await supabase
      .from('team_members')
      .select('role')
      .eq('team_id', team_id)
      .eq('user_id', userId)
      .maybeSingle();
    if (membership?.role !== 'captain') {
      return res.status(403).json({ error: 'Only the team captain can enter a tournament' });
    }
    const { data, error } = await supabase
      .from('tournament_entries')
      .insert({ tournament_id: id, team_id, status: 'pending' })
      .select('*')
      .single();
    if (error) return res.status(500).json({ error: error.message });
    return res.json({ entry: data });
  } catch (e) {
    return res.status(500).json({ error: 'Internal server error' });
  }
}

// PATCH /tournaments/:id/entries/:entryId
export async function updateEntry(req: Request, res: Response) {
  const userId = req.userId;
  if (!userId) return res.status(401).json({ error: 'Unauthorized' });
  try {
    const { id, entryId } = req.params;
    const { status, seed, group_label } = req.body || {};
    if (status && !['pending', 'approved', 'rejected', 'withdrawn'].includes(status)) {
      return res.status(400).json({ error: 'Invalid status' });
    }
    const { data: entry } = await supabase
      .from('tournament_entries')
      .select('id, tournament_id, team_id')
      .eq('id', entryId)
      .eq('tournament_id', id)
      .maybeSingle();
    if (!entry) return res.status(404).json({ error: 'Entry not found' });

    const { data: tournament } = await supabase
      .from('tournaments')
      .select('created_by')
      .eq('id', id)
      .maybeSingle();
    if (!tournament) return res.status(404).json({ error: 'Tournament not found' });

    const isCreator = tournament.created_by === userId;
    const { data: membership } = await supabase
      .from('team_members')
      .select('role')
      .eq('team_id', entry.team_id)
      .eq('user_id', userId)
      .maybeSingle();
    const isTeamCaptain = membership?.role === 'captain';

    if (status === 'approved' || status === 'rejected') {
      if (!isCreator) return res.status(403).json({ error: 'Only the tournament creator can approve/reject' });
    } else if (status === 'withdrawn') {
      if (!isTeamCaptain) return res.status(403).json({ error: 'Only the team captain can withdraw' });
    } else {
      if (!isCreator) return res.status(403).json({ error: 'Forbidden' });
    }

    const update: Record<string, any> = {};
    if (status !== undefined) update.status = status;
    if (seed !== undefined) update.seed = seed;
    if (group_label !== undefined) update.group_label = group_label;

    const { data, error } = await supabase
      .from('tournament_entries')
      .update(update)
      .eq('id', entryId)
      .select('*')
      .single();
    if (error) return res.status(500).json({ error: error.message });
    return res.json({ entry: data });
  } catch (e) {
    return res.status(500).json({ error: 'Internal server error' });
  }
}

// PATCH /tournaments/:id — creator only
export async function updateTournament(req: Request, res: Response) {
  const userId = req.userId;
  if (!userId) return res.status(401).json({ error: 'Unauthorized' });
  try {
    const { id } = req.params;
    const { data: tournament } = await supabase
      .from('tournaments')
      .select('created_by')
      .eq('id', id)
      .maybeSingle();
    if (!tournament) return res.status(404).json({ error: 'Tournament not found' });
    if (tournament.created_by !== userId) return res.status(403).json({ error: 'Only the creator can update' });

    const allowedKeys = [
      'name',
      'description',
      'format',
      'city_id',
      'venue',
      'start_date',
      'end_date',
      'entry_fee',
      'max_teams',
      'prize_pool',
      'banner_url',
      'status',
      'tiebreaker_rules',
    ];
    const update: Record<string, any> = {};
    for (const key of allowedKeys) {
      if (req.body && key in req.body) update[key] = req.body[key];
    }
    update.updated_at = new Date().toISOString();
    const { data, error } = await supabase
      .from('tournaments')
      .update(update)
      .eq('id', id)
      .select('*')
      .single();
    if (error) return res.status(500).json({ error: error.message });
    return res.json({ tournament: data });
  } catch (e) {
    return res.status(500).json({ error: 'Internal server error' });
  }
}

// GET /tournaments/:id/bracket — returns the knockout bracket grouped
// into named rounds. Infers the round-count from the total match count:
//   8 matches → Round of 16 → QF → SF → F (if we ever get there)
//   7 matches → QF (4) → SF (2) → F (1)
//   3 matches → SF (2) → F (1)
//   1 match  → F (1)
// Ordering within a round uses scheduled_at.
export async function getBracket(req: Request, res: Response) {
  const userId = req.userId;
  if (!userId) return res.status(401).json({ error: 'Unauthorized' });
  try {
    const { id } = req.params;
    const { data: tournament } = await supabase
      .from('tournaments')
      .select('id, name, format')
      .eq('id', id)
      .maybeSingle();
    if (!tournament) return res.status(404).json({ error: 'Tournament not found' });

    const { data: matches, error } = await supabase
      .from('matches')
      .select('id, team_a_name, team_b_name, team_a_id, team_b_id, score_summary, status, winner_team_id, scheduled_at')
      .eq('tournament_id', id)
      .order('scheduled_at', { ascending: true });
    if (error) return res.status(500).json({ error: error.message });

    // Infer round structure. We walk the match list in chronological order
    // and split into standard knockout round sizes (1 final, 2 semis, 4 QFs
    // etc). Anything that doesn't fit falls into a final "Round 1" bucket.
    const total = matches?.length ?? 0;
    const roundSizes: Array<{ name: string; size: number }> = [];
    if (total >= 8) roundSizes.push({ name: 'Quarter-Finals', size: 4 });
    if (total >= 3) roundSizes.push({ name: 'Semi-Finals', size: 2 });
    if (total >= 1) roundSizes.push({ name: 'Final', size: 1 });

    // Matches come in chronologically: earliest rounds first. Pop from the
    // *end* of roundSizes to build earliest→latest.
    const rounds: Array<{ name: string; matches: any[] }> = [];
    const reversedSizes = [...roundSizes].reverse();
    let cursor = 0;
    for (const r of reversedSizes) {
      const slice = (matches ?? []).slice(cursor, cursor + r.size);
      cursor += r.size;
      rounds.push({
        name: r.name,
        matches: slice.map((m) => {
          const ss: any = m.score_summary ?? {};
          return {
            id: m.id,
            team_a_name: m.team_a_name,
            team_b_name: m.team_b_name,
            score_a: ss.team_a_score ?? null,
            score_b: ss.team_b_score ?? null,
            winner_team_id: m.winner_team_id,
            status: m.status,
          };
        }),
      });
    }

    return res.json({ tournament, rounds });
  } catch (e) {
    return res.status(500).json({ error: 'Internal server error' });
  }
}

// POST /tournaments/join  { entry_code, team_id }
export async function joinByCode(req: Request, res: Response) {
  const userId = req.userId;
  if (!userId) return res.status(401).json({ error: 'Unauthorized' });
  try {
    const { entry_code, team_id } = req.body || {};
    if (!entry_code || !team_id) return res.status(400).json({ error: 'entry_code and team_id are required' });
    const { data: tournament } = await supabase
      .from('tournaments')
      .select('id')
      .eq('entry_code', entry_code)
      .maybeSingle();
    if (!tournament) return res.status(404).json({ error: 'Invalid entry code' });
    const { data: membership } = await supabase
      .from('team_members')
      .select('role')
      .eq('team_id', team_id)
      .eq('user_id', userId)
      .maybeSingle();
    if (membership?.role !== 'captain') {
      return res.status(403).json({ error: 'Only the team captain can enter a tournament' });
    }
    const { data, error } = await supabase
      .from('tournament_entries')
      .insert({ tournament_id: tournament.id, team_id, status: 'pending' })
      .select('*')
      .single();
    if (error) return res.status(500).json({ error: error.message });
    return res.json({ entry: data, tournament_id: tournament.id });
  } catch (e) {
    return res.status(500).json({ error: 'Internal server error' });
  }
}

// PATCH /tournaments/:id/fixtures — bulk-update scheduled match times.
// Only the tournament creator can modify, and only scheduled matches.
export async function updateFixtures(req: Request, res: Response) {
  const userId = req.userId;
  if (!userId) return res.status(401).json({ error: 'Unauthorized' });
  try {
    const { id } = req.params;
    const { matches: updates } = req.body || {};
    if (!Array.isArray(updates) || updates.length === 0) {
      return res.status(400).json({ error: 'matches array is required' });
    }

    const { data: tournament } = await supabase
      .from('tournaments')
      .select('created_by')
      .eq('id', id)
      .maybeSingle();
    if (!tournament) return res.status(404).json({ error: 'Tournament not found' });
    if (tournament.created_by !== userId) {
      return res.status(403).json({ error: 'Only the creator can update fixtures' });
    }

    const results: any[] = [];
    for (const upd of updates) {
      if (!upd.id) continue;
      const patch: Record<string, any> = {};
      if (upd.scheduled_at) patch.scheduled_at = upd.scheduled_at;
      if (upd.venue) patch.venue = upd.venue;
      if (upd.team_a_id) patch.team_a_id = upd.team_a_id;
      if (upd.team_b_id) patch.team_b_id = upd.team_b_id;
      if (upd.team_a_name) patch.team_a_name = upd.team_a_name;
      if (upd.team_b_name) patch.team_b_name = upd.team_b_name;
      if (Object.keys(patch).length === 0) continue;

      const { data, error } = await supabase
        .from('matches')
        .update(patch)
        .eq('id', upd.id)
        .eq('tournament_id', id)
        .eq('status', 'scheduled')
        .select('*')
        .single();
      if (!error && data) results.push(data);
    }

    return res.json({ updated: results.length, fixtures: results });
  } catch {
    return res.status(500).json({ error: 'Internal server error' });
  }
}
