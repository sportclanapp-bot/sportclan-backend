import { Request, Response } from 'express';
import { supabase } from '../utils/supabase';
import { resolveSportId } from '../utils/sportId';
import { parsePagination, pageMeta } from '../utils/pagination';
import { sanitizeError } from '../utils/response';
import { isSportInactive } from '../utils/sports';

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
      home_away,
    } = req.body || {};
    if (!sport_id || !name || !format) {
      return res.status(400).json({ error: 'sport_id, name, format are required' });
    }
    // Reject soft-deactivated sports (kabaddi/athletics). No-op until the
    // sports.is_active column exists.
    if (await isSportInactive(sport_id)) {
      return res.status(400).json({ error: 'This sport is not available' });
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
        home_away: !!home_away,
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
    if (error) return res.status(500).json({ error: sanitizeError(error) });
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
export async function directAddTeam(req: Request, res: Response) {
  const userId = req.userId;
  if (!userId) return res.status(401).json({ error: 'Unauthorized' });
  try {
    const { id } = req.params;
    const { team_id } = req.body || {};
    if (!team_id) return res.status(400).json({ error: 'team_id is required' });

    const { data: tournament } = await supabase
      .from('tournaments')
      .select('created_by, max_teams')
      .eq('id', id)
      .maybeSingle();
    if (!tournament) return res.status(404).json({ error: 'Tournament not found' });
    if (tournament.created_by !== userId) {
      return res.status(403).json({ error: 'Only the organiser can directly add teams' });
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
      .select('max_teams, registration_deadline')
      .eq('id', id)
      .maybeSingle();
    if (tournament?.registration_deadline && new Date(tournament.registration_deadline) < new Date()) {
      return res.status(400).json({ error: 'Registration closed', code: 'REGISTRATION_CLOSED' });
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

    const { data, error } = await supabase
      .from('tournament_entries')
      .insert({ tournament_id: id, team_id, status: 'pending' })
      .select('*')
      .single();
    if (error) return res.status(500).json({ error: sanitizeError(error) });
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
    if (error) return res.status(500).json({ error: sanitizeError(error) });
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
    if (error) return res.status(500).json({ error: sanitizeError(error) });
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
      .select('id, team_a_name, team_b_name, team_a_id, team_b_id, score_summary, status, winner_team_id, scheduled_at, round, match_no, group_label')
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
    for (const upd of items) {
      const fixtureId = upd.id ?? upd.fixture_id;
      if (!fixtureId) continue;
      const patch: Record<string, any> = {};
      if (upd.scheduled_at) patch.scheduled_at = upd.scheduled_at;
      if (upd.venue) patch.venue = upd.venue;
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

    return res.json({ updated: results.length, fixtures: results, blocked: blocked.length ? blocked : undefined });
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

// Insert a full single-elimination bracket (all rounds up front), linking each
// match to its parent via next_match_id/next_slot so winners can advance.
// `round1` gives the explicit round-1 matchups (length = bracketSize/2); later
// rounds are created as TBD. Rounds are inserted final→first so a child's
// next_match_id references an already-created parent. Returns the ids of round-1
// matches that are byes (one real team) so the caller can auto-resolve them.
async function insertSingleElim(
  base: BracketBase,
  startDate: Date,
  round1: Array<{ a: TeamSlot | null; b: TeamSlot | null }>,
): Promise<{ byeMatchIds: string[] }> {
  const dayMs = 86400000;
  const bracketSize = round1.length * 2;
  const roundsCount = Math.max(1, Math.round(Math.log2(bracketSize)));
  const created: Record<string, string> = {}; // `${round}:${matchNo}` -> id
  let dayCursor = 0;

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
      rows.push({
        sport_id: base.sport_id,
        tournament_id: base.tournament_id,
        team_a_id: a?.id ?? null,
        team_b_id: b?.id ?? null,
        team_a_name: aName,
        team_b_name: bName,
        scheduled_at: new Date(startDate.getTime() + dayCursor * dayMs).toISOString(),
        venue: base.venue,
        city_id: base.city_id,
        status: 'scheduled',
        score_summary: {},
        created_by: base.created_by,
        round: r,
        match_no: m,
        next_match_id: nextId,
        next_slot: nextSlot,
      });
      dayCursor++;
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

  // Non-bracket format (round_robin/league) has no round/linkage to advance.
  if (m.round == null) return;

  const winnerId = m.winner_team_id;
  // No winner yet (e.g. a draw not decided) → the bracket waits; the organizer
  // can set a winner via the fixture editor, which re-fires this.
  if (!winnerId) return;

  if (!m.next_match_id) {
    // Final resolved → auto-complete the tournament (SC-24).
    await supabase
      .from('tournaments')
      .update({ status: 'completed', updated_at: new Date().toISOString() })
      .eq('id', m.tournament_id)
      .eq('status', 'live');
    return;
  }

  const winnerName =
    winnerId === m.team_a_id ? m.team_a_name : winnerId === m.team_b_id ? m.team_b_name : null;
  const slotIdCol = m.next_slot === 'A' ? 'team_a_id' : 'team_b_id';
  const slotNameCol = m.next_slot === 'A' ? 'team_a_name' : 'team_b_name';
  const { data: parent } = await supabase
    .from('matches')
    .select(`id, ${slotIdCol}`)
    .eq('id', m.next_match_id)
    .maybeSingle();
  if (!parent) return;
  if ((parent as any)[slotIdCol]) return; // already filled — idempotent
  await supabase
    .from('matches')
    .update({ [slotIdCol]: winnerId, [slotNameCol]: winnerName ?? 'Winner' })
    .eq('id', m.next_match_id);
}

// When every group-stage match is complete, seed the knockout round-1 slots from
// the group standings (top 2 per group, cross-paired to avoid an immediate
// same-group rematch). Idempotent. SC-23 (groups→KO transition).
async function maybeSeedKnockout(tournamentId: string): Promise<void> {
  const { data: groupMatches } = await supabase
    .from('matches')
    .select('id, status, winner_team_id')
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

  const wins: Record<string, number> = {};
  for (const g of groupMatches) if (g.winner_team_id) wins[g.winner_team_id] = (wins[g.winner_team_id] ?? 0) + 1;

  const byGroup: Record<string, Array<{ id: string; name: string; w: number }>> = {};
  for (const e of entries ?? []) {
    const label = (e.group_label as string) ?? '?';
    (byGroup[label] ??= []).push({ id: e.team_id as string, name: (e.team as any)?.name ?? 'Team', w: wins[e.team_id as string] ?? 0 });
  }
  const labels = Object.keys(byGroup).sort();
  const winners: TeamSlot[] = [];
  const runners: TeamSlot[] = [];
  for (const label of labels) {
    const sorted = byGroup[label].sort((a, b) => b.w - a.w);
    if (sorted[0]) winners.push({ id: sorted[0].id, name: sorted[0].name });
    if (sorted[1]) runners.push({ id: sorted[1].id, name: sorted[1].name });
  }
  // Rotate runners by one group so round 1 never re-pairs a group (W_g vs R_{g+1}).
  const rotated = runners.map((_, i) => runners[(i + 1) % runners.length]).filter(Boolean) as TeamSlot[];
  const qualifiers = [...winners, ...rotated];
  if (qualifiers.length < 2) return;
  const round1 = buildRound1(qualifiers);

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
export async function generateFixtures(req: Request, res: Response) {
  const userId = req.userId;
  if (!userId) return res.status(401).json({ error: 'Unauthorized' });
  try {
    const { id } = req.params;
    const { data: tournament } = await supabase
      .from('tournaments')
      .select('id, sport_id, format, city_id, venue, start_date, created_by')
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

    // Check for existing matches — don't duplicate
    const { count: existingCount } = await supabase
      .from('matches')
      .select('id', { count: 'exact', head: true })
      .eq('tournament_id', id);
    if ((existingCount ?? 0) > 0) {
      return res.status(400).json({ error: 'Fixtures already generated. Delete existing matches first.' });
    }

    const startDate = tournament.start_date ? new Date(tournament.start_date) : new Date();
    const dayMs = 86400000;
    const format = (tournament.format ?? 'knockout').toLowerCase();
    const base: BracketBase = {
      sport_id: tournament.sport_id,
      tournament_id: id,
      venue: tournament.venue ?? null,
      city_id: tournament.city_id ?? null,
      created_by: userId,
    };

    if (format === 'knockout') {
      // Full single-elim bracket (all rounds, linked). Byes auto-advance.
      const { byeMatchIds } = await insertSingleElim(base, startDate, buildRound1(teams));
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
      let mno = 0;
      for (let i = 0; i < teams.length; i++) {
        for (let j = i + 1; j < teams.length; j++) {
          matchRows.push({
            sport_id: tournament.sport_id,
            tournament_id: id,
            team_a_id: teams[i].id,
            team_b_id: teams[j].id,
            team_a_name: teams[i].name,
            team_b_name: teams[j].name,
            scheduled_at: new Date(startDate.getTime() + mno * dayMs).toISOString(),
            venue: tournament.venue ?? null,
            city_id: tournament.city_id ?? null,
            status: 'scheduled',
            score_summary: {},
            created_by: userId,
            round: 1,
            match_no: mno,
          });
          mno++;
        }
      }
      if (matchRows.length > 0) {
        const { data, error } = await supabase.from('matches').insert(matchRows).select('id');
        if (error) return res.status(500).json({ error: sanitizeError(error) });
      }
      await supabase.from('tournaments').update({ status: 'live' }).eq('id', id);
      return res.json({ success: true, matchesCreated: matchRows.length, format });
    }

    if (format === 'groups_knockout') {
      // Round-robin groups of 4 (round 0), then an empty KO bracket seeded from
      // the group standings once the group stage completes (maybeSeedKnockout).
      const groupSize = 4;
      const numGroups = Math.max(1, Math.ceil(teams.length / groupSize));
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
              scheduled_at: new Date(startDate.getTime() + mno * dayMs).toISOString(),
              venue: tournament.venue ?? null,
              city_id: tournament.city_id ?? null,
              status: 'scheduled',
              score_summary: {},
              created_by: userId,
              round: 0,
              match_no: mno,
              group_label: label,
            });
            mno++;
          }
        }
      }
      if (matchRows.length > 0) {
        const { error } = await supabase.from('matches').insert(matchRows);
        if (error) return res.status(500).json({ error: sanitizeError(error) });
      }
      const koSize = nextPow2(numGroups * 2);
      const koRound1 = Array.from({ length: koSize / 2 }, () => ({ a: null as TeamSlot | null, b: null as TeamSlot | null }));
      const koStart = new Date(startDate.getTime() + (matchRows.length + 1) * dayMs);
      await insertSingleElim(base, koStart, koRound1);

      await supabase.from('tournaments').update({ status: 'live' }).eq('id', id);
      const { count } = await supabase
        .from('matches')
        .select('id', { count: 'exact', head: true })
        .eq('tournament_id', id);
      return res.json({ success: true, matchesCreated: count ?? 0, format });
    }

    return res.status(400).json({ error: `Unsupported format: ${format}` });
  } catch {
    return res.status(500).json({ error: 'Internal server error' });
  }
}
