import { isPremiumActive } from '../utils/premium';
import { Request, Response } from 'express';
import { supabase } from '../utils/supabase';
import { resolveSportId } from '../utils/sportId';
import { parsePagination, pageMeta, isRangeError } from '../utils/pagination';
import { sanitizeError } from '../utils/response';
import { validateSportForCreate } from '../utils/sports';
import { isValidTournamentFormat, TOURNAMENT_FORMATS, LIMITS, firstTooLong, firstInvalidUrl, firstDisallowedImageUrl } from '../utils/validation';
import { rankTeams, computeStats } from '../utils/standings';
import {
  buildSchedule, timeToMinutes, keyOf, formatSlotIst,
  type SchedulingConfig, type FixtureShape, type SlotAssign,
} from '../utils/scheduleFixtures';
import { notifyUnlessBlocked, notifyUsers } from '../utils/notify';

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
    const premiumActive = isPremiumActive(user); // SC-144: shared live-expiry helper
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
      city,
      venue,
      start_date,
      end_date,
      entry_fee,
      max_teams,
      prize_pool,
      banner_url,
      logo_url,
      tiebreaker_rules,
      sport_metadata,
      sponsor_name,
      sponsor_logo_url,
      organiser_name,
      organiser_mobile,
      registration_deadline,
      daily_start_time,
      daily_end_time,
      match_duration_minutes,
      buffer_minutes,
      ground_count,
      ground_names,
      day_windows,
      home_away,
      num_groups,
      group_size,
      qualifiers_per_group,
    } = req.body || {};
    if (!sport_id || !name || !format) {
      return res.status(400).json({ error: 'sport_id, name, format are required' });
    }
    // SC-95/96: bound name/description; validate image URLs (were unbounded/arbitrary).
    const tLong = firstTooLong({ name, description }, [['name', LIMITS.tournamentNameMax], ['description', LIMITS.descriptionMax]]);
    if (tLong) return res.status(400).json({ error: `${tLong[0]} must be ${tLong[1]} characters or fewer` });
    const tBadUrl = firstDisallowedImageUrl({ banner_url, logo_url, sponsor_logo_url }, ['banner_url', 'logo_url', 'sponsor_logo_url']);
    if (tBadUrl) return res.status(400).json({ error: `${tBadUrl} must be an uploaded image URL`, code: 'INVALID_IMAGE_URL' });
    // Validate format (SC-37) — unknown enum previously 500'd on insert.
    if (!isValidTournamentFormat(format)) {
      return res.status(400).json({
        error: `Invalid format. Must be one of: ${TOURNAMENT_FORMATS.join(', ')}`,
      });
    }
    // Bound max_teams (SC-39) — 0/1/absurd values previously created degenerate
    // tournaments.
    const maxTeamsNum = Number(max_teams);
    if (
      !Number.isInteger(maxTeamsNum) ||
      maxTeamsNum < LIMITS.tournamentMinTeams ||
      maxTeamsNum > LIMITS.tournamentMaxTeams
    ) {
      return res.status(400).json({
        error: `max_teams must be between ${LIMITS.tournamentMinTeams} and ${LIMITS.tournamentMaxTeams}`,
      });
    }
    // Validate the sport (unknown/malformed/deactivated → clean 400, not a 500).
    const sportErr = await validateSportForCreate(sport_id);
    if (sportErr) return res.status(400).json({ error: sportErr });
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

    // SC-58: optional groups_knockout configuration (organizer-chosen group
    // count / size + qualifiers per group, incl. top-1). Validated here and only
    // persisted when provided, so the insert stays compatible even if migration
    // 038 (which adds these columns) has not been applied yet.
    const groupsConfigFields: Record<string, number> = {};
    const cfgInt = (v: unknown) => (v === undefined || v === null ? null : Number(v));
    const ng = cfgInt(num_groups);
    if (ng !== null) {
      if (!Number.isInteger(ng) || ng < 1 || ng > 64) {
        return res.status(400).json({ error: 'num_groups must be an integer between 1 and 64' });
      }
      groupsConfigFields.num_groups = ng;
    }
    const gs = cfgInt(group_size);
    if (gs !== null) {
      if (!Number.isInteger(gs) || gs < 2 || gs > 64) {
        return res.status(400).json({ error: 'group_size must be an integer between 2 and 64' });
      }
      groupsConfigFields.group_size = gs;
    }
    const qpg = cfgInt(qualifiers_per_group);
    if (qpg !== null) {
      if (!Number.isInteger(qpg) || qpg < 1 || qpg > 32) {
        return res.status(400).json({ error: 'qualifiers_per_group must be an integer between 1 and 32' });
      }
      groupsConfigFields.qualifiers_per_group = qpg;
    }
    // SC-110: for groups_knockout, qualifiers_per_group cannot exceed group_size
    // (you can't advance more teams from a group than the group contains).
    if (format === 'groups_knockout' && gs !== null && qpg !== null && qpg > gs) {
      return res.status(400).json({ error: 'qualifiers_per_group cannot exceed group_size' });
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
        city: city || null,
        venue: venue || null,
        start_date: start_date || null,
        end_date: end_date || null,
        entry_fee: entry_fee ?? 0,
        max_teams: max_teams ?? null,
        prize_pool: prize_pool ?? null,
        banner_url: banner_url || null,
        logo_url: logo_url || null,
        entry_code,
        created_by: userId,
        tiebreaker_rules: tiebreaker_rules ?? [],
        sport_metadata: metadata,
        sponsor_name: sponsor_name || null,
        sponsor_logo_url: sponsor_logo_url || null,
        organiser_name: organiser_name || null,
        organiser_mobile: organiser_mobile || null,
        registration_deadline: registration_deadline || null,
        // Scheduling (feature): daily window + grounds + duration drive fixture
        // slotting at generate time. All optional — absent → sequential fallback.
        daily_start_time: daily_start_time || null,
        daily_end_time: daily_end_time || null,
        match_duration_minutes: match_duration_minutes ?? null,
        buffer_minutes: buffer_minutes ?? null,
        ground_count: ground_count ?? null,
        ground_names: Array.isArray(ground_names) && ground_names.length > 0 ? ground_names : null,
        home_away: !!home_away,
        ...groupsConfigFields,
      })
      .select('*')
      .single();
    if (error || !tournament) return res.status(500).json({ error: sanitizeError(error) || 'Failed to create tournament' });

    // Auto-create tournament group chat (best-effort)
    try {
      const { data: chat } = await supabase
        .from('chats')
        .insert({ is_group: true, name: `${name} Chat`, created_by: userId })
        .select('id')
        .single();
      if (chat) {
        await supabase.from('chat_participants').insert({ chat_id: chat.id, user_id: userId, role: 'admin' });
        // Store the chat reference on the tournament — we use a loose
        // metadata approach since there's no dedicated FK column yet.
        await supabase.from('tournaments').update({ sport_metadata: { ...metadata, _chat_id: chat.id } }).eq('id', tournament.id);
      }
    } catch { /* chat creation is best-effort */ }

    // Per-day window overrides (optional).
    await upsertDayWindows(tournament.id, day_windows);

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
    const p = parsePagination(req.query as Record<string, unknown>);
    let query = supabase
      .from('tournaments')
      .select('*', { count: 'exact' })
      .order('created_at', { ascending: false })
      .range(p.from, p.to);
    if (resolvedSportId) query = query.eq('sport_id', resolvedSportId);
    if (city_id) query = query.eq('city_id', city_id);
    if (status) query = query.eq('status', status);
    if (mine === '1') query = query.eq('created_by', userId);
    const { data, error, count } = await query;
    if (error && !isRangeError(error)) return res.status(500).json({ error: sanitizeError(error) });
    return res.json({ tournaments: data || [], ...pageMeta(count, p) });
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

// POST /tournaments/:id/entries/direct — organiser directly adds a team (auto-approved)
// SC-240: a single player must not be rostered on two DIFFERENT teams in the
// same tournament (they'd have to play against themselves). Returns the name of
// a conflicting team if ANY member of `teamId`'s roster already belongs to
// another team already entered (pending/approved) in this tournament, else null.
// Bounded to 3 queries regardless of pool size (no N² roster cross-product):
// entering roster → other entered team ids → one overlap probe. Distinct teams
// that share NO players are allowed.
async function rosterOverlapConflict(
  tournamentId: string,
  teamId: string,
): Promise<{ teamName: string } | null> {
  const { data: roster } = await supabase
    .from('team_members')
    .select('user_id')
    .eq('team_id', teamId);
  const userIds = Array.from(new Set((roster ?? []).map((m) => m.user_id).filter(Boolean)));
  if (userIds.length === 0) return null;

  const { data: entries } = await supabase
    .from('tournament_entries')
    .select('team_id')
    .eq('tournament_id', tournamentId)
    .in('status', ['pending', 'approved'])
    .neq('team_id', teamId);
  const otherTeamIds = Array.from(new Set((entries ?? []).map((e) => e.team_id).filter(Boolean)));
  if (otherTeamIds.length === 0) return null;

  const { data: clash } = await supabase
    .from('team_members')
    .select('team_id')
    .in('team_id', otherTeamIds)
    .in('user_id', userIds)
    .limit(1)
    .maybeSingle();
  if (!clash) return null;
  const { data: clashTeam } = await supabase
    .from('teams')
    .select('name')
    .eq('id', clash.team_id)
    .maybeSingle();
  return { teamName: clashTeam?.name ?? 'another team' };
}

export async function directAddTeam(req: Request, res: Response) {
  const userId = req.userId;
  if (!userId) return res.status(401).json({ error: 'Unauthorized' });
  try {
    const { id } = req.params;
    const { team_id } = req.body || {};
    if (!team_id) return res.status(400).json({ error: 'team_id is required' });

    const { data: tournament } = await supabase
      .from('tournaments')
      .select('created_by, max_teams, fixtures_generated')
      .eq('id', id)
      .maybeSingle();
    if (!tournament) return res.status(404).json({ error: 'Tournament not found' });
    if (tournament.created_by !== userId) {
      return res.status(403).json({ error: 'Only the organiser can directly add teams' });
    }
    // SC-99: once the bracket is generated a new team would never appear in the
    // fixtures (entries diverge from the played bracket). Registration is closed.
    if ((tournament as any).fixtures_generated) {
      return res.status(409).json({ error: 'Registration is closed — the bracket has already been generated.', code: 'REGISTRATION_CLOSED' });
    }

    // Check max_teams cap
    if (tournament.max_teams) {
      const { count } = await supabase
        .from('tournament_entries')
        .select('id', { count: 'exact', head: true })
        .eq('tournament_id', id)
        .in('status', ['approved']);
      if ((count ?? 0) >= tournament.max_teams) {
        return res.status(400).json({ error: 'Tournament is full', code: 'TOURNAMENT_FULL' });
      }
    }

    // Check not already entered
    const { data: existing } = await supabase
      .from('tournament_entries')
      .select('id')
      .eq('tournament_id', id)
      .eq('team_id', team_id)
      .maybeSingle();
    if (existing) return res.status(400).json({ error: 'Team already registered' });

    // SC-240: no player may appear on two teams in the same tournament.
    const overlap = await rosterOverlapConflict(id, team_id);
    if (overlap) {
      return res.status(409).json({
        error: `A player on this team is already registered with ${overlap.teamName} in this tournament.`,
        code: 'ROSTER_OVERLAP',
      });
    }

    const { data, error } = await supabase
      .from('tournament_entries')
      .insert({ tournament_id: id, team_id, status: 'approved' })
      .select('*')
      .single();
    if (error) return res.status(500).json({ error: sanitizeError(error) });
    return res.json({ entry: data });
  } catch {
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

    // Check registration deadline and max_teams cap
    const { data: tournament } = await supabase
      .from('tournaments')
      .select('max_teams, registration_deadline, created_by, name, fixtures_generated')
      .eq('id', id)
      .maybeSingle();
    if (tournament?.registration_deadline && new Date(tournament.registration_deadline) < new Date()) {
      return res.status(400).json({ error: 'Registration closed', code: 'REGISTRATION_CLOSED' });
    }
    // SC-99: no new entries once the bracket is generated (would never play).
    if ((tournament as any)?.fixtures_generated) {
      return res.status(409).json({ error: 'Registration is closed — the bracket has already been generated.', code: 'REGISTRATION_CLOSED' });
    }
    if (tournament?.max_teams) {
      const { count } = await supabase
        .from('tournament_entries')
        .select('id', { count: 'exact', head: true })
        .eq('tournament_id', id)
        .in('status', ['pending', 'approved']);
      if ((count ?? 0) >= tournament.max_teams) {
        return res.status(400).json({ error: 'Tournament is full', code: 'TOURNAMENT_FULL' });
      }
    }

    // SC-240: no player may appear on two teams in the same tournament. Checked
    // before the reopen/insert so a re-entry after a rejection is re-validated too.
    const overlap = await rosterOverlapConflict(id, team_id);
    if (overlap) {
      return res.status(409).json({
        error: `A player on this team is already registered with ${overlap.teamName} in this tournament.`,
        code: 'ROSTER_OVERLAP',
      });
    }

    // SC-83: a team may re-enter after a REJECTED/WITHDRAWN entry. Reopen the
    // existing row to `pending` with a single filtered UPDATE (atomic per
    // statement). A row that is already pending/approved is a clean 400 —
    // never a duplicate row and never a raw 500 from the unique constraint.
    // Notify the ORGANISER that a team requested entry (block-respecting,
    // best-effort). Fired for a fresh request AND a re-request (reopen).
    const notifyEntryRequested = async (entryRowId: string) => {
      try {
        const organiserId = tournament?.created_by;
        if (!organiserId || organiserId === userId) return;
        const { data: team } = await supabase.from('teams').select('name').eq('id', team_id).maybeSingle();
        await notifyUnlessBlocked(userId, {
          userId: organiserId,
          type: 'entry_requested',
          title: 'New tournament entry',
          body: `${team?.name ?? 'A team'} requested to enter ${tournament?.name ?? 'your tournament'}.`,
          data: { tournamentId: id, teamId: team_id, entryId: entryRowId },
        });
      } catch { /* best-effort */ }
    };

    const nowIso = new Date().toISOString();
    const { data: reopened } = await supabase
      .from('tournament_entries')
      .update({ status: 'pending', entered_at: nowIso })
      .eq('tournament_id', id)
      .eq('team_id', team_id)
      .in('status', ['rejected', 'withdrawn'])
      .select('*')
      .maybeSingle();
    if (reopened) {
      await notifyEntryRequested(reopened.id);
      return res.json({ entry: reopened });
    }

    // No rejected/withdrawn row was reopened → either a live (pending/approved)
    // entry already exists, or there is no row yet.
    const { data: existing } = await supabase
      .from('tournament_entries')
      .select('status')
      .eq('tournament_id', id)
      .eq('team_id', team_id)
      .maybeSingle();
    if (existing) {
      return res.status(400).json({
        error: 'This team is already entered in this tournament.',
        code: 'ALREADY_ENTERED',
      });
    }

    const { data, error } = await supabase
      .from('tournament_entries')
      .insert({ tournament_id: id, team_id, status: 'pending' })
      .select('*')
      .single();
    if (error) {
      // Race backstop: a concurrent submit inserted first → unique violation.
      // The unique constraint guarantees no duplicate row; surface a clean 400,
      // never a 500.
      const code = (error as { code?: string }).code;
      if (code === '23505' || /duplicate|unique/i.test(error.message || '')) {
        return res.status(400).json({
          error: 'This team is already entered in this tournament.',
          code: 'ALREADY_ENTERED',
        });
      }
      return res.status(500).json({ error: sanitizeError(error) });
    }
    await notifyEntryRequested(data.id);
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
      .select('created_by, name, fixtures_generated')
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
      // SC-99: can't approve a NEW team into the bracket after it's generated.
      // (reject stays allowed for pending cleanup; withdrawn → SC-88 walkover.)
      if (status === 'approved' && (tournament as any).fixtures_generated) {
        return res.status(409).json({ error: 'Registration is closed — the bracket has already been generated.', code: 'REGISTRATION_CLOSED' });
      }
    } else if (status === 'withdrawn') {
      // SC-88: the team captain (self-withdraw) or the organiser may withdraw.
      if (!isTeamCaptain && !isCreator) {
        return res.status(403).json({ error: 'Only the team captain or organiser can withdraw' });
      }
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
    if (error) return res.status(500).json({ error: sanitizeError(error) });

    // SC-88: a mid-bracket withdrawal must not orphan the opponent. Award any
    // unplayed match of the withdrawing team to its opponent by walkover and
    // advance them into the next slot. Best-effort — the entry is already
    // withdrawn; a walkover hiccup must not fail the request.
    if (status === 'withdrawn') {
      try { await walkoverOnWithdraw(id, entry.team_id); } catch { /* best-effort */ }
    }

    // Notify the team CAPTAIN when the organiser approves/rejects the entry
    // (block-respecting, best-effort). Withdrawals are self-initiated → no notify.
    if (status === 'approved' || status === 'rejected') {
      try {
        const { data: cap } = await supabase
          .from('team_members').select('user_id')
          .eq('team_id', entry.team_id).eq('role', 'captain').maybeSingle();
        if (cap?.user_id && cap.user_id !== userId) {
          const { data: team } = await supabase.from('teams').select('name').eq('id', entry.team_id).maybeSingle();
          const approved = status === 'approved';
          await notifyUnlessBlocked(userId, {
            userId: cap.user_id,
            type: approved ? 'entry_approved' : 'entry_rejected',
            title: approved ? 'Tournament entry approved' : 'Tournament entry rejected',
            body: `${team?.name ?? 'Your team'} was ${approved ? 'approved for' : 'rejected from'} ${tournament?.name ?? 'the tournament'}.`,
            data: { tournamentId: id, teamId: entry.team_id, entryId },
          });
        }
      } catch { /* best-effort */ }
    }
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
      .select('created_by, status, name, start_date, end_date, venue')
      .eq('id', id)
      .maybeSingle();
    if (!tournament) return res.status(404).json({ error: 'Tournament not found' });
    if (tournament.created_by !== userId) return res.status(403).json({ error: 'Only the creator can update' });
    // SC-95/96: same bounds on edit.
    const uLong = firstTooLong(req.body || {}, [['name', LIMITS.tournamentNameMax], ['description', LIMITS.descriptionMax]]);
    if (uLong) return res.status(400).json({ error: `${uLong[0]} must be ${uLong[1]} characters or fewer` });
    const uBadUrl = firstDisallowedImageUrl(req.body || {}, ['banner_url', 'logo_url', 'sponsor_logo_url']);
    if (uBadUrl) return res.status(400).json({ error: `${uBadUrl} must be an uploaded image URL`, code: 'INVALID_IMAGE_URL' });

    // SC-102: validate allowlisted status/max_teams/format on the edit path
    // (createTournament validates these but the edit path previously did not).
    // Present-only — an absent field is left untouched.
    const body = req.body || {};
    if (body.max_teams !== undefined) {
      const mt = Number(body.max_teams);
      if (!Number.isInteger(mt) || mt < LIMITS.tournamentMinTeams || mt > LIMITS.tournamentMaxTeams) {
        return res.status(400).json({
          error: `max_teams must be between ${LIMITS.tournamentMinTeams} and ${LIMITS.tournamentMaxTeams}`,
        });
      }
    }
    if (body.format !== undefined && !isValidTournamentFormat(body.format)) {
      return res.status(400).json({
        error: `Invalid format. Must be one of: ${TOURNAMENT_FORMATS.join(', ')}`,
      });
    }
    const validStatuses = ['draft', 'upcoming', 'registration', 'live', 'active', 'completed', 'cancelled'];
    if (body.status !== undefined && !validStatuses.includes(body.status)) {
      return res.status(400).json({
        error: `Invalid status. Must be one of: ${validStatuses.join(', ')}`,
      });
    }

    const allowedKeys = [
      'name',
      'description',
      'format',
      'city_id',
      'city',
      'venue',
      'start_date',
      'end_date',
      'entry_fee',
      'max_teams',
      'prize_pool',
      'banner_url',
      'status',
      'tiebreaker_rules',
      'sport_metadata',
      'sponsor_name',
      'sponsor_logo_url',
      'organiser_name',
      'organiser_mobile',
      'registration_deadline',
      'logo_url',
      'home_away',
      'daily_start_time',
      'daily_end_time',
      'match_duration_minutes',
      'buffer_minutes',
      'ground_count',
      'ground_names',
    ];
    const update: Record<string, any> = {};
    for (const key of allowedKeys) {
      if (req.body && key in req.body) update[key] = req.body[key];
    }
    // SC-86: don't let a tournament be marked completed while matches are still
    // scheduled/live — that crowns a champion with an unplayed bracket.
    if (update.status === 'completed' && (await hasUnplayedFixtures(id))) {
      return res.status(409).json({
        error: 'Cannot complete a tournament while matches are still unplayed.',
        code: 'TOURNAMENT_INCOMPLETE',
      });
    }
    update.updated_at = new Date().toISOString();
    const { data, error } = await supabase
      .from('tournaments')
      .update(update)
      .eq('id', id)
      .select('*')
      .single();
    if (error) return res.status(500).json({ error: sanitizeError(error) });

    // Per-day window overrides (optional).
    await upsertDayWindows(id, req.body?.day_windows);

    // CHANGE NOTIF: a schedule/location change (start/end date, venue, or the
    // window/grounds that move fixtures) affects everyone entered — notify the
    // approved-team members. NOT description/banner/logo/sponsor/prize (noise).
    // Skipped on cancel (that has its own tournament_cancelled fan-out below).
    try {
      const scheduleKeys = ['start_date', 'end_date', 'venue', 'daily_start_time', 'daily_end_time', 'match_duration_minutes', 'buffer_minutes', 'ground_count'];
      const changed =
        update.status !== 'cancelled' &&
        scheduleKeys.some((k) => k in update && String(update[k] ?? '') !== String((tournament as any)[k] ?? ''));
      const dayWindowsChanged = Array.isArray(req.body?.day_windows) && req.body.day_windows.length > 0;
      if (changed || dayWindowsChanged) {
        await notifyTournamentUpdated(id, (data as any)?.name ?? tournament.name ?? null, userId);
      }
    } catch { /* best-effort */ }

    // SC-239: cancelling a tournament must not leave its bracket orphaned. On the
    // TRANSITION into 'cancelled' (from a non-cancelled status), abandon every
    // still-live/scheduled match and notify the registered entrants. Guarded on
    // the transition so a re-cancel is a no-op (no double-abandon, no double-
    // notify). Best-effort — the status change is already committed; a side-effect
    // hiccup must not fail the request.
    if (update.status === 'cancelled' && tournament.status !== 'cancelled') {
      try {
        await cancelTournamentSideEffects(id, tournament.name ?? null, userId);
      } catch { /* best-effort */ }
    }
    return res.json({ tournament: data });
  } catch (e) {
    return res.status(500).json({ error: 'Internal server error' });
  }
}

// SC-239: side-effects of cancelling a tournament. (a) Abandon every scheduled/
// live match so no orphaned "LIVE" fixture survives the cancellation — no winner
// and nothing advances (the whole bracket is dead, unlike an SC-88 single-team
// walkover). (b) Fan out a 'tournament_cancelled' notification to the CAPTAIN of
// every registered (pending/approved) team — the same recipient model as the
// entry approve/reject notifications. Ungated by design (see PREF_CATEGORY /
// SC-233): a cancellation is a critical one-time status change, always delivered.
async function cancelTournamentSideEffects(
  tournamentId: string,
  tournamentName: string | null,
  actorId: string,
): Promise<void> {
  const now = new Date().toISOString();
  // (a) Abandon live/scheduled matches. Idempotent: a re-run finds none left.
  await supabase
    .from('matches')
    .update({ status: 'abandoned', updated_at: now })
    .eq('tournament_id', tournamentId)
    .in('status', ['scheduled', 'live']);

  // (b) Notify the captain of every still-registered team.
  const { data: entries } = await supabase
    .from('tournament_entries')
    .select('team_id')
    .eq('tournament_id', tournamentId)
    .in('status', ['pending', 'approved']);
  const teamIds = Array.from(new Set((entries ?? []).map((e) => e.team_id).filter(Boolean)));
  if (teamIds.length === 0) return;
  const { data: captains } = await supabase
    .from('team_members')
    .select('user_id')
    .in('team_id', teamIds)
    .eq('role', 'captain');
  const captainIds = Array.from(new Set((captains ?? []).map((c) => c.user_id).filter(Boolean)));
  if (captainIds.length === 0) return;
  await notifyUsers(
    captainIds,
    {
      type: 'tournament_cancelled',
      title: 'Tournament cancelled',
      body: `${tournamentName ?? 'A tournament'} has been cancelled by the organiser.`,
      data: { tournamentId },
    },
    { actorId },
  );
}

// SC-253: announce the champion to everyone who played. Fanned out to ALL members
// of every APPROVED team, with a differentiated body — the winning team's members
// get "🏆 You won {tournament}!", everyone else "{champion} won {tournament}". The
// type `tournament_champion` is UNGATED (unmapped in PREF_CATEGORY, sibling of the
// ungated tournament_cancelled per SC-233): a one-time terminal result, always
// delivered. Called once, from advanceTournamentWinner's crown transition.
async function notifyTournamentChampion(
  tournamentId: string,
  championTeamId: string,
  championName: string | null,
  tournamentName: string | null,
): Promise<void> {
  const { data: entries } = await supabase
    .from('tournament_entries')
    .select('team_id')
    .eq('tournament_id', tournamentId)
    .eq('status', 'approved');
  const teamIds = Array.from(new Set((entries ?? []).map((e) => e.team_id).filter(Boolean)));
  if (teamIds.length === 0) return;
  const { data: members } = await supabase
    .from('team_members')
    .select('user_id, team_id')
    .in('team_id', teamIds);
  // Partition into champion-team members vs. the rest. ROSTER_OVERLAP (SC-240)
  // guarantees a user is on at most one entered team per tournament, so these
  // two sets are disjoint.
  const champIds = Array.from(
    new Set((members ?? []).filter((mm) => mm.team_id === championTeamId).map((mm) => mm.user_id).filter(Boolean)),
  );
  const otherIds = Array.from(
    new Set((members ?? []).filter((mm) => mm.team_id !== championTeamId).map((mm) => mm.user_id).filter(Boolean)),
  );
  const tName = tournamentName ?? 'the tournament';
  const cName = championName ?? 'The winner';
  if (champIds.length > 0) {
    await notifyUsers(champIds, {
      type: 'tournament_champion',
      title: 'Champions! 🏆',
      body: `🏆 You won ${tName}!`,
      data: { tournamentId },
    });
  }
  if (otherIds.length > 0) {
    await notifyUsers(otherIds, {
      type: 'tournament_champion',
      title: 'Tournament complete',
      body: `${cName} won ${tName}.`,
      data: { tournamentId },
    });
  }
}

// CHANGE NOTIF: a tournament's schedule/venue changed → tell everyone entered
// (all members of every APPROVED team). Gated 'matches'. Actor (organiser) is
// filtered out. Only called for schedule/location edits (updateTournament), never
// for cosmetic ones.
async function notifyTournamentUpdated(
  tournamentId: string,
  tournamentName: string | null,
  actorId: string,
): Promise<void> {
  const { data: entries } = await supabase
    .from('tournament_entries')
    .select('team_id')
    .eq('tournament_id', tournamentId)
    .eq('status', 'approved');
  const teamIds = Array.from(new Set((entries ?? []).map((e) => e.team_id).filter(Boolean)));
  if (teamIds.length === 0) return;
  const { data: members } = await supabase.from('team_members').select('user_id').in('team_id', teamIds);
  const userIds = Array.from(new Set((members ?? []).map((m) => m.user_id).filter(Boolean)));
  if (userIds.length === 0) return;
  await notifyUsers(
    userIds,
    {
      type: 'tournament_updated',
      title: 'Tournament updated',
      body: `${tournamentName ?? 'A tournament'}'s schedule or venue changed — check the new details.`,
      data: { tournamentId },
    },
    { actorId },
  );
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
      .select('id, team_a_name, team_b_name, team_a_id, team_b_id, score_summary, status, winner_team_id, scheduled_at, round, match_no, group_label, venue, ground_label')
      .eq('tournament_id', id)
      .order('round', { ascending: true })
      .order('match_no', { ascending: true })
      .order('scheduled_at', { ascending: true });
    if (error) return res.status(500).json({ error: sanitizeError(error) });

    // Group by the PERSISTED round (SC-23) — no more count-heuristic guessing.
    // round 0 = group stage (groups_knockout); 1..R = the bracket rounds.
    const byRound = new Map<number, any[]>();
    for (const m of matches ?? []) {
      const r = m.round ?? 1;
      if (!byRound.has(r)) byRound.set(r, []);
      byRound.get(r)!.push(m);
    }
    const roundKeys = Array.from(byRound.keys()).sort((a, b) => a - b);
    const count = roundKeys.length;
    const roundName = (r: number, idx: number): string => {
      if (r === 0) return 'Group Stage';
      const fromEnd = count - 1 - idx; // 0 = last round = final
      if (fromEnd === 0) return 'Final';
      if (fromEnd === 1) return 'Semi-Finals';
      if (fromEnd === 2) return 'Quarter-Finals';
      return `Round ${r}`;
    };

    const rounds = roundKeys.map((r, idx) => ({
      name: roundName(r, idx),
      matches: byRound.get(r)!.map((m) => {
        const ss: any = m.score_summary ?? {};
        return {
          id: m.id,
          team_a_id: m.team_a_id,
          team_b_id: m.team_b_id,
          team_a_name: m.team_a_name,
          team_b_name: m.team_b_name,
          score_a: ss.team_a_score ?? ss?.A?.score ?? null,
          score_b: ss.team_b_score ?? ss?.B?.score ?? null,
          winner_team_id: m.winner_team_id,
          status: m.status,
          scheduled_at: m.scheduled_at,
          // SC-264: forward the scheduled slot so the bracket / fixture list can
          // render "date · time · Ground N". The SELECT already fetched these; the
          // response mapping was dropping ground_label/venue → the ground never
          // reached the FE (invisible on every getBracket-backed surface).
          ground_label: (m as any).ground_label ?? null,
          venue: (m as any).venue ?? null,
        };
      }),
    }));

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
    if ((error as { code?: string } | null)?.code === '23505') {
      return res.status(409).json({ error: 'This team has already entered.', code: 'ALREADY_ENTERED' });
    }
    if (error) return res.status(500).json({ error: sanitizeError(error) });
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
    // Accept either `{ matches: [...] }` (legacy) or `{ updates: [...] }` (frontend).
    // Each item can use `id` or `fixture_id` as the identifier.
    const items = req.body?.updates ?? req.body?.matches;
    if (!Array.isArray(items) || items.length === 0) {
      return res.status(400).json({ error: 'updates array is required' });
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
    const blocked: string[] = [];
    const warnings: string[] = []; // SC-scheduling: soft team-double-book warnings (never block)
    // CHANGE NOTIF: collect affected participants across the whole call, then send
    // ONE batched notification per user (dragging 12 fixtures ≠ 12×N pings).
    const RESCHED_KEYS = ['scheduled_at', 'ground_label', 'venue', 'team_a_id', 'team_b_id'];
    const affectedByUser = new Map<string, Array<{ matchId: string; slot: string }>>();
    for (const upd of items) {
      const fixtureId = upd.id ?? upd.fixture_id;
      if (!fixtureId) continue;
      const patch: Record<string, any> = {};
      if (upd.scheduled_at) patch.scheduled_at = upd.scheduled_at;
      if (upd.venue) patch.venue = upd.venue;
      if (upd.ground_label !== undefined) patch.ground_label = upd.ground_label; // scheduling: move a match to another ground
      if ('team_a_id' in upd) patch.team_a_id = upd.team_a_id;
      if ('team_b_id' in upd) patch.team_b_id = upd.team_b_id;
      if (upd.team_a_name) patch.team_a_name = upd.team_a_name;
      if (upd.team_b_name) patch.team_b_name = upd.team_b_name;
      if (upd.winner_team_id !== undefined) patch.winner_team_id = upd.winner_team_id;
      if (upd.status) patch.status = upd.status;
      if (Object.keys(patch).length === 0) continue;

      const settingWinner = 'winner_team_id' in patch || patch.status === 'completed';

      // SC-23: once a winner has advanced into the next round and that match has
      // started, don't let the organizer rewrite this result out from under it.
      if (settingWinner) {
        const { data: cur } = await supabase
          .from('matches')
          .select('next_match_id')
          .eq('id', fixtureId)
          .eq('tournament_id', id)
          .maybeSingle();
        if (cur?.next_match_id) {
          const { data: child } = await supabase
            .from('matches')
            .select('status')
            .eq('id', cur.next_match_id)
            .maybeSingle();
          if (child && child.status !== 'scheduled') {
            blocked.push(fixtureId);
            continue;
          }
        }
      }

      // Capture old schedule fields for change detection (notify only on a REAL
      // change, not on a no-op re-save of the same value).
      const touchesResched = RESCHED_KEYS.some((k) => k in patch);
      let oldResched: any = null;
      if (touchesResched) {
        const { data: o } = await supabase
          .from('matches')
          .select('scheduled_at, ground_label, venue, team_a_id, team_b_id')
          .eq('id', fixtureId)
          .eq('tournament_id', id)
          .maybeSingle();
        oldResched = o;
      }

      // Allow updates even when status isn't 'scheduled' if explicitly setting
      // a new status (e.g. organizer marking 'completed' for an offline match)
      let query = supabase
        .from('matches')
        .update(patch)
        .eq('id', fixtureId)
        .eq('tournament_id', id);
      if (!upd.status && !upd.winner_team_id) {
        query = query.eq('status', 'scheduled');
      }
      const { data, error } = await query.select('*').single();
      if (!error && data) {
        results.push(data);
        // CHANGE NOTIF: collect participants of a genuinely-rescheduled match.
        if (touchesResched && oldResched) {
          const changed = RESCHED_KEYS.some((k) => String(oldResched[k] ?? '') !== String((data as any)[k] ?? ''));
          if (changed) {
            const { data: parts } = await supabase.from('match_participants').select('user_id').eq('match_id', fixtureId);
            const slot = formatSlotIst(data.scheduled_at, data.ground_label);
            for (const p of parts ?? []) {
              const arr = affectedByUser.get(p.user_id as string) ?? [];
              arr.push({ matchId: fixtureId, slot });
              affectedByUser.set(p.user_id as string, arr);
            }
          }
        }
        // Scheduling: a manual slot move can create a team double-book. SOFT-WARN
        // (the organiser knows their ground) — never block. A clash = another
        // match of this tournament at the SAME scheduled_at sharing a team.
        if (patch.scheduled_at && data.scheduled_at && (data.team_a_id || data.team_b_id)) {
          const { data: siblings } = await supabase
            .from('matches')
            .select('id, team_a_id, team_b_id, team_a_name, team_b_name')
            .eq('tournament_id', id)
            .eq('scheduled_at', data.scheduled_at)
            .neq('id', fixtureId);
          const teamIds = new Set([data.team_a_id, data.team_b_id].filter(Boolean));
          for (const s of siblings ?? []) {
            const clashId = [s.team_a_id, s.team_b_id].find((t) => t && teamIds.has(t));
            if (clashId) {
              const name = clashId === data.team_a_id ? data.team_a_name : data.team_b_name;
              warnings.push(`${name ?? 'A team'} is now double-booked at this time (also in ${s.team_a_name} vs ${s.team_b_name}).`);
            }
          }
        }
        // Propagate the winner into the bracket (SC-23) / auto-complete (SC-24).
        if (settingWinner) {
          try {
            await advanceTournamentWinner(fixtureId);
          } catch {
            /* best effort */
          }
        }
      }
    }

    // CHANGE NOTIF: one batched match_rescheduled per affected user. >1 match →
    // a summary; exactly 1 → the specific "moved to …" line. Gated 'matches',
    // actor filtered. Best-effort.
    for (const [uid, arr] of affectedByUser) {
      const body = arr.length === 1
        ? `Your match moved to ${arr[0]!.slot}.`
        : `${arr.length} of your matches were rescheduled — check the new times.`;
      const data: Record<string, string> = arr.length === 1
        ? { matchId: arr[0]!.matchId, screen: 'MatchDetail' }
        : { tournamentId: id };
      void notifyUsers([uid], { type: 'match_rescheduled', title: 'Match rescheduled', body, data }, { actorId: userId });
    }

    return res.json({
      updated: results.length,
      fixtures: results,
      blocked: blocked.length ? blocked : undefined,
      warnings: warnings.length ? warnings : undefined,
    });
  } catch {
    return res.status(500).json({ error: 'Internal server error' });
  }
}

// GET /tournaments/:id/chat — returns the tournament's group chat ID.
// Creates the chat lazily if it wasn't created at tournament-creation time
// (e.g. tournaments created before this feature shipped).
export async function getTournamentChat(req: Request, res: Response) {
  const userId = req.userId;
  if (!userId) return res.status(401).json({ error: 'Unauthorized' });
  try {
    const { id } = req.params;
    const { data: tournament } = await supabase
      .from('tournaments')
      .select('id, name, sport_metadata, created_by')
      .eq('id', id)
      .maybeSingle();
    if (!tournament) return res.status(404).json({ error: 'Tournament not found' });

    // Check if a chat already exists via sport_metadata._chat_id
    const meta: Record<string, unknown> = (tournament.sport_metadata as Record<string, unknown>) ?? {};
    let chatId: string | null = (meta._chat_id as string) ?? null;

    if (chatId) {
      // Verify the chat still exists
      const { data: existing } = await supabase.from('chats').select('id').eq('id', chatId).maybeSingle();
      if (!existing) chatId = null;
    }

    if (!chatId) {
      // Create the chat on-demand
      const { data: chat } = await supabase
        .from('chats')
        .insert({ is_group: true, name: `${tournament.name} Chat`, created_by: tournament.created_by })
        .select('id')
        .single();
      if (!chat) return res.status(500).json({ error: 'Could not create tournament chat' });
      chatId = chat.id;
      await supabase.from('chat_participants').insert({ chat_id: chatId, user_id: tournament.created_by, role: 'admin' });
      // Persist the reference
      await supabase.from('tournaments').update({ sport_metadata: { ...meta, _chat_id: chatId } }).eq('id', id);
    }

    // Ensure the requesting user is a participant (add them if not)
    const { data: participant } = await supabase
      .from('chat_participants')
      .select('id')
      .eq('chat_id', chatId)
      .eq('user_id', userId)
      .maybeSingle();
    if (!participant) {
      await supabase.from('chat_participants').insert({ chat_id: chatId, user_id: userId, role: 'member' });
    }

    return res.json({ chat_id: chatId, name: `${tournament.name} Chat`, conversationId: chatId });
  } catch {
    return res.status(500).json({ error: 'Internal server error' });
  }
}

// POST /tournaments/:id/generate-fixtures
// ─── Bracket engine (SC-23) ──────────────────────────────────────────────────

type TeamSlot = { id: string; name: string };
interface BracketBase {
  sport_id: string;
  tournament_id: string;
  venue: string | null;
  city_id: string | null;
  created_by: string;
  // Fallback timestamp for any bracket slot the scheduler didn't cover (should
  // not happen — the schedule is computed over the full bracket shape).
  fallbackStartIso: string;
}

function nextPow2(n: number): number {
  let p = 1;
  while (p < n) p *= 2;
  return p;
}

// Build round-1 matchups for `n` real teams padded to the next power of two.
// Every match gets a real team in slot A; the remaining teams fill slot B of
// the first (n-M) matches; the rest are byes (slot B empty). This guarantees no
// match is bye-vs-bye. Also used to seed a groups→KO bracket from qualifiers.
function buildRound1(teams: TeamSlot[]): Array<{ a: TeamSlot | null; b: TeamSlot | null }> {
  const n = teams.length;
  const M = nextPow2(n) / 2;
  const round1: Array<{ a: TeamSlot | null; b: TeamSlot | null }> = [];
  for (let m = 0; m < M; m++) {
    const b = teams[M + m] ?? null;
    round1.push({ a: teams[m] ?? null, b });
  }
  return round1;
}

// Standard single-elimination seed slot order for a bracket of `size` (a power
// of two). Returns the seed NUMBER (1-indexed, 1 = strongest) that belongs in
// each slot, arranged so seed 1 and seed 2 land in opposite halves and top
// seeds meet as late as possible. e.g. size 8 → [1,8,4,5,2,7,3,6].
function seedSlotOrder(size: number): number[] {
  let order = [1, 2];
  while (order.length < size) {
    const sum = order.length * 2 + 1;
    const next: number[] = [];
    for (const s of order) {
      next.push(s);
      next.push(sum - s);
    }
    order = next;
  }
  return order;
}

// SC-58: seed `seeds` (STRONGEST FIRST) into a bracket of nextPow2(seeds.length)
// using the standard seeding order, so byes fall on the TOP seeds (fair) instead
// of on arbitrary array indices. Match m pairs slot 2m vs slot 2m+1; a slot whose
// seed number exceeds the real field is a bye, and because seed 1 sits opposite
// the highest (missing) seed numbers, the strongest teams receive the byes.
function seededRound1(
  seeds: TeamSlot[],
  koSize: number,
): Array<{ a: TeamSlot | null; b: TeamSlot | null }> {
  const order = seedSlotOrder(koSize);
  const slots: (TeamSlot | null)[] = order.map((seedNo) => seeds[seedNo - 1] ?? null);
  const round1: Array<{ a: TeamSlot | null; b: TeamSlot | null }> = [];
  for (let m = 0; m < koSize / 2; m++) {
    round1.push({ a: slots[2 * m] ?? null, b: slots[2 * m + 1] ?? null });
  }
  return round1;
}

// SC-58: groups_knockout config. group_size / num_groups / qualifiers_per_group
// were hardcoded (4 / derived / top-2), which made top-1-per-group and custom
// group counts impossible and forced index-seeded byes. These knobs live on the
// tournaments row (migration 038). Read defensively so the controller still runs
// (with the old defaults) if the migration hasn't been applied yet.
interface GroupsConfig {
  numGroups: number | null;
  groupSize: number | null;
  qualifiersPerGroup: number;
}
async function getGroupsConfig(tournamentId: string): Promise<GroupsConfig> {
  try {
    const { data, error } = await supabase
      .from('tournaments')
      .select('num_groups, group_size, qualifiers_per_group')
      .eq('id', tournamentId)
      .maybeSingle();
    if (error || !data) return { numGroups: null, groupSize: null, qualifiersPerGroup: 2 };
    const d = data as { num_groups?: number | null; group_size?: number | null; qualifiers_per_group?: number | null };
    return {
      numGroups: d.num_groups ?? null,
      groupSize: d.group_size ?? null,
      qualifiersPerGroup: Math.max(1, Number(d.qualifiers_per_group ?? 2)),
    };
  } catch {
    return { numGroups: null, groupSize: null, qualifiersPerGroup: 2 };
  }
}

// Insert a full single-elimination bracket (all rounds up front), linking each
// match to its parent via next_match_id/next_slot so winners can advance.
// `round1` gives the explicit round-1 matchups (length = bracketSize/2); later
// rounds are created as TBD. Rounds are inserted final→first so a child's
// next_match_id references an already-created parent. Returns the ids of round-1
// matches that are byes (one real team) so the caller can auto-resolve them.
async function insertSingleElim(
  base: BracketBase,
  round1: Array<{ a: TeamSlot | null; b: TeamSlot | null }>,
  slotFor: (round: number, matchNo: number) => { scheduled_at: string; ground_label: string } | undefined,
): Promise<{ byeMatchIds: string[] }> {
  const bracketSize = round1.length * 2;
  const roundsCount = Math.max(1, Math.round(Math.log2(bracketSize)));
  const created: Record<string, string> = {}; // `${round}:${matchNo}` -> id

  for (let r = roundsCount; r >= 1; r--) {
    const matchesInRound = bracketSize / Math.pow(2, r);
    const rows: any[] = [];
    for (let m = 0; m < matchesInRound; m++) {
      const nextId = r < roundsCount ? created[`${r + 1}:${Math.floor(m / 2)}`] : null;
      const nextSlot = r < roundsCount ? (m % 2 === 0 ? 'A' : 'B') : null;
      const a = r === 1 ? round1[m].a : null;
      const b = r === 1 ? round1[m].b : null;
      let aName = 'TBD';
      let bName = 'TBD';
      if (r === 1) {
        aName = a?.name ?? (b ? 'BYE' : 'TBD');
        bName = b?.name ?? (a ? 'BYE' : 'TBD');
      }
      const slot = slotFor(r, m);
      rows.push({
        sport_id: base.sport_id,
        tournament_id: base.tournament_id,
        team_a_id: a?.id ?? null,
        team_b_id: b?.id ?? null,
        team_a_name: aName,
        team_b_name: bName,
        scheduled_at: slot?.scheduled_at ?? base.fallbackStartIso,
        ground_label: slot?.ground_label ?? null,
        venue: base.venue,
        city_id: base.city_id,
        status: 'scheduled',
        score_summary: {},
        created_by: base.created_by,
        round: r,
        match_no: m,
        next_match_id: nextId,
        next_slot: nextSlot,
        // SC-251: tournament matches are real ranked games — each bracket match
        // attributes ELO / matches_played / W-L to its lineup on completion.
        // Was omitted here → defaulted false → tournament play earned nothing on
        // the ladder while runs/MVP (ungated) still accrued (the split bug).
        // Forward-only: existing fixtures are untouched (never rewrite settled ELO).
        is_ranked: true,
      });
    }
    const { data, error } = await supabase.from('matches').insert(rows).select('id, match_no');
    if (error) throw new Error(error.message);
    for (const d of data ?? []) created[`${r}:${d.match_no}`] = d.id as string;
  }

  const byeMatchIds: string[] = [];
  for (let m = 0; m < round1.length; m++) {
    const { a, b } = round1[m];
    if (!!a?.id !== !!b?.id) byeMatchIds.push(created[`1:${m}`]);
  }
  return { byeMatchIds };
}

// Mark a bye/decided match completed and propagate its winner forward.
async function resolveMatchWinner(matchId: string, winnerTeamId: string): Promise<void> {
  await supabase.from('matches').update({ status: 'completed', winner_team_id: winnerTeamId }).eq('id', matchId);
  await advanceTournamentWinner(matchId);
}

// Propagate a resolved match's winner into its parent fixture slot; complete the
// tournament when the final resolves; seed the KO stage when a group stage ends.
// Idempotent (only fills an empty slot) so it's safe to call from every
// completion path (completeMatch / updateFixtures / updateMatch). SC-23/24.
// SC-86: a tournament may only be crowned/completed once the whole bracket is
// played — no match still scheduled or live. Used by both completion paths
// (auto-complete on final result + manual updateTournament status change) so a
// champion can never be crowned with an unplayed match (phantom champion).
async function hasUnplayedFixtures(tournamentId: string): Promise<boolean> {
  const { count } = await supabase
    .from('matches')
    .select('id', { count: 'exact', head: true })
    .eq('tournament_id', tournamentId)
    .in('status', ['scheduled', 'live']);
  return (count ?? 0) > 0;
}

// SC-255: crown the champion of a round_robin / league tournament — the STANDINGS
// LEADER, not whoever won the last match. Called from advanceTournamentWinner on
// every RR/league completion; no-ops until the whole schedule is played
// (hasUnplayedFixtures). Uses the SAME rankTeams ladder as the KO qualification
// path (maybeSeedKnockout) and the standings display, so they always agree. The
// team_id terminator in rankTeams guarantees a single deterministic ordered[0]
// even on a genuine tie — so a completed tournament always has a champion, never
// null. Independent of the completing match's winner, so a DRAWN last match still
// crowns the leader (the old crown branch's `if (!winnerId) return` stranded it).
// Idempotent via the .eq('status','live') CAS + read-back (SC-253 pattern) →
// notify exactly once.
async function crownLeagueChampion(tournamentId: string): Promise<void> {
  if (await hasUnplayedFixtures(tournamentId)) return;
  const { data: entries } = await supabase
    .from('tournament_entries')
    .select('team_id, team:teams!team_id(id, name)')
    .eq('tournament_id', tournamentId)
    .eq('status', 'approved');
  const teamIds = Array.from(new Set((entries ?? []).map((e) => e.team_id).filter(Boolean)));
  if (teamIds.length === 0) return;
  const nameOf: Record<string, string> = {};
  for (const e of entries ?? []) nameOf[e.team_id as string] = (e.team as any)?.name ?? 'Team';

  const { data: matches } = await supabase
    .from('matches')
    .select('team_a_id, team_b_id, winner_team_id, status, score_summary')
    .eq('tournament_id', tournamentId);
  const { data: trow } = await supabase
    .from('tournaments').select('tiebreaker_rules').eq('id', tournamentId).maybeSingle();
  const tiebreakerRules = ((trow as any)?.tiebreaker_rules ?? []) as any[];

  const ordered = rankTeams(teamIds, (matches ?? []) as any[], tiebreakerRules);
  const championId = ordered[0];
  if (!championId) return;

  const { data: crowned } = await supabase
    .from('tournaments')
    .update({ status: 'completed', champion_team_id: championId, updated_at: new Date().toISOString() })
    .eq('id', tournamentId)
    .eq('status', 'live')
    .select('id, name')
    .maybeSingle();
  if (crowned) {
    await notifyTournamentChampion(tournamentId, championId, nameOf[championId] ?? null, crowned.name ?? null);
  }
}

export async function advanceTournamentWinner(matchId: string): Promise<void> {
  const { data: m } = await supabase
    .from('matches')
    .select('id, tournament_id, winner_team_id, next_match_id, next_slot, group_label, round, team_a_id, team_b_id, team_a_name, team_b_name')
    .eq('id', matchId)
    .maybeSingle();
  if (!m || !m.tournament_id) return;

  // Group-stage match → the group stage may now be complete; seed the KO.
  if (m.group_label) {
    await maybeSeedKnockout(m.tournament_id);
    return;
  }

  // SC-255: round_robin / league have no bracket and no Final. The old
  // `if (m.round == null) return` guard NEVER fired (fixture-gen sets round=1 on
  // these — it always has), so they fell into the Final-crown branch below and
  // crowned whichever match COMPLETED LAST, not the standings leader. Route them
  // to a standings-based crown instead (leaving `round` alone — it's load-bearing
  // for maybeSeedKnockout / getBracket). Bracket formats (knockout,
  // groups_knockout) don't match here and fall through to the unchanged logic.
  const { data: fmtRow } = await supabase
    .from('tournaments').select('format').eq('id', m.tournament_id).maybeSingle();
  const fmt = (fmtRow as any)?.format;
  if (fmt === 'round_robin' || fmt === 'league') {
    await crownLeagueChampion(m.tournament_id);
    return;
  }
  // Defensive: a non-bracket match with no round somehow reaching here has no
  // linkage to advance.
  if (m.round == null) return;

  const winnerId = m.winner_team_id;
  // No winner yet (e.g. a draw not decided) → the bracket waits; the organizer
  // can set a winner via the fixture editor, which re-fires this.
  if (!winnerId) return;

  if (!m.next_match_id) {
    // Final resolved → auto-complete the tournament (SC-24) — but only if the
    // whole bracket is played. SC-86: if an earlier-round match is still
    // scheduled/live (e.g. the final was recorded before a semi), do NOT crown.
    // The resolving final is already terminal here, so it is not self-counted.
    if (await hasUnplayedFixtures(m.tournament_id)) return;
    // SC-253: crown the champion AND auto-complete in ONE conditional update.
    // The .eq('status','live') CAS makes it idempotent — a re-fire finds the
    // tournament already 'completed', updates zero rows, and the read-back is
    // null → we never re-notify. So the notification fires exactly once, on the
    // real transition. champion_team_id is the final's winner.
    const championName =
      winnerId === m.team_a_id ? m.team_a_name : winnerId === m.team_b_id ? m.team_b_name : null;
    const { data: crowned } = await supabase
      .from('tournaments')
      .update({ status: 'completed', champion_team_id: winnerId, updated_at: new Date().toISOString() })
      .eq('id', m.tournament_id)
      .eq('status', 'live')
      .select('id, name')
      .maybeSingle();
    if (crowned) {
      await notifyTournamentChampion(m.tournament_id, winnerId, championName, crowned.name ?? null);
    }
    return;
  }

  const winnerName =
    winnerId === m.team_a_id ? m.team_a_name : winnerId === m.team_b_id ? m.team_b_name : null;
  const slotIdCol = m.next_slot === 'A' ? 'team_a_id' : 'team_b_id';
  const slotNameCol = m.next_slot === 'A' ? 'team_a_name' : 'team_b_name';
  const { data: parent } = await supabase
    .from('matches')
    .select(`id, ${slotIdCol}, status`)
    .eq('id', m.next_match_id)
    .maybeSingle();
  if (!parent) return;
  const existing = (parent as any)[slotIdCol];
  if (existing) {
    // SC-87 (Option B — cascade): the child slot is already advanced. Allow a
    // re-record to OVERWRITE it with the corrected winner, but only while the
    // child match is still scheduled — a scheduled child has no winner, so the
    // cascade is bounded to this one level (nothing deeper to re-seed). Once the
    // child has started, the result is frozen (SC-23 blocks the re-record
    // upstream; this is the defensive mirror). No-op if the winner is unchanged.
    if (existing === winnerId) return;
    if ((parent as any).status !== 'scheduled') return;
  }
  // Fill an empty slot (first record) OR overwrite it in-place with the new
  // winner (same slot, swapped team — never a duplicate).
  await supabase
    .from('matches')
    .update({ [slotIdCol]: winnerId, [slotNameCol]: winnerName ?? 'Winner' })
    .eq('id', m.next_match_id);
}

// SC-88: when a team withdraws mid-tournament, resolve its unplayed matches so
// the opponent isn't stranded. Each scheduled/live match the team is in is
// awarded to the opponent by WALKOVER (status=abandoned, winner=opponent) and
// the opponent advances via advanceTournamentWinner (SC-87 cascade). A walkover
// is a forfeit, not a played match, so NO ELO is applied (abandon +
// advanceTournamentWinner never touch user_sport_profiles). If the match has no
// valid opponent (empty slot, or the opponent has ALSO withdrawn) the match is
// abandoned with no winner and nothing advances.
async function walkoverOnWithdraw(tournamentId: string, teamId: string): Promise<void> {
  const { data: matches } = await supabase
    .from('matches')
    .select('id, team_a_id, team_b_id, status')
    .eq('tournament_id', tournamentId)
    .in('status', ['scheduled', 'live'])
    .or(`team_a_id.eq.${teamId},team_b_id.eq.${teamId}`);
  const now = new Date().toISOString();
  for (const mt of matches ?? []) {
    const opponentId = mt.team_a_id === teamId ? mt.team_b_id : mt.team_a_id;
    let opponentWithdrawn = false;
    if (opponentId) {
      const { data: oppEntry } = await supabase
        .from('tournament_entries')
        .select('status')
        .eq('tournament_id', tournamentId)
        .eq('team_id', opponentId)
        .maybeSingle();
      opponentWithdrawn = oppEntry?.status === 'withdrawn';
    }
    if (!opponentId || opponentWithdrawn) {
      // No one to advance — abandon the match, leave the next slot empty.
      await supabase.from('matches').update({ status: 'abandoned', updated_at: now }).eq('id', mt.id);
      continue;
    }
    // Walkover: opponent wins the forfeited match and advances.
    await supabase
      .from('matches')
      .update({ status: 'abandoned', winner_team_id: opponentId, updated_at: now })
      .eq('id', mt.id);
    await advanceTournamentWinner(mt.id);
  }
}

// When every group-stage match is complete, seed the knockout round-1 slots from
// the group standings (top 2 per group, cross-paired to avoid an immediate
// same-group rematch). Idempotent. SC-23 (groups→KO transition).
async function maybeSeedKnockout(tournamentId: string): Promise<void> {
  const { data: groupMatches } = await supabase
    .from('matches')
    .select('id, status, winner_team_id, team_a_id, team_b_id, score_summary')
    .eq('tournament_id', tournamentId)
    .eq('round', 0);
  if (!groupMatches || groupMatches.length === 0) return;
  if (groupMatches.some((g) => g.status !== 'completed')) return;

  const { data: ko1 } = await supabase
    .from('matches')
    .select('id, match_no, team_a_id, team_b_id')
    .eq('tournament_id', tournamentId)
    .is('group_label', null)
    .eq('round', 1)
    .order('match_no', { ascending: true });
  if (!ko1 || ko1.length === 0) return;
  if (ko1.some((k) => k.team_a_id || k.team_b_id)) return; // already seeded

  const { data: entries } = await supabase
    .from('tournament_entries')
    .select('team_id, group_label, team:teams!team_id(id, name)')
    .eq('tournament_id', tournamentId)
    .not('group_label', 'is', null);

  // SC-58: deterministic standings (wins desc, then team id — NEVER DB row
  // order) + config-driven qualifiers per group + a properly SEEDED bracket so
  // byes fall on the strongest qualifiers instead of arbitrary array indices.
  const cfg = await getGroupsConfig(tournamentId);
  const qualsPerGroup = cfg.qualifiersPerGroup;
  const { data: trow } = await supabase
    .from('tournaments').select('tiebreaker_rules').eq('id', tournamentId).maybeSingle();
  const tiebreakerRules = ((trow as any)?.tiebreaker_rules ?? []) as any[];

  const nameOf: Record<string, string> = {};
  const groupTeams: Record<string, string[]> = {};
  for (const e of entries ?? []) {
    const label = (e.group_label as string) ?? '?';
    const tid = e.team_id as string;
    nameOf[tid] = (e.team as any)?.name ?? 'Team';
    (groupTeams[label] ??= []).push(tid);
  }
  const labels = Object.keys(groupTeams).sort();

  // SC-89: rank each group with the full tiebreak ladder (points -> head-to-head
  // -> score-diff -> score-scored -> team_id), honouring the tournament's
  // configured tiebreaker_rules when set. team_id terminator = no strand.
  const globalStats = computeStats(Object.keys(nameOf), groupMatches);
  const ptsOf = (id: string) => globalStats.get(id)?.points ?? 0;

  // ranks[r] = every team that finished position r (0-based) in its group.
  const ranks: Array<Array<{ id: string; name: string }>> = [];
  for (const label of labels) {
    const orderedIds = rankTeams(groupTeams[label], groupMatches, tiebreakerRules);
    for (let r = 0; r < qualsPerGroup; r++) {
      const id = orderedIds[r];
      if (id) (ranks[r] ??= []).push({ id, name: nameOf[id] ?? 'Team' });
    }
  }
  // Seed strongest-first across groups: within a rank tier, order by points then
  // team_id so byes fall on the strongest qualifiers.
  const tierCmp = (a: { id: string }, b: { id: string }) =>
    ptsOf(b.id) - ptsOf(a.id) || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0);
  const seeds: TeamSlot[] = [];
  for (let r = 0; r < ranks.length; r++) {
    const tier = (ranks[r] ?? []).slice().sort(tierCmp);
    for (const t of tier) seeds.push({ id: t.id, name: t.name });
  }
  if (seeds.length < 2) return;
  const round1 = seededRound1(seeds, ko1.length * 2);

  for (let m = 0; m < ko1.length; m++) {
    const mu = round1[m] ?? { a: null, b: null };
    await supabase
      .from('matches')
      .update({
        team_a_id: mu.a?.id ?? null,
        team_b_id: mu.b?.id ?? null,
        team_a_name: mu.a?.name ?? (mu.b ? 'BYE' : 'TBD'),
        team_b_name: mu.b?.name ?? (mu.a ? 'BYE' : 'TBD'),
      })
      .eq('id', ko1[m].id);
    if (!!mu.a?.id !== !!mu.b?.id) {
      await resolveMatchWinner(ko1[m].id, (mu.a?.id ?? mu.b?.id) as string);
    }
  }
}

// Auto-generates match fixtures from approved entries. Supports:
//   knockout → single elimination bracket, all rounds linked (any team count)
//   round_robin/league → every team plays every other (N*(N-1)/2 matches)
//   groups_knockout → round-robin groups (round 0) + a linked KO bracket seeded
//                     from group standings once the group stage completes
//
// SCHEDULING: every fixture is placed into a real slot (date + time + ground) by
// the round-aware greedy scheduler (utils/scheduleFixtures) from the tournament's
// date range, daily window, ground count, and match duration. If the organiser
// didn't set the scheduling fields, a graceful fallback (single ground, sequential
// from start_date) keeps generation working. Forward-only: the scheduler only
// affects newly generated fixtures; completion/crown logic never reads
// scheduled_at, so existing flows are undisturbed.

// Build the scheduler config from the tournament row. When the daily window /
// duration aren't set, fall back to an unbounded single-ground sequential
// schedule so create still works. end_date absent (but window set) → single day.
function buildTournamentScheduleConfig(
  t: any,
  startDateYmd: string,
  dayWindows?: Map<string, { startMin: number; endMin: number }>,
): SchedulingConfig {
  const hasWindow = !!(t.daily_start_time && t.daily_end_time && t.match_duration_minutes);
  if (!hasWindow) {
    return {
      startDateYmd, endDateYmd: null,
      dailyStartMin: 9 * 60, dailyEndMin: 21 * 60,
      durationMin: 60, bufferMin: 10,
      groundCount: 1, groundNames: null, bounded: false,
    };
  }
  return {
    startDateYmd,
    endDateYmd: (t.end_date as string) ?? startDateYmd,
    dailyStartMin: timeToMinutes(t.daily_start_time, 9 * 60),
    dailyEndMin: timeToMinutes(t.daily_end_time, 21 * 60),
    durationMin: Math.max(1, Number(t.match_duration_minutes)),
    bufferMin: Math.max(0, Number(t.buffer_minutes ?? 10)),
    groundCount: Math.max(1, Number(t.ground_count ?? 1)),
    groundNames: Array.isArray(t.ground_names) ? (t.ground_names as string[]) : null,
    bounded: true,
    dayWindows: dayWindows && dayWindows.size > 0 ? dayWindows : undefined,
  };
}

// Load per-day window overrides (tournament_days) into a Map<'YYYY-MM-DD', {startMin,endMin}>.
// Read defensively so generation still runs if migration 063 hasn't been applied.
async function loadDayWindows(tournamentId: string): Promise<Map<string, { startMin: number; endMin: number }>> {
  const map = new Map<string, { startMin: number; endMin: number }>();
  try {
    const { data } = await supabase
      .from('tournament_days')
      .select('day_date, start_time, end_time')
      .eq('tournament_id', tournamentId);
    for (const row of data ?? []) {
      const ymd = String(row.day_date).slice(0, 10);
      map.set(ymd, {
        startMin: timeToMinutes(row.start_time, 9 * 60),
        endMin: timeToMinutes(row.end_time, 21 * 60),
      });
    }
  } catch {
    // table missing / read error → no overrides (single-window behavior).
  }
  return map;
}

// Persist per-day window overrides (tournament_days). Accepts an array of
// { day_date, start_time, end_time }; upserts by (tournament_id, day_date).
// Only rows that DIFFER from the default need to be sent (the FE does this).
async function upsertDayWindows(tournamentId: string, rows: any): Promise<void> {
  if (!Array.isArray(rows) || rows.length === 0) return;
  const valid = rows
    .filter((r) => r && r.day_date && r.start_time && r.end_time)
    .map((r) => ({
      tournament_id: tournamentId,
      day_date: String(r.day_date).slice(0, 10),
      start_time: r.start_time,
      end_time: r.end_time,
    }));
  if (valid.length === 0) return;
  try {
    await supabase.from('tournament_days').upsert(valid, { onConflict: 'tournament_id,day_date' });
  } catch {
    // best-effort; table may not exist until migration 063 is applied.
  }
}

// Fixture shape of a single-elim bracket (round 1 carries the real round-1
// matchups; later rounds are TBD). Mirrors insertSingleElim's round numbering.
function bracketShape(round1: Array<{ a: TeamSlot | null; b: TeamSlot | null }>): FixtureShape[] {
  const bracketSize = round1.length * 2;
  const roundsCount = Math.max(1, Math.round(Math.log2(bracketSize)));
  const shape: FixtureShape[] = [];
  for (let r = roundsCount; r >= 1; r--) {
    const matchesInRound = bracketSize / Math.pow(2, r);
    for (let m = 0; m < matchesInRound; m++) {
      const a = r === 1 ? round1[m].a : null;
      const b = r === 1 ? round1[m].b : null;
      shape.push({ round: r, match_no: m, team_a_id: a?.id ?? null, team_b_id: b?.id ?? null });
    }
  }
  return shape;
}

// Compute the schedule from a set of match rows and assign scheduled_at +
// ground_label to each in place. Returns {ok:false,error} on a capacity failure.
function applyScheduleToRows(
  rows: any[], cfg: SchedulingConfig, fallbackIso: string,
): { ok: true } | { ok: false; error: string } {
  const shape: FixtureShape[] = rows.map((r) => ({
    round: r.round, match_no: r.match_no, team_a_id: r.team_a_id, team_b_id: r.team_b_id,
  }));
  const sched = buildSchedule(shape, cfg);
  if (!sched.ok) return { ok: false, error: sched.error };
  for (const r of rows) {
    const slot = sched.assignments.get(keyOf(r.round, r.match_no));
    r.scheduled_at = slot?.scheduled_at ?? fallbackIso;
    r.ground_label = slot?.ground_label ?? null;
  }
  return { ok: true };
}

export async function generateFixtures(req: Request, res: Response) {
  const userId = req.userId;
  if (!userId) return res.status(401).json({ error: 'Unauthorized' });
  try {
    const { id } = req.params;
    const { data: tournament } = await supabase
      .from('tournaments')
      .select('id, sport_id, format, city_id, venue, start_date, end_date, created_by, daily_start_time, daily_end_time, match_duration_minutes, buffer_minutes, ground_count, ground_names')
      .eq('id', id)
      .maybeSingle();
    if (!tournament) return res.status(404).json({ error: 'Tournament not found' });
    if (tournament.created_by !== userId) {
      return res.status(403).json({ error: 'Only the organiser can generate fixtures' });
    }

    // Get approved entries with team info
    const { data: entries } = await supabase
      .from('tournament_entries')
      .select('team_id, team:teams!team_id(id, name)')
      .eq('tournament_id', id)
      .eq('status', 'approved');
    const teams = (entries ?? []).map((e: any) => ({
      id: e.team_id,
      name: (e.team as any)?.name ?? 'TBD',
    }));

    if (teams.length < 2) {
      return res.status(400).json({ error: 'At least 2 approved teams required' });
    }

    // SC-48: DB-level atomic claim to prevent the fixture-generation RACE. The
    // old "count existing matches" guard let two concurrent requests both see 0
    // and both generate (→ duplicated fixtures). Postgres serializes concurrent
    // UPDATEs on the same row, so exactly ONE request flips
    // fixtures_generated false→true and gets a row back; the losers get 0 rows
    // and are rejected. The flag is reset in the catch below if generation
    // itself fails, so a genuine error still allows a retry.
    const nowIso = new Date().toISOString();
    const { data: claim, error: claimErr } = await supabase
      .from('tournaments')
      .update({ fixtures_generated: true, updated_at: nowIso })
      .eq('id', id)
      .eq('fixtures_generated', false)
      .select('id');
    if (claimErr) return res.status(500).json({ error: sanitizeError(claimErr) });
    if (!claim || claim.length === 0) {
      // SC-128: the claim failed → fixtures_generated is already true. Normally that
      // means the bracket exists (→ 409). BUT a HARD crash between this claim and the
      // match-insert can leave fixtures_generated=true with ZERO matches — a stuck
      // tournament (every retry → 409 forever, no bracket). Recover ONLY that case.
      const { count: matchCount } = await supabase
        .from('matches')
        .select('id', { count: 'exact', head: true })
        .eq('tournament_id', id);
      if (matchCount && matchCount > 0) {
        // Real bracket exists — genuinely already generated.
        return res.status(409).json({ error: 'Fixtures already generated for this tournament.' });
      }
      // 0 matches could also be a CONCURRENT in-progress generation (claimed, not yet
      // inserted — SC-48). Distinguish by staleness: a normal generation inserts within
      // ~1s, so flag=true + 0 matches + a >60s-old timestamp = genuinely crash-stuck.
      // The updated_at CAS also SERIALIZES concurrent recoveries: exactly one wins the
      // refresh, the rest see a fresh timestamp → 409. No new duplicate-bracket race.
      const staleBefore = new Date(Date.now() - 60_000).toISOString();
      const { data: recover } = await supabase
        .from('tournaments')
        .update({ updated_at: nowIso })
        .eq('id', id)
        .eq('fixtures_generated', true)
        .lt('updated_at', staleBefore)
        .select('id');
      if (!recover || recover.length === 0) {
        // In-progress generation (fresh timestamp) or another recovery already won.
        return res.status(409).json({ error: 'Fixtures already generated for this tournament.' });
      }
      // Won the stuck-state recovery (flag already true, 0 matches, stale) → regenerate.
    }

    const startDateYmd = (tournament.start_date ?? new Date().toISOString().slice(0, 10)) as string;
    const fallbackStartIso = new Date(`${startDateYmd}T00:00:00.000Z`).toISOString();
    const dayWindows = await loadDayWindows(id);
    const schedCfg = buildTournamentScheduleConfig(tournament, startDateYmd, dayWindows);
    const format = (tournament.format ?? 'knockout').toLowerCase();
    const base: BracketBase = {
      sport_id: tournament.sport_id,
      tournament_id: id,
      venue: tournament.venue ?? null,
      city_id: tournament.city_id ?? null,
      created_by: userId,
      fallbackStartIso,
    };

    if (format === 'knockout') {
      // Schedule the whole bracket up front (round-aware: QF slots before SF
      // before the Final), then insert with each row placed in its slot.
      const round1 = buildRound1(teams);
      const shape = bracketShape(round1);
      const sched = buildSchedule(shape, schedCfg);
      if (!sched.ok) return res.status(400).json({ error: sched.error, code: 'SCHEDULE_CAPACITY' });
      const slotFor = (r: number, m: number): SlotAssign | undefined => sched.assignments.get(keyOf(r, m));
      const { byeMatchIds } = await insertSingleElim(base, round1, slotFor);
      for (const byeId of byeMatchIds) {
        const { data: bm } = await supabase
          .from('matches')
          .select('team_a_id, team_b_id')
          .eq('id', byeId)
          .maybeSingle();
        const winnerId = bm?.team_a_id ?? bm?.team_b_id;
        if (winnerId) await resolveMatchWinner(byeId, winnerId);
      }
      await supabase.from('tournaments').update({ status: 'live' }).eq('id', id);
      const { count } = await supabase
        .from('matches')
        .select('id', { count: 'exact', head: true })
        .eq('tournament_id', id);
      return res.json({ success: true, matchesCreated: count ?? 0, format });
    }

    const matchRows: any[] = [];

    if (format === 'round_robin' || format === 'league') {
      // round_robin = single round-robin (N*(N-1)/2 matches). league = DOUBLE
      // round-robin / home-and-away (N*(N-1) matches): each pair plays twice with
      // team_a/team_b (home/away) swapped on the second leg. Standings aggregate
      // both legs automatically (computeStats/rankTeams iterate every match).
      const doubleLeg = format === 'league';
      let mno = 0;
      for (let i = 0; i < teams.length; i++) {
        for (let j = i + 1; j < teams.length; j++) {
          const legs: Array<[number, number]> = doubleLeg ? [[i, j], [j, i]] : [[i, j]];
          for (const [h, a] of legs) {
            matchRows.push({
              sport_id: tournament.sport_id,
              tournament_id: id,
              team_a_id: teams[h].id,
              team_b_id: teams[a].id,
              team_a_name: teams[h].name,
              team_b_name: teams[a].name,
              venue: tournament.venue ?? null,
              city_id: tournament.city_id ?? null,
              status: 'scheduled',
              score_summary: {},
              created_by: userId,
              round: 1,
              match_no: mno,
              is_ranked: true, // SC-251: round-robin / league matches are ranked too.
            });
            mno++;
          }
        }
      }
      // Schedule: team-conflict matters here (everyone plays everyone) — no team
      // may sit in two matches in the same time-slot.
      const schedRR = applyScheduleToRows(matchRows, schedCfg, fallbackStartIso);
      if (!schedRR.ok) return res.status(400).json({ error: schedRR.error, code: 'SCHEDULE_CAPACITY' });
      if (matchRows.length > 0) {
        const { error } = await supabase.from('matches').insert(matchRows).select('id');
        if (error) throw new Error('fixture insert failed');
      }
      await supabase.from('tournaments').update({ status: 'live' }).eq('id', id);
      return res.json({ success: true, matchesCreated: matchRows.length, format });
    }

    if (format === 'groups_knockout') {
      // Round-robin groups (round 0), then an empty KO bracket seeded from the
      // group standings once the group stage completes (maybeSeedKnockout).
      // SC-58: group count + qualifiers-per-group are organizer-configurable
      // (migration 038); fall back to the historical 4-per-group / top-2.
      const gcfg = await getGroupsConfig(id);
      const groupSize = gcfg.groupSize ?? 4;
      const numGroups = Math.min(
        teams.length,
        Math.max(1, gcfg.numGroups ?? Math.ceil(teams.length / groupSize)),
      );
      const qualsPerGroup = gcfg.qualifiersPerGroup;
      const groups: TeamSlot[][] = Array.from({ length: numGroups }, () => []);
      teams.forEach((t, i) => groups[i % numGroups].push(t));

      let mno = 0;
      for (let g = 0; g < groups.length; g++) {
        const label = String.fromCharCode(65 + g); // A, B, C…
        for (const t of groups[g]) {
          await supabase.from('tournament_entries').update({ group_label: label }).eq('tournament_id', id).eq('team_id', t.id);
        }
        const grp = groups[g];
        for (let i = 0; i < grp.length; i++) {
          for (let j = i + 1; j < grp.length; j++) {
            matchRows.push({
              sport_id: tournament.sport_id,
              tournament_id: id,
              team_a_id: grp[i].id,
              team_b_id: grp[j].id,
              team_a_name: grp[i].name,
              team_b_name: grp[j].name,
              venue: tournament.venue ?? null,
              city_id: tournament.city_id ?? null,
              status: 'scheduled',
              score_summary: {},
              created_by: userId,
              round: 0,
              match_no: mno,
              group_label: label,
              is_ranked: true, // SC-251: group-stage matches are ranked too.
            });
            mno++;
          }
        }
      }
      const koSize = nextPow2(numGroups * qualsPerGroup);
      const koRound1 = Array.from({ length: koSize / 2 }, () => ({ a: null as TeamSlot | null, b: null as TeamSlot | null }));
      // Schedule the group stage (round 0) AND the KO bracket (rounds 1..R)
      // together so the group stage entirely precedes the knockout in time.
      const gkShape: FixtureShape[] = [
        ...matchRows.map((r) => ({ round: r.round, match_no: r.match_no, team_a_id: r.team_a_id, team_b_id: r.team_b_id })),
        ...bracketShape(koRound1),
      ];
      const schedGK = buildSchedule(gkShape, schedCfg);
      if (!schedGK.ok) return res.status(400).json({ error: schedGK.error, code: 'SCHEDULE_CAPACITY' });
      for (const r of matchRows) {
        const slot = schedGK.assignments.get(keyOf(r.round, r.match_no));
        r.scheduled_at = slot?.scheduled_at ?? fallbackStartIso;
        r.ground_label = slot?.ground_label ?? null;
      }
      if (matchRows.length > 0) {
        const { error } = await supabase.from('matches').insert(matchRows);
        if (error) throw new Error('fixture insert failed');
      }
      await insertSingleElim(base, koRound1, (r, m) => schedGK.assignments.get(keyOf(r, m)));

      await supabase.from('tournaments').update({ status: 'live' }).eq('id', id);
      const { count } = await supabase
        .from('matches')
        .select('id', { count: 'exact', head: true })
        .eq('tournament_id', id);
      return res.json({ success: true, matchesCreated: count ?? 0, format });
    }

    // Unsupported format after claiming — release the flag so it isn't stuck.
    await supabase.from('tournaments').update({ fixtures_generated: false }).eq('id', id);
    return res.status(400).json({ error: `Unsupported format: ${format}` });
  } catch {
    // SC-48: generation failed after the atomic claim — release the flag so the
    // organiser can retry (otherwise the tournament would be permanently locked).
    try {
      await supabase.from('tournaments').update({ fixtures_generated: false }).eq('id', req.params.id);
    } catch {
      // best-effort
    }
    return res.status(500).json({ error: 'Internal server error' });
  }
}
