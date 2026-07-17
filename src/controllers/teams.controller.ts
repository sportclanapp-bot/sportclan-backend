import { Request, Response } from 'express';
import { supabase } from '../utils/supabase';
import { resolveSportId } from '../utils/sportId';
import { parsePagination, pageMeta, isRangeError } from '../utils/pagination';
import { excludeDeletedEmbed } from '../utils/activeUser';
import { sanitizeError } from '../utils/response';
import { notifyUnlessBlocked, notifyUsers } from '../utils/notify';
import { validateSportForCreate } from '../utils/sports';
import { LIMITS, firstInvalidUrl, firstDisallowedImageUrl } from '../utils/validation';
import { blockedUserIds } from '../utils/blocks';
import { isUuid } from '../utils/uuid';
import { isTeamManager, getTeamRole } from '../utils/teamAuth';
import { computeTeamRecord } from '../utils/teamRecord';

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
    if (firstDisallowedImageUrl({ logo_url }, ['logo_url'])) {
      return res.status(400).json({ error: 'logo_url must be an uploaded image URL', code: 'INVALID_IMAGE_URL' });
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
    if (!isUuid(id)) return res.status(400).json({ error: 'Invalid team id' });
    // SC-200: embed the city so the team hero can show a real location.
    const { data: team, error } = await supabase
      .from('teams')
      .select('*, city:cities!city_id(id, name)')
      .eq('id', id)
      .maybeSingle();
    if (error || !team) return res.status(404).json({ error: 'Team not found' });
    // Flatten embedded city → flat city_name string; drop the nested object.
    (team as any).city_name = (team as any).city?.name ?? null;
    delete (team as any).city;
    // SC-107: a private team is only readable by its members.
    if (team.is_public === false) {
      const { data: membership } = await supabase
        .from('team_members')
        .select('id')
        .eq('team_id', id)
        .eq('user_id', userId)
        .maybeSingle();
      if (!membership) return res.status(403).json({ error: 'This team is private' });
    }
    // SC-79: `!inner` + filter hides soft-deleted members from the roster
    // (belt-and-suspenders alongside the delete-time captaincy transfer).
    const { data: members } = await excludeDeletedEmbed(supabase
      .from('team_members')
      .select('id, role, jersey_number, joined_at, user:user_id!inner (id, name, username, profile_picture_url)')
      .eq('team_id', id), 'user');
    // SC-293: the team's W/L record — FREE (basic info; the team-detail header
    // showed "— matches / — won" for a team that had actually played, disagreeing
    // with the premium Team Insights). Same computeTeamRecord Insights uses, so
    // header and Insights can't drift. (There is no global TEAM rank — the FE
    // keeps an honest dash for that tile rather than fabricate one.)
    (team as { record?: unknown }).record = await computeTeamRecord(id);
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
    // SC-244: validate the ids before they hit uuid-typed `.eq()` filters — a
    // non-UUID would raise 22P02 → a raw 500. Non-UUID → 400; a well-formed but
    // nonexistent user → 404. (The team_members insert would otherwise 500 on a
    // 23503 FK violation for a missing user.)
    if (!isUuid(id)) return res.status(400).json({ error: 'Invalid team id' });
    if (!isUuid(user_id)) return res.status(400).json({ error: 'Invalid user_id' });
    const { data: userRow } = await supabase.from('users').select('id').eq('id', user_id).maybeSingle();
    if (!userRow) return res.status(404).json({ error: 'User not found' });
    // SC-103: only 'player' and 'vice_captain' may be assigned here. 'captain'
    // is off-limits — captaincy transfer is a separate flow, and minting a 2nd
    // captain breaks the single-captain invariant.
    if (role !== undefined && !['player', 'vice_captain'].includes(role)) {
      return res.status(400).json({ error: "role must be 'player' or 'vice_captain'" });
    }
    // SC-267: any MANAGER (captain or co-captain) may add members — operational.
    // But minting a co-captain (vice_captain) is a CARVE-OUT: captain-only. A
    // co-captain adding a member can only add a plain player.
    const actorRole = await getTeamRole(id, userId);
    if (actorRole !== 'captain' && actorRole !== 'vice_captain') {
      return res.status(403).json({ error: 'Only the captain or a co-captain can add members' });
    }
    const assignedRole = role === 'vice_captain'
      ? (actorRole === 'captain' ? 'vice_captain' : undefined)
      : 'player';
    if (assignedRole === undefined) {
      return res.status(403).json({ error: 'Only the captain can add a co-captain' });
    }
    const { data, error } = await supabase
      .from('team_members')
      .insert({ team_id: id, user_id, role: assignedRole, jersey_number: jersey_number ?? null })
      .select('*')
      .single();
    if ((error as { code?: string } | null)?.code === '23505') {
      return res.status(409).json({ error: 'Already a member of this team', code: 'ALREADY_MEMBER' });
    }
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
    // SC-244: guard malformed ids before they hit uuid-typed filters (else 500).
    if (!isUuid(id)) return res.status(400).json({ error: 'Invalid team id' });
    if (!isUuid(targetUserId)) return res.status(400).json({ error: 'Invalid user id' });
    // SC-267: removing SOMEONE ELSE requires a manager (captain or co-captain).
    // Self-removal is always allowed (any member may leave). CARVE-OUT: a
    // co-captain may remove PLAYERS only — removing the captain or another
    // co-captain is captain-only (managing co-captains is a captain power). So
    // the gate checks the TARGET's role, not just the actor's.
    if (targetUserId !== userId) {
      const actorRole = await getTeamRole(id, userId);
      if (actorRole !== 'captain' && actorRole !== 'vice_captain') {
        return res.status(403).json({ error: 'Only the captain, a co-captain, or the member themselves can remove' });
      }
      if (actorRole === 'vice_captain') {
        const targetRole = await getTeamRole(id, targetUserId);
        if (targetRole === 'captain' || targetRole === 'vice_captain') {
          return res.status(403).json({ error: 'Only the captain can remove the captain or a co-captain' });
        }
      }
    }

    // SC-243: a captain who SELF-leaves must not strand the team without a
    // captain (headless → nobody can manage or even disband it). When the
    // leaver is the captain and other members remain, hand captaincy to the
    // longest-tenured remaining member via the atomic transfer_team_captaincy
    // RPC (migration 037) FIRST, THEN remove the (now-demoted) ex-captain.
    // Ordering is the atomicity guarantee: captaincy has already moved before
    // the ex-captain row is deleted, so the dangerous half-apply (captain
    // removed + zero captains) is impossible. The only non-atomic gap —
    // transfer succeeds, delete fails — leaves a valid, captained team (the
    // ex-captain is a player again), which is recoverable, never orphaned.
    // A captain who is the LAST member disbands the team if it's clean (no
    // matches/tournament entries), mirroring disbandTeam's orphan guard.
    if (targetUserId === userId && (await isCaptain(id, userId))) {
      // SC-267: prefer a co-captain (vice_captain) as heir, then the oldest
      // member — aligning this JS self-leave path with RPCs 037/046, which
      // already prefer vice_captain. Before SC-267 this picked oldest-only, so
      // the successor differed by HOW the captain departed (self-leave vs
      // account-delete). Now consistent: the co-captain inherits either way.
      const { data: others } = await supabase
        .from('team_members')
        .select('user_id, role, joined_at')
        .eq('team_id', id)
        .neq('user_id', userId)
        .order('joined_at', { ascending: true, nullsFirst: true })
        .order('user_id', { ascending: true });
      const list = others ?? [];
      const heir = (list.find((m) => m.role === 'vice_captain')?.user_id
        ?? list[0]?.user_id) as string | undefined;
      if (heir) {
        const { error: tErr } = await supabase.rpc('transfer_team_captaincy', {
          p_team_id: id,
          p_actor_id: userId,
          p_target_id: heir,
        });
        if (tErr) return res.status(400).json({ error: sanitizeError(tErr) });
        const { error: dErr } = await supabase
          .from('team_members')
          .delete()
          .eq('team_id', id)
          .eq('user_id', userId);
        if (dErr) return res.status(500).json({ error: sanitizeError(dErr) });
        return res.json({ removed: true, captaincy_transferred_to: heir });
      }
      // Last member leaving → remove them, then disband if the team has no
      // match history or tournament entries (same guard as disbandTeam). If it
      // does, keep the now-memberless team as a historical record (there is no
      // one left to strand, so this is safe).
      const { error: dErr } = await supabase
        .from('team_members')
        .delete()
        .eq('team_id', id)
        .eq('user_id', userId);
      if (dErr) return res.status(500).json({ error: sanitizeError(dErr) });
      const { count: matchCount } = await supabase
        .from('matches')
        .select('id', { count: 'exact', head: true })
        .or(`team_a_id.eq.${id},team_b_id.eq.${id}`);
      const { count: entryCount } = await supabase
        .from('tournament_entries')
        .select('id', { count: 'exact', head: true })
        .eq('team_id', id);
      if ((matchCount ?? 0) === 0 && (entryCount ?? 0) === 0) {
        await supabase.from('team_expenses').delete().eq('team_id', id);
        await supabase.from('teams').delete().eq('id', id);
        return res.json({ removed: true, team_disbanded: true });
      }
      return res.json({ removed: true, team_empty: true });
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

// PATCH /teams/:id/members/:userId/role — captaincy transfer + co-captain manage.
// Three transitions (SC-267):
//   role='captain'      → transfer captaincy (Option A) — captain-only, atomic RPC
//                         (migration 037; single-statement promote+demote so the
//                         one-captain invariant is never observably broken).
//   role='vice_captain' → promote a player to co-captain — CARVE-OUT, captain-only.
//   role='player'       → demote a co-captain — captain-only, OR a co-captain
//                         stepping down (self). The captain can't be demoted here.
export async function updateMemberRole(req: Request, res: Response) {
  const userId = req.userId;
  if (!userId) return res.status(401).json({ error: 'Unauthorized' });
  try {
    const id = String(req.params.id);
    const targetUserId = String(req.params.userId);
    const { role } = req.body || {};
    if (!isUuid(id)) return res.status(400).json({ error: 'Invalid team id' });
    if (!isUuid(targetUserId)) return res.status(400).json({ error: 'Invalid user id' });
    if (!['captain', 'vice_captain', 'player'].includes(role)) {
      return res.status(400).json({ error: "role must be 'captain', 'vice_captain', or 'player'" });
    }

    const [actorRole, targetRole] = await Promise.all([
      getTeamRole(id, userId),
      getTeamRole(id, targetUserId),
    ]);
    if (targetRole === null) return res.status(404).json({ error: 'Member not found on this team' });

    // ── Transfer captaincy — captain-only, atomic RPC. ──
    if (role === 'captain') {
      if (targetUserId === userId) return res.status(400).json({ error: 'You are already the captain' });
      if (actorRole !== 'captain') return res.status(403).json({ error: 'Only the captain can transfer captaincy' });
      const { error } = await supabase.rpc('transfer_team_captaincy', {
        p_team_id: id, p_actor_id: userId, p_target_id: targetUserId,
      });
      if (error) return res.status(400).json({ error: sanitizeError(error) });
      return res.json({ success: true });
    }

    // ── Promote to co-captain — CARVE-OUT: captain-only. ──
    if (role === 'vice_captain') {
      if (actorRole !== 'captain') return res.status(403).json({ error: 'Only the captain can add a co-captain' });
      if (targetRole === 'captain') return res.status(400).json({ error: 'That member is the captain' });
      if (targetRole === 'vice_captain') return res.status(409).json({ error: 'Already a co-captain' });
      const { error } = await supabase
        .from('team_members').update({ role: 'vice_captain' }).eq('team_id', id).eq('user_id', targetUserId);
      if (error) return res.status(500).json({ error: sanitizeError(error) });
      // Notify the new co-captain — ungated responsibility (sibling of added_to_team).
      try {
        const { data: team } = await supabase.from('teams').select('name').eq('id', id).maybeSingle();
        void notifyUsers([targetUserId], {
          type: 'added_as_co_captain',
          title: 'You’re a co-captain',
          body: `You were made a co-captain of ${team?.name ?? 'a team'}.`,
          data: { teamId: id },
        }, { actorId: userId });
      } catch { /* best-effort */ }
      return res.json({ success: true });
    }

    // ── Demote to player — captain-only, OR a co-captain stepping down (self). ──
    if (targetRole === 'captain') {
      return res.status(400).json({ error: 'Transfer captaincy first — the captain can’t be demoted directly.' });
    }
    const isSelfStepDown = targetUserId === userId && actorRole === 'vice_captain';
    if (actorRole !== 'captain' && !isSelfStepDown) {
      return res.status(403).json({ error: 'Only the captain can demote a co-captain' });
    }
    if (targetRole === 'player') return res.json({ success: true }); // already a player — idempotent
    const { error } = await supabase
      .from('team_members').update({ role: 'player' }).eq('team_id', id).eq('user_id', targetUserId);
    if (error) return res.status(500).json({ error: sanitizeError(error) });
    return res.json({ success: true });
  } catch (e) {
    return res.status(500).json({ error: 'Internal server error' });
  }
}

// PATCH /teams/:id — captain OR co-captain (operational).
export async function updateTeam(req: Request, res: Response) {
  const userId = req.userId;
  if (!userId) return res.status(401).json({ error: 'Unauthorized' });
  try {
    const id = String(req.params.id);
    if (!isUuid(id)) return res.status(400).json({ error: 'Invalid team id' });
    if (!(await isTeamManager(id, userId))) {
      return res.status(403).json({ error: 'Only the captain or a co-captain can update the team' });
    }
    const allowed: Record<string, any> = {};
    const { name, logo_url, city_id, is_public, join_policy } = req.body || {};
    if (typeof name === 'string' && name.length > LIMITS.teamNameMax) {
      return res.status(400).json({ error: `Team name must be ${LIMITS.teamNameMax} characters or fewer` });
    }
    if (firstDisallowedImageUrl({ logo_url }, ['logo_url'])) {
      return res.status(400).json({ error: 'logo_url must be an uploaded image URL', code: 'INVALID_IMAGE_URL' });
    }
    if (join_policy !== undefined && !['open', 'approval'].includes(join_policy)) {
      return res.status(400).json({ error: "join_policy must be 'open' or 'approval'" });
    }
    if (name !== undefined) allowed.name = name;
    if (logo_url !== undefined) allowed.logo_url = logo_url;
    if (city_id !== undefined) allowed.city_id = city_id;
    if (is_public !== undefined) allowed.is_public = is_public;
    if (join_policy !== undefined) allowed.join_policy = join_policy;
    allowed.updated_at = new Date().toISOString();
    const { data, error } = await supabase.from('teams').update(allowed).eq('id', id).select('*').single();
    if (error) return res.status(500).json({ error: sanitizeError(error) });
    return res.json({ team: data });
  } catch (e) {
    return res.status(500).json({ error: 'Internal server error' });
  }
}

// SC-267: shared join-request creation — the member-check, the block gate (both
// directions, same as instant-join), the dup-pending guard, and the 24h
// re-request cooldown after a rejection. Returns {status, body} to forward. Used
// by joinTeamByCode (approval policy) AND requestToJoin (public browse).
const REREQUEST_COOLDOWN_MS = 24 * 60 * 60 * 1000;

async function createJoinRequest(
  teamId: string,
  userId: string,
  teamName: string | null,
): Promise<{ status: number; body: any }> {
  const { data: existing } = await supabase
    .from('team_members').select('id').eq('team_id', teamId).eq('user_id', userId).maybeSingle();
  if (existing) return { status: 409, body: { error: 'Already a member of this team' } };

  // Block gate — a user blocked (either direction) with ANY current member can't
  // even request (the team chat is a shared private space). Same as instant-join.
  const blocked = await blockedUserIds(userId);
  if (blocked.size > 0) {
    const { data: members } = await supabase.from('team_members').select('user_id').eq('team_id', teamId);
    if ((members ?? []).some((m) => blocked.has(m.user_id as string))) {
      return { status: 403, body: { error: 'You can’t join this team.', code: 'BLOCKED_FROM_TEAM' } };
    }
  }

  // One row per (team,user) — re-request flips the same row back to pending.
  const { data: prior } = await supabase
    .from('team_join_requests').select('id, status, decided_at')
    .eq('team_id', teamId).eq('user_id', userId).maybeSingle();
  if (prior) {
    if (prior.status === 'pending') {
      return { status: 409, body: { error: 'You already have a pending request to join this team.' } };
    }
    if (prior.status === 'rejected' && prior.decided_at) {
      const since = Date.now() - new Date(prior.decided_at).getTime();
      if (since < REREQUEST_COOLDOWN_MS) {
        const hrs = Math.ceil((REREQUEST_COOLDOWN_MS - since) / 3600000);
        return { status: 429, body: { error: `Your last request was declined. You can request again in about ${hrs}h.`, code: 'REQUEST_COOLDOWN' } };
      }
    }
    const { error } = await supabase.from('team_join_requests')
      .update({ status: 'pending', requested_at: new Date().toISOString(), decided_by: null, decided_at: null })
      .eq('id', prior.id);
    if (error) return { status: 500, body: { error: sanitizeError(error) } };
  } else {
    const { error } = await supabase.from('team_join_requests').insert({ team_id: teamId, user_id: userId, status: 'pending' });
    if ((error as { code?: string } | null)?.code === '23505') {
      return { status: 409, body: { error: 'You already have a pending request to join this team.' } };
    }
    if (error) return { status: 500, body: { error: sanitizeError(error) } };
  }

  // Notify the managers (captain + co-captains) — ungated (actionable).
  try {
    const { data: mgrs } = await supabase
      .from('team_members').select('user_id').eq('team_id', teamId).in('role', ['captain', 'vice_captain']);
    const mgrIds = (mgrs ?? []).map((m) => m.user_id as string).filter((uid) => uid !== userId);
    if (mgrIds.length > 0) {
      const { data: requester } = await supabase.from('users').select('name').eq('id', userId).maybeSingle();
      void notifyUsers(mgrIds, {
        type: 'team_join_requested',
        title: 'New join request',
        body: `${requester?.name ?? 'Someone'} wants to join ${teamName ?? 'your team'}.`,
        data: { teamId, requesterId: userId },
      }, { actorId: userId });
    }
  } catch { /* best-effort */ }

  return { status: 200, body: { requested: true } };
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
      .select('id, name, sport_id, join_policy')
      .eq('join_code', join_code.toUpperCase())
      .maybeSingle();
    if (!team) return res.status(404).json({ error: 'Invalid team code' });

    // SC-267: 'approval' policy → the code proves the captain shared it, but a
    // manager still confirms. Route through the request flow instead of joining.
    if ((team as any).join_policy === 'approval') {
      const r = await createJoinRequest(team.id, userId, team.name);
      return res.status(r.status).json(r.body);
    }

    // 'open' policy → instant join (unchanged — the WhatsApp-code common case).
    // Check not already a member
    const { data: existing } = await supabase
      .from('team_members')
      .select('id')
      .eq('team_id', team.id)
      .eq('user_id', userId)
      .maybeSingle();
    if (existing) return res.status(400).json({ error: 'Already a member of this team' });

    // Block gate: the team chat is shared with every member, so a user blocked
    // (either direction) with ANY current member can't join — otherwise a block
    // is bypassed into a private shared space. Reuses blocks.ts.
    const blocked = await blockedUserIds(userId);
    if (blocked.size > 0) {
      const { data: members } = await supabase
        .from('team_members').select('user_id').eq('team_id', team.id);
      if ((members ?? []).some((m) => blocked.has(m.user_id as string))) {
        return res.status(403).json({ error: 'You can’t join this team.', code: 'BLOCKED_FROM_TEAM' });
      }
    }

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
    if (!isUuid(id)) return res.status(400).json({ error: 'Invalid team id' });
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

// ─── Join requests (SC-267) ───────────────────────────────────────────────────

// POST /teams/:id/join-requests — request to join a PUBLIC team by id (the
// browse companion to joinTeamByCode). Private teams aren't browsable → the code
// is required. Browsing never grants instant-join even on an 'open' team: the
// code is the shared secret that does.
export async function requestToJoin(req: Request, res: Response) {
  const userId = req.userId;
  if (!userId) return res.status(401).json({ error: 'Unauthorized' });
  try {
    const id = String(req.params.id);
    if (!isUuid(id)) return res.status(400).json({ error: 'Invalid team id' });
    const { data: team } = await supabase
      .from('teams').select('id, name, is_public').eq('id', id).maybeSingle();
    if (!team) return res.status(404).json({ error: 'Team not found' });
    if (team.is_public === false) {
      return res.status(403).json({ error: 'This team is private. Use its join code to request to join.' });
    }
    const r = await createJoinRequest(team.id, userId, team.name);
    return res.status(r.status).json(r.body);
  } catch {
    return res.status(500).json({ error: 'Internal server error' });
  }
}

// GET /teams/:id/join-requests — managers (captain or co-captain) see pending requests.
export async function listJoinRequests(req: Request, res: Response) {
  const userId = req.userId;
  if (!userId) return res.status(401).json({ error: 'Unauthorized' });
  try {
    const id = String(req.params.id);
    if (!isUuid(id)) return res.status(400).json({ error: 'Invalid team id' });
    if (!(await isTeamManager(id, userId))) {
      return res.status(403).json({ error: 'Only the captain or a co-captain can view join requests' });
    }
    const { data } = await excludeDeletedEmbed(supabase
      .from('team_join_requests')
      .select('id, user_id, status, requested_at, user:user_id!inner (id, name, username, profile_picture_url)')
      .eq('team_id', id)
      .eq('status', 'pending')
      .order('requested_at', { ascending: true }), 'user');
    return res.json({ requests: data ?? [] });
  } catch {
    return res.status(500).json({ error: 'Internal server error' });
  }
}

// PATCH /teams/:id/join-requests/:userId  { status: 'approved' | 'rejected' } — manager decides.
export async function decideJoinRequest(req: Request, res: Response) {
  const userId = req.userId;
  if (!userId) return res.status(401).json({ error: 'Unauthorized' });
  try {
    const id = String(req.params.id);
    const targetUserId = String(req.params.userId);
    const { status } = req.body || {};
    if (!isUuid(id)) return res.status(400).json({ error: 'Invalid team id' });
    if (!isUuid(targetUserId)) return res.status(400).json({ error: 'Invalid user id' });
    if (!['approved', 'rejected'].includes(status)) {
      return res.status(400).json({ error: "status must be 'approved' or 'rejected'" });
    }
    if (!(await isTeamManager(id, userId))) {
      return res.status(403).json({ error: 'Only the captain or a co-captain can decide join requests' });
    }
    const { data: reqRow } = await supabase
      .from('team_join_requests').select('id, status')
      .eq('team_id', id).eq('user_id', targetUserId).maybeSingle();
    if (!reqRow || reqRow.status !== 'pending') {
      return res.status(404).json({ error: 'No pending request from this user' });
    }

    if (status === 'approved') {
      // Re-check the block gate — a block may have landed BETWEEN request and
      // approve (the both-ends gate). Same semantics as instant-join.
      const blocked = await blockedUserIds(targetUserId);
      if (blocked.size > 0) {
        const { data: members } = await supabase.from('team_members').select('user_id').eq('team_id', id);
        if ((members ?? []).some((m) => blocked.has(m.user_id as string))) {
          return res.status(403).json({ error: 'This user can’t join — a block exists with a team member.', code: 'BLOCKED_FROM_TEAM' });
        }
      }
      // Insert the member (reuse joinTeamByCode's 23505 race guard — an idempotent
      // already-member is fine, not a 500).
      const { error: insErr } = await supabase
        .from('team_members').insert({ team_id: id, user_id: targetUserId, role: 'player' });
      if (insErr && (insErr as { code?: string }).code !== '23505') {
        return res.status(500).json({ error: sanitizeError(insErr) });
      }
    }

    await supabase.from('team_join_requests')
      .update({ status, decided_by: userId, decided_at: new Date().toISOString() })
      .eq('id', reqRow.id);

    // Notify the requester — ungated.
    try {
      const { data: team } = await supabase.from('teams').select('name').eq('id', id).maybeSingle();
      void notifyUsers([targetUserId], {
        type: status === 'approved' ? 'team_join_approved' : 'team_join_rejected',
        title: status === 'approved' ? 'Request approved' : 'Request declined',
        body: status === 'approved'
          ? `You’re now a member of ${team?.name ?? 'the team'}.`
          : `Your request to join ${team?.name ?? 'the team'} was declined.`,
        data: { teamId: id },
      }, { actorId: userId });
    } catch { /* best-effort */ }

    return res.json({ success: true });
  } catch {
    return res.status(500).json({ error: 'Internal server error' });
  }
}

// DELETE /teams/:id/join-requests/me — the requester withdraws their pending request.
export async function withdrawJoinRequest(req: Request, res: Response) {
  const userId = req.userId;
  if (!userId) return res.status(401).json({ error: 'Unauthorized' });
  try {
    const id = String(req.params.id);
    if (!isUuid(id)) return res.status(400).json({ error: 'Invalid team id' });
    const { data: reqRow } = await supabase
      .from('team_join_requests').select('id, status')
      .eq('team_id', id).eq('user_id', userId).maybeSingle();
    if (!reqRow || reqRow.status !== 'pending') {
      return res.status(404).json({ error: 'No pending request to withdraw' });
    }
    await supabase.from('team_join_requests')
      .update({ status: 'withdrawn', decided_at: new Date().toISOString() })
      .eq('id', reqRow.id);
    return res.json({ success: true });
  } catch {
    return res.status(500).json({ error: 'Internal server error' });
  }
}
