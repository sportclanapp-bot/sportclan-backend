import { Request, Response } from 'express';
import { supabase } from '../utils/supabase';
import { resolveSportId } from '../utils/sportId';
import { parsePagination, pageMeta, isRangeError } from '../utils/pagination';
import { excludeDeletedEmbed } from '../utils/activeUser';
import { sanitizeError } from '../utils/response';
import { notifyUnlessBlocked } from '../utils/notify';
import { validateSportForCreate } from '../utils/sports';
import { LIMITS } from '../utils/validation';

function generateJoinCode(): string {
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  let out = '';
  for (let i = 0; i < 6; i++) out += chars[Math.floor(Math.random() * chars.length)];
  return out;
}

// POST /teams — create a team. FREE for all users (Change #6).
export async function createTeam(req: Request, res: Response) {
  const userId = req.userId;
  if (!userId) return res.status(401).json({ error: 'Unauthorized' });
  try {
    const { sport_id, name, logo_url, city_id } = req.body || {};
    if (!sport_id || !name) {
      return res.status(400).json({ error: 'sport_id and name are required' });
    }
    if (String(name).length > LIMITS.teamNameMax) {
      return res.status(400).json({ error: `Team name must be ${LIMITS.teamNameMax} characters or fewer` });
    }
    // Validate the sport (unknown/malformed/deactivated → clean 400, not a 500).
    const sportErr = await validateSportForCreate(sport_id);
    if (sportErr) return res.status(400).json({ error: sportErr });
    // Generate a unique join code
    let join_code = generateJoinCode();
    for (let i = 0; i < 5; i++) {
      const { data: existing } = await supabase.from('teams').select('id').eq('join_code', join_code).maybeSingle();
      if (!existing) break;
      join_code = generateJoinCode();
    }

    const { data: team, error } = await supabase
      .from('teams')
      .insert({ sport_id, name, logo_url: logo_url || null, city_id: city_id || null, created_by: userId, join_code })
      .select('*')
      .single();
    if (error || !team) return res.status(500).json({ error: sanitizeError(error) || 'Failed to create team' });

    const { error: memberErr } = await supabase
      .from('team_members')
      .insert({ team_id: team.id, user_id: userId, role: 'captain' });
    if (memberErr) {
      // best effort — return team anyway
    }
    return res.json({ team });
  } catch (e: any) {
    return res.status(500).json({ error: 'Internal server error' });
  }
}

// GET /teams
export async function listTeams(req: Request, res: Response) {
  const userId = req.userId;
  if (!userId) return res.status(401).json({ error: 'Unauthorized' });
  try {
    const { sport_id, city_id, mine, q } = req.query as Record<string, string | undefined>;

    let teamIdsFilter: string[] | null = null;
    if (mine === '1') {
      const { data: memberships } = await supabase
        .from('team_members')
        .select('team_id')
        .eq('user_id', userId);
      teamIdsFilter = (memberships || []).map((m: any) => m.team_id);
      if (teamIdsFilter.length === 0) return res.json({ teams: [] });
    }

    const resolvedSportId = await resolveSportId(sport_id);
    const p = parsePagination(req.query as Record<string, unknown>);
    let query = supabase
      .from('teams')
      .select('*', { count: 'exact' })
      .order('created_at', { ascending: false })
      .range(p.from, p.to);
    if (resolvedSportId) query = query.eq('sport_id', resolvedSportId);
    if (city_id) query = query.eq('city_id', city_id);
    if (q) query = query.ilike('name', `%${q}%`);
    if (teamIdsFilter) query = query.in('id', teamIdsFilter);

    const { data, error, count } = await query;
    if (error && !isRangeError(error)) return res.status(500).json({ error: sanitizeError(error) });
    return res.json({ teams: data || [], ...pageMeta(count, p) });
  } catch (e) {
    return res.status(500).json({ error: 'Internal server error' });
  }
}

// GET /teams/:id
export async function getTeam(req: Request, res: Response) {
  const userId = req.userId;
  if (!userId) return res.status(401).json({ error: 'Unauthorized' });
  try {
    const { id } = req.params;
    const { data: team, error } = await supabase.from('teams').select('*').eq('id', id).maybeSingle();
    if (error || !team) return res.status(404).json({ error: 'Team not found' });
    // SC-79: `!inner` + filter hides soft-deleted members from the roster
    // (belt-and-suspenders alongside the delete-time captaincy transfer).
    const { data: members } = await excludeDeletedEmbed(supabase
      .from('team_members')
      .select('id, role, jersey_number, joined_at, user:user_id!inner (id, name, username, profile_picture_url)')
      .eq('team_id', id), 'user');
    return res.json({ team, members: members || [] });
  } catch (e) {
    return res.status(500).json({ error: 'Internal server error' });
  }
}

async function isCaptain(teamId: string, userId: string): Promise<boolean> {
  const { data } = await supabase
    .from('team_members')
    .select('role')
    .eq('team_id', teamId)
    .eq('user_id', userId)
    .maybeSingle();
  return data?.role === 'captain';
}

// POST /teams/:id/members — captain only
export async function addTeamMember(req: Request, res: Response) {
  const userId = req.userId;
  if (!userId) return res.status(401).json({ error: 'Unauthorized' });
  try {
    const id = String(req.params.id);
    const { user_id, role, jersey_number } = req.body || {};
    if (!user_id) return res.status(400).json({ error: 'user_id is required' });
    if (!(await isCaptain(id, userId))) {
      return res.status(403).json({ error: 'Only the captain can add members' });
    }
    const { data, error } = await supabase
      .from('team_members')
      .insert({ team_id: id, user_id, role: role || 'player', jersey_number: jersey_number ?? null })
      .select('*')
      .single();
    if (error) return res.status(500).json({ error: sanitizeError(error) });

    // Notify the added user (consent-by-notification; they can self-leave).
    // Block-respecting, best-effort — never fail the add.
    try {
      const { data: team } = await supabase.from('teams').select('name').eq('id', id).maybeSingle();
      await notifyUnlessBlocked(userId, {
        userId: user_id,
        type: 'added_to_team',
        title: 'Added to a team',
        body: `You were added to ${team?.name ?? 'a team'}.`,
        data: { teamId: id, actorId: userId },
      });
    } catch { /* best-effort */ }
    return res.json({ member: data });
  } catch (e) {
    return res.status(500).json({ error: 'Internal server error' });
  }
}

// DELETE /teams/:id/members/:userId — captain or self
export async function removeTeamMember(req: Request, res: Response) {
  const userId = req.userId;
  if (!userId) return res.status(401).json({ error: 'Unauthorized' });
  try {
    const id = String(req.params.id);
    const targetUserId = String(req.params.userId);
    if (targetUserId !== userId && !(await isCaptain(id, userId))) {
      return res.status(403).json({ error: 'Only the captain or the member themselves can remove' });
    }
    const { error } = await supabase
      .from('team_members')
      .delete()
      .eq('team_id', id)
      .eq('user_id', targetUserId);
    if (error) return res.status(500).json({ error: sanitizeError(error) });
    return res.json({ removed: true });
  } catch (e) {
    return res.status(500).json({ error: 'Internal server error' });
  }
}

// PATCH /teams/:id/members/:userId/role — transfer captaincy (Option A).
// The only supported transition is handing captaincy to another member, which
// atomically demotes the current captain to player. The promote+demote runs in
// a single DB statement inside transfer_team_captaincy() (migration 037), so
// the "exactly one captain" invariant is never observably broken — supabase-js
// has no multi-statement transactions, hence the RPC.
export async function updateMemberRole(req: Request, res: Response) {
  const userId = req.userId;
  if (!userId) return res.status(401).json({ error: 'Unauthorized' });
  try {
    const id = String(req.params.id);
    const targetUserId = String(req.params.userId);
    const { role } = req.body || {};

    if (role !== 'captain') {
      return res.status(400).json({ error: "Only transferring the 'captain' role is supported" });
    }
    if (targetUserId === userId) {
      return res.status(400).json({ error: 'You are already the captain' });
    }
    if (!(await isCaptain(id, userId))) {
      return res.status(403).json({ error: 'Only the captain can transfer captaincy' });
    }
    // Target must be a member of this team → 404 rather than a false success.
    const { data: target } = await supabase
      .from('team_members')
      .select('user_id')
      .eq('team_id', id)
      .eq('user_id', targetUserId)
      .maybeSingle();
    if (!target) return res.status(404).json({ error: 'Member not found on this team' });

    const { error } = await supabase.rpc('transfer_team_captaincy', {
      p_team_id: id,
      p_actor_id: userId,
      p_target_id: targetUserId,
    });
    if (error) return res.status(400).json({ error: sanitizeError(error) });

    return res.json({ success: true });
  } catch (e) {
    return res.status(500).json({ error: 'Internal server error' });
  }
}

// PATCH /teams/:id — captain only
export async function updateTeam(req: Request, res: Response) {
  const userId = req.userId;
  if (!userId) return res.status(401).json({ error: 'Unauthorized' });
  try {
    const id = String(req.params.id);
    if (!(await isCaptain(id, userId))) {
      return res.status(403).json({ error: 'Only the captain can update the team' });
    }
    const allowed: Record<string, any> = {};
    const { name, logo_url, city_id, is_public } = req.body || {};
    if (name !== undefined) allowed.name = name;
    if (logo_url !== undefined) allowed.logo_url = logo_url;
    if (city_id !== undefined) allowed.city_id = city_id;
    if (is_public !== undefined) allowed.is_public = is_public;
    allowed.updated_at = new Date().toISOString();
    const { data, error } = await supabase.from('teams').update(allowed).eq('id', id).select('*').single();
    if (error) return res.status(500).json({ error: sanitizeError(error) });
    return res.json({ team: data });
  } catch (e) {
    return res.status(500).json({ error: 'Internal server error' });
  }
}

// POST /teams/join  { join_code }
export async function joinTeamByCode(req: Request, res: Response) {
  const userId = req.userId;
  if (!userId) return res.status(401).json({ error: 'Unauthorized' });
  try {
    const { join_code } = req.body || {};
    if (!join_code) return res.status(400).json({ error: 'join_code is required' });
    const { data: team } = await supabase
      .from('teams')
      .select('id, name, sport_id')
      .eq('join_code', join_code.toUpperCase())
      .maybeSingle();
    if (!team) return res.status(404).json({ error: 'Invalid team code' });

    // Check not already a member
    const { data: existing } = await supabase
      .from('team_members')
      .select('id')
      .eq('team_id', team.id)
      .eq('user_id', userId)
      .maybeSingle();
    if (existing) return res.status(400).json({ error: 'Already a member of this team' });

    const { data: member, error } = await supabase
      .from('team_members')
      .insert({ team_id: team.id, user_id: userId, role: 'player' })
      .select('*')
      .single();
    // SC-64: a same-user concurrent join races past the pre-check above and both
    // inserts hit UNIQUE(team_id,user_id). The unique violation (23505) means the
    // caller is already a member — map it to a clean 409, never a raw 500. (The
    // SC-44 backstop only scrubs the 5xx *message*; it can't know a 500 here was
    // really an idempotent already-member condition, so we special-case it.)
    if ((error as { code?: string } | null)?.code === '23505') {
      return res.status(409).json({ error: 'Already a member of this team' });
    }
    if (error) return res.status(500).json({ error: sanitizeError(error) });
    return res.json({ team, member });
  } catch {
    return res.status(500).json({ error: 'Internal server error' });
  }
}

// DELETE /teams/:id — disband a team (captain only).
// Removes members + the team row. Refuses if the team has any matches or
// tournament entries tied to it, to avoid orphaning historical records.
export async function disbandTeam(req: Request, res: Response) {
  const userId = req.userId;
  if (!userId) return res.status(401).json({ error: 'Unauthorized' });
  try {
    const id = String(req.params.id);
    if (!(await isCaptain(id, userId))) {
      return res.status(403).json({ error: 'Only the captain can disband the team' });
    }

    // Block disband if the team is referenced by any match (as A or B).
    const { count: matchCount } = await supabase
      .from('matches')
      .select('id', { count: 'exact', head: true })
      .or(`team_a_id.eq.${id},team_b_id.eq.${id}`);
    if ((matchCount ?? 0) > 0) {
      return res.status(409).json({
        error: 'This team has match history and can\u2019t be disbanded. Remove it from matches first.',
      });
    }

    // Block disband if the team has tournament entries.
    const { count: entryCount } = await supabase
      .from('tournament_entries')
      .select('id', { count: 'exact', head: true })
      .eq('team_id', id);
    if ((entryCount ?? 0) > 0) {
      return res.status(409).json({
        error: 'This team is entered in a tournament and can\u2019t be disbanded yet.',
      });
    }

    // Clean up dependent rows, then the team itself.
    await supabase.from('team_members').delete().eq('team_id', id);
    await supabase.from('team_expenses').delete().eq('team_id', id);
    const { error } = await supabase.from('teams').delete().eq('id', id);
    if (error) return res.status(500).json({ error: sanitizeError(error) });
    return res.json({ success: true });
  } catch {
    return res.status(500).json({ error: 'Internal server error' });
  }
}
