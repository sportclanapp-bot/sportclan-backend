/**
 * Badminton gap 2 (Oct 2026) · singles and pair entries.
 *
 * Everyone used to enter as a team, so a singles player had to make a
 * one-person team, and a doubles pair was just a team with no invitation. Now
 * a singles or doubles event (tournaments.entry_kind) is entered by players:
 *
 *  - singles: a player enters as themselves (POST /:id/enter-self);
 *  - doubles: a player invites a partner, who accepts (POST /:id/pair-invites,
 *    then …/accept); or says they're looking for a partner (open), and another
 *    player asks to partner them; before the draw an entered pair can change
 *    partner (an invite naming the entry);
 *  - the organiser can add a player or pair players directly
 *    (POST /:id/entries/players).
 *
 * Underneath, the entrant is still a team, so draws, fixtures, standings,
 * scoring and ratings don't change: the server makes a hidden "entry team"
 * (teams.kind = 'entry') of the player or the pair. Entry teams never show in
 * team lists, search or pickers, and their roster can't be changed through the
 * team routes.
 */
import { allRows, selectAll, selectAllIn } from '../utils/selectAll';
import { Request, Response } from 'express';
import { supabase } from '../utils/supabase';
import { isUuid } from '../utils/uuid';
import { sanitizeError } from '../utils/response';
import { isTournamentOrganiser } from '../utils/tournamentAuth';
import { notifyUnlessBlocked } from '../utils/notify';
import { isBlockedBetween, blockedUserIds } from '../utils/blocks';
import { settingsOf, categoryProblem } from '../utils/tournamentSettings';
import { syncTournamentChatMembers, syncAfterSuccess } from '../utils/tournamentChat';
import { ENTER_AN_EVENT } from '../utils/tournamentEvents';
import { LIMITS } from '../utils/validation';
import { eventLimitRefusal } from '../utils/eventLimits';

type T = {
  id: string; name: string | null; status: string; sport_id: string | null; max_teams: number | null;
  registration_deadline: string | null; fixtures_generated: boolean | null; created_by: string | null;
  settings: unknown; start_date: string | null; is_parent: boolean | null; parent_id: string | null; entry_kind: string | null;
};
const T_COLS = 'id, name, status, sport_id, max_teams, registration_deadline, fixtures_generated, created_by, settings, start_date, is_parent, parent_id, entry_kind';
type Person = { id: string; name: string | null; username: string | null; gender: string | null; dob: string | null; deleted_at?: string | null };
type Refusal = { status: number; body: { error: string; code: string; user_id?: string } };

const no = (status: number, code: string, error: string, user_id?: string): Refusal => ({ status, body: { error, code, ...(user_id ? { user_id } : {}) } });
const nameOf = (p: { name?: string | null; username?: string | null } | null | undefined) => (p?.name || p?.username || 'A player').trim();

async function loadTournament(id: string): Promise<T | null> {
  if (!isUuid(id)) return null;
  const { data } = await supabase.from('tournaments').select(T_COLS).eq('id', id).maybeSingle();
  return (data as T | null) ?? null;
}

async function people(ids: string[]): Promise<Map<string, Person>> {
  if (ids.length === 0) return new Map();
  const { data } = await supabase.from('users').select('id, name, username, gender, dob, deleted_at').in('id', ids);
  return new Map(((data ?? []) as Person[]).map((p) => [p.id, p]));
}

/** The players already in a live (pending / approved) entry of this event: user → entry. */
async function enteredPlayers(tournamentId: string): Promise<Map<string, { entry_id: string; team_id: string; status: string }>> {
  // Oct 2026: every entry and player (an event has no size cap).
  const entries = await allRows(() => supabase
    .from('tournament_entries').select('id, team_id, status').eq('tournament_id', tournamentId).in('status', ['pending', 'approved']));
  const rows = (entries ?? []) as Array<{ id: string; team_id: string; status: string }>;
  const out = new Map<string, { entry_id: string; team_id: string; status: string }>();
  if (rows.length === 0) return out;
  const byTeam = new Map(rows.map((r) => [r.team_id, r]));
  const members = await selectAllIn(rows.map((r) => r.team_id), (c, f, to) => supabase.from('team_members').select('team_id, user_id').in('team_id', c).order('id').range(f, to));
  for (const m of (members ?? []) as Array<{ team_id: string; user_id: string }>) {
    const e = byTeam.get(m.team_id);
    if (e) out.set(m.user_id, { entry_id: e.id, team_id: e.team_id, status: e.status });
  }
  return out;
}

const needed = (kind: string | null | undefined) => (kind === 'doubles' ? 2 : 1);

/**
 * Can these players enter this event (as one entry)? The rules of a team's
 * entry — finished, closed, drawn, full, category — for players, plus: the
 * event takes players (not teams), the right number of them, none already in
 * it, and (gap 3) within the tournament's limit of events per player.
 *  `except`: an entry being changed (its own players aren't "already entered").
 */
async function playersRefusal(
  t: T, userIds: string[], opts: { asOrganiser: boolean; except?: string | null; capCounts?: Array<'pending' | 'approved'>; partial?: boolean },
): Promise<Refusal | null> {
  if (t.is_parent) return { status: 409, body: ENTER_AN_EVENT };
  if (t.entry_kind !== 'singles' && t.entry_kind !== 'doubles') return no(409, 'ENTER_AS_TEAM', 'This tournament is entered by teams.');
  // `partial`: one player of a pair still looking for the other — everything but the count.
  if (!opts.partial && (new Set(userIds).size !== needed(t.entry_kind) || userIds.length !== needed(t.entry_kind))) {
    return no(400, 'BAD_PLAYERS', t.entry_kind === 'doubles' ? 'A doubles entry is two different players.' : 'A singles entry is one player.');
  }
  if (t.status === 'completed' || t.status === 'cancelled') {
    return no(409, 'TOURNAMENT_FINISHED', t.status === 'completed' ? 'This tournament is finished.' : 'This tournament was cancelled.');
  }
  if (!opts.asOrganiser && t.registration_deadline && new Date(t.registration_deadline) < new Date()) return no(400, 'REGISTRATION_CLOSED', 'Registration closed');
  if (t.fixtures_generated) return no(409, 'REGISTRATION_CLOSED', 'Registration is closed — the draw has already been made.');
  const ppl = await people(userIds);
  for (const id of userIds) {
    const p = ppl.get(id);
    if (!p || p.deleted_at) return no(404, 'USER_NOT_FOUND', 'That player wasn’t found.', id);
  }
  const entered = await enteredPlayers(t.id);
  for (const id of userIds) {
    const e = entered.get(id);
    if (e && e.entry_id !== opts.except) return no(409, 'ALREADY_ENTERED', `${nameOf(ppl.get(id))} is already entered in this event.`, id);
  }
  if (t.max_teams && !opts.except) {
    const { count } = await supabase.from('tournament_entries').select('id', { count: 'exact', head: true })
      .eq('tournament_id', t.id).in('status', opts.capCounts ?? (opts.asOrganiser ? ['approved'] : ['pending', 'approved']));
    if ((count ?? 0) >= t.max_teams) return no(400, 'TOURNAMENT_FULL', 'This event is full.');
  }
  const category = settingsOf(t).category;
  if (category) {
    const ratings = new Map<string, number>();
    if (t.sport_id && (category.maxRating != null || category.minRating != null)) {
      const { data: profs } = await supabase.from('user_sport_profiles').select('user_id, rating').eq('sport_id', t.sport_id).in('user_id', userIds);
      for (const r of (profs ?? []) as Array<{ user_id: string; rating: number | null }>) if (r.rating != null) ratings.set(r.user_id, Number(r.rating));
    }
    const players = userIds.map((id) => { const p = ppl.get(id)!; return { name: nameOf(p), gender: p.gender, dob: p.dob, rating: ratings.get(id) ?? null }; });
    const on = t.start_date && Number.isFinite(Date.parse(t.start_date)) ? new Date(t.start_date) : new Date();
    const why = categoryProblem(category, players, on);
    if (why) return no(400, 'CATEGORY', why.replace('on the team', 'in the pair'));
  }
  const limit = await eventLimitRefusal(t, userIds, ppl, opts.except ?? null);
  if (limit) return limit;
  return null;
}

/** "Ravi K / Amit S" (each name cut to fit), or the player's own name. */
export function entryTeamName(names: string[]): string {
  const clean = names.map((n) => n.trim() || 'Player');
  if (clean.length === 1) return clean[0]!.slice(0, LIMITS.teamNameMax);
  const each = Math.floor((LIMITS.teamNameMax - 3) / 2);
  return clean.map((n) => (n.length > each ? `${n.slice(0, each - 1)}…` : n)).join(' / ');
}

function joinCode(): string {
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  let s = 'E';
  for (let i = 0; i < 6; i++) s += chars[Math.floor(Math.random() * chars.length)];
  return s;
}

/**
 * Make the entry: a hidden entry team of these players (the first is its
 * captain, a partner its co-captain) and the entry itself. A failed entry
 * insert takes the team with it. Then the players' other open invites for this
 * event are closed (they're in).
 */
async function makeEntry(t: T, userIds: string[], status: 'pending' | 'approved', createdBy: string): Promise<{ entry?: Record<string, unknown>; error?: string }> {
  const ppl = await people(userIds);
  const { data: team, error: teamErr } = await supabase.from('teams').insert({
    sport_id: t.sport_id, name: entryTeamName(userIds.map((id) => nameOf(ppl.get(id)))), created_by: createdBy,
    join_code: joinCode(), join_policy: 'approval', kind: 'entry',
  }).select('id, name').single();
  if (teamErr || !team) return { error: sanitizeError(teamErr) || 'Couldn’t make the entry.' };
  const { error: memErr } = await supabase.from('team_members').insert(
    userIds.map((id, i) => ({ team_id: team.id, user_id: id, role: i === 0 ? 'captain' : 'vice_captain' })),
  );
  if (memErr) { await supabase.from('teams').delete().eq('id', team.id); return { error: sanitizeError(memErr) }; }
  const { data: entry, error } = await supabase.from('tournament_entries')
    .insert({ tournament_id: t.id, team_id: team.id, status }).select('*').single();
  if (error || !entry) {
    await supabase.from('teams').delete().eq('id', team.id);
    const dup = (error as { code?: string } | null)?.code === '23505';
    return { error: dup ? 'Already entered.' : sanitizeError(error) || 'Couldn’t make the entry.' };
  }
  await supabase.from('tournament_pair_invites')
    .update({ status: 'cancelled', responded_at: new Date().toISOString() })
    .eq('tournament_id', t.id).in('status', ['open', 'pending']).in('inviter_id', userIds);
  await supabase.from('tournament_pair_invites')
    .update({ status: 'cancelled', responded_at: new Date().toISOString() })
    .eq('tournament_id', t.id).eq('status', 'pending').in('invitee_id', userIds).is('entry_id', null);
  return { entry: { ...entry, team } };
}

/** The organiser hears of a new entry (as a team's entry request does). */
async function tellOrganiser(t: T, actorId: string, teamName: string, landed: string, entryId: string) {
  if (!t.created_by || t.created_by === actorId) return;
  await notifyUnlessBlocked(actorId, {
    userId: t.created_by,
    type: 'entry_requested',
    title: 'New tournament entry',
    body: landed === 'approved' ? `${teamName} entered ${t.name ?? 'your tournament'}.` : `${teamName} asked to enter ${t.name ?? 'your tournament'}.`,
    data: { tournamentId: t.id, entryId },
  });
}

// POST /tournaments/:id/enter-self — a singles player enters as themselves.
export async function enterSelf(req: Request, res: Response) {
  const userId = req.userId;
  if (!userId) return res.status(401).json({ error: 'Unauthorized' });
  try {
    syncAfterSuccess(res, () => syncTournamentChatMembers(String(req.params.id)));
    const t = await loadTournament(String(req.params.id));
    if (!t) return res.status(404).json({ error: 'Tournament not found' });
    if (t.entry_kind === 'doubles') return res.status(409).json({ error: 'This is a doubles event — invite a partner to enter.', code: 'NEEDS_PARTNER' });
    const bad = await playersRefusal(t, [userId], { asOrganiser: false });
    if (bad) return res.status(bad.status).json(bad.body);
    const landed = settingsOf(t).entry === 'open' ? 'approved' : 'pending';
    const made = await makeEntry(t, [userId], landed, userId);
    if (!made.entry) return res.status(500).json({ error: made.error });
    void tellOrganiser(t, userId, String((made.entry.team as { name: string }).name), landed, String(made.entry.id));
    return res.json({ entry: made.entry });
  } catch {
    return res.status(500).json({ error: 'Internal server error' });
  }
}

// POST /tournaments/:id/entries/players { user_ids } — the organiser adds a
// singles player, or pairs two players, straight in (approved).
export async function addPlayersEntry(req: Request, res: Response) {
  const userId = req.userId;
  if (!userId) return res.status(401).json({ error: 'Unauthorized' });
  try {
    syncAfterSuccess(res, () => syncTournamentChatMembers(String(req.params.id)));
    const t = await loadTournament(String(req.params.id));
    if (!t) return res.status(404).json({ error: 'Tournament not found' });
    if (!(await isTournamentOrganiser(t.id, userId))) return res.status(403).json({ error: 'Only the organiser can add players.' });
    const ids = Array.isArray(req.body?.user_ids) ? (req.body.user_ids as unknown[]).filter((x): x is string => typeof x === 'string' && isUuid(x)) : [];
    if (ids.length === 0) return res.status(400).json({ error: 'Pick the players.', code: 'BAD_PLAYERS' });
    const bad = await playersRefusal(t, ids, { asOrganiser: true });
    if (bad) return res.status(bad.status).json(bad.body);
    const made = await makeEntry(t, ids, 'approved', userId);
    if (!made.entry) return res.status(500).json({ error: made.error });
    for (const id of ids) {
      void notifyUnlessBlocked(userId, {
        userId: id, type: 'entry_approved', title: 'You’re entered',
        body: `You were entered in ${t.name ?? 'a tournament'}${ids.length === 2 ? ` with ${String((made.entry.team as { name: string }).name)}` : ''}.`,
        data: { tournamentId: t.id, entryId: String(made.entry.id) },
      });
    }
    return res.json({ entry: made.entry });
  } catch {
    return res.status(500).json({ error: 'Internal server error' });
  }
}

type Invite = { id: string; tournament_id: string; inviter_id: string; invitee_id: string | null; entry_id: string | null; status: string; note: string | null; created_at: string };

// POST /tournaments/:id/pair-invites { invitee_id?, open?, note?, entry_id? }
//  - invitee_id: invite this partner (pending until they accept);
//  - open: true: "looking for a partner" (anyone may ask);
//  - entry_id (with invitee_id): change my pair's partner, before the draw.
export async function createPairInvite(req: Request, res: Response) {
  const userId = req.userId;
  if (!userId) return res.status(401).json({ error: 'Unauthorized' });
  try {
    const t = await loadTournament(String(req.params.id));
    if (!t) return res.status(404).json({ error: 'Tournament not found' });
    if (t.is_parent) return res.status(409).json(ENTER_AN_EVENT);
    if (t.entry_kind !== 'doubles') return res.status(409).json({ error: 'Partners are for doubles events.', code: 'NOT_DOUBLES' });
    const body = (req.body ?? {}) as { invitee_id?: unknown; open?: unknown; note?: unknown; entry_id?: unknown };
    const note = typeof body.note === 'string' && body.note.trim() ? body.note.trim() : null;
    if (note && note.length > 120) return res.status(400).json({ error: 'A note is up to 120 characters.', code: 'BAD_NOTE' });
    const open = body.open === true;
    const invitee = typeof body.invitee_id === 'string' ? body.invitee_id : null;
    const entryId = typeof body.entry_id === 'string' && isUuid(body.entry_id) ? body.entry_id : null;
    if (!open && (!invitee || !isUuid(invitee))) return res.status(400).json({ error: 'Pick a partner.', code: 'BAD_PARTNER' });
    if (open && entryId) return res.status(400).json({ error: 'Pick the new partner.', code: 'BAD_PARTNER' });
    if (invitee === userId) return res.status(400).json({ error: 'Pick someone else as your partner.', code: 'BAD_PARTNER' });

    const entered = await enteredPlayers(t.id);
    const mine = entered.get(userId);
    if (entryId) {
      // A partner change: my entry in this event, before the draw.
      if (!mine || mine.entry_id !== entryId) return res.status(403).json({ error: 'Only a player of this pair can change the partner.', code: 'NOT_YOUR_ENTRY' });
      if (t.fixtures_generated) return res.status(409).json({ error: 'The draw is made, so the pair can’t change.', code: 'PAIRS_LOCKED' });
    } else if (mine) {
      return res.status(409).json({ error: 'You’re already entered in this event.', code: 'ALREADY_ENTERED' });
    }
    if (!entryId) {
      // Could I enter at all? (closed, drawn, full, my category …) — checked
      // with a stand-in partner where one isn't named yet.
      const probe = await playersRefusal(t, invitee ? [userId, invitee] : [userId], { asOrganiser: false, partial: !invitee });
      if (probe) return res.status(probe.status).json(probe.body);
    } else {
      const probe = await playersRefusal(t, [userId, invitee!], { asOrganiser: false, except: entryId });
      if (probe) return res.status(probe.status).json(probe.body);
    }
    if (invitee && (await isBlockedBetween(userId, invitee))) return res.status(403).json({ error: 'You can’t invite this player.', code: 'BLOCKED' });

    // One live request each (the database's uq_pair_invites_live): a new one replaces my last.
    await supabase.from('tournament_pair_invites').update({ status: 'cancelled', responded_at: new Date().toISOString() })
      .eq('tournament_id', t.id).eq('inviter_id', userId).in('status', ['open', 'pending']);
    const { data: inv, error } = await supabase.from('tournament_pair_invites').insert({
      tournament_id: t.id, inviter_id: userId, invitee_id: open ? null : invitee, entry_id: entryId, status: open ? 'open' : 'pending', note,
    }).select('*').single();
    if (error || !inv) return res.status(500).json({ error: sanitizeError(error) || 'Couldn’t send the invite.' });
    if (!open && invitee) {
      const { data: me } = await supabase.from('users').select('name, username').eq('id', userId).maybeSingle();
      void notifyUnlessBlocked(userId, {
        userId: invitee, type: 'pair_invite', title: 'Partner request',
        body: `${nameOf(me)} wants you as their partner in ${t.name ?? 'a doubles event'}.${note ? ` “${note}”` : ''}`,
        data: { tournamentId: t.id, inviteId: inv.id },
      });
    }
    return res.json({ invite: inv });
  } catch {
    return res.status(500).json({ error: 'Internal server error' });
  }
}

// POST /tournaments/:id/pair-invites/:inviteId/:action — accept | decline | cancel
export async function answerPairInvite(req: Request, res: Response) {
  const userId = req.userId;
  if (!userId) return res.status(401).json({ error: 'Unauthorized' });
  try {
    const action = String(req.params.action);
    if (!['accept', 'decline', 'cancel'].includes(action)) return res.status(404).json({ error: 'Not found' });
    const t = await loadTournament(String(req.params.id));
    if (!t) return res.status(404).json({ error: 'Tournament not found' });
    const inviteId = String(req.params.inviteId);
    if (!isUuid(inviteId)) return res.status(404).json({ error: 'Invite not found' });
    const { data: row } = await supabase.from('tournament_pair_invites').select('*').eq('id', inviteId).eq('tournament_id', t.id).maybeSingle();
    const inv = row as Invite | null;
    if (!inv) return res.status(404).json({ error: 'Invite not found' });
    if (inv.status !== 'pending' && inv.status !== 'open') return res.status(409).json({ error: 'This request isn’t open any more.', code: 'INVITE_CLOSED' });
    const now = new Date().toISOString();

    if (action === 'cancel') {
      if (inv.inviter_id !== userId) return res.status(403).json({ error: 'Only who sent it can cancel it.' });
      await supabase.from('tournament_pair_invites').update({ status: 'cancelled', responded_at: now }).eq('id', inv.id);
      return res.json({ invite: { ...inv, status: 'cancelled' } });
    }
    if (inv.status !== 'pending' || inv.invitee_id !== userId) return res.status(403).json({ error: 'This request isn’t for you.' });
    if (action === 'decline') {
      await supabase.from('tournament_pair_invites').update({ status: 'declined', responded_at: now }).eq('id', inv.id);
      const { data: me } = await supabase.from('users').select('name, username').eq('id', userId).maybeSingle();
      void notifyUnlessBlocked(userId, {
        userId: inv.inviter_id, type: 'pair_declined', title: 'Partner request declined',
        body: `${nameOf(me)} can’t partner you in ${t.name ?? 'the doubles event'}.`, data: { tournamentId: t.id, inviteId: inv.id },
      });
      return res.json({ invite: { ...inv, status: 'declined' } });
    }

    // accept
    syncAfterSuccess(res, () => syncTournamentChatMembers(t.id));
    const ppl = await people([inv.inviter_id, userId]);
    if (inv.entry_id) {
      // Partner change: the invitee takes the place of the inviter's partner.
      const bad = await playersRefusal(t, [inv.inviter_id, userId], { asOrganiser: false, except: inv.entry_id });
      if (bad) return res.status(bad.status).json(bad.body);
      const { data: entry } = await supabase.from('tournament_entries').select('id, team_id, status').eq('id', inv.entry_id).maybeSingle();
      if (!entry || !['pending', 'approved'].includes((entry as { status: string }).status)) return res.status(409).json({ error: 'That entry is no longer in the event.', code: 'INVITE_CLOSED' });
      const teamId = (entry as { team_id: string }).team_id;
      const { data: members } = await supabase.from('team_members').select('user_id').eq('team_id', teamId);
      const old = ((members ?? []) as Array<{ user_id: string }>).map((m) => m.user_id).filter((u) => u !== inv.inviter_id);
      if (old.length) await supabase.from('team_members').delete().eq('team_id', teamId).in('user_id', old);
      await supabase.from('team_members').insert({ team_id: teamId, user_id: userId, role: 'vice_captain' });
      await supabase.from('teams').update({ name: entryTeamName([nameOf(ppl.get(inv.inviter_id)), nameOf(ppl.get(userId))]) }).eq('id', teamId);
      await supabase.from('tournament_pair_invites').update({ status: 'accepted', responded_at: now }).eq('id', inv.id);
      for (const o of old) {
        void notifyUnlessBlocked(inv.inviter_id, {
          userId: o, type: 'partner_changed', title: 'Partner changed',
          body: `${nameOf(ppl.get(inv.inviter_id))} now plays ${t.name ?? 'the doubles event'} with ${nameOf(ppl.get(userId))}.`, data: { tournamentId: t.id },
        });
      }
      void notifyUnlessBlocked(userId, {
        userId: inv.inviter_id, type: 'pair_accepted', title: 'Partner request accepted',
        body: `${nameOf(ppl.get(userId))} is now your partner in ${t.name ?? 'the doubles event'}.`, data: { tournamentId: t.id, entryId: inv.entry_id },
      });
      return res.json({ entry: { id: inv.entry_id, team_id: teamId } });
    }
    const bad = await playersRefusal(t, [inv.inviter_id, userId], { asOrganiser: false });
    if (bad) return res.status(bad.status).json(bad.body);
    const landed = settingsOf(t).entry === 'open' ? 'approved' : 'pending';
    // The inviter captains the pair (they asked); the one accepting is co-captain.
    const made = await makeEntry(t, [inv.inviter_id, userId], landed, inv.inviter_id);
    if (!made.entry) return res.status(500).json({ error: made.error });
    await supabase.from('tournament_pair_invites').update({ status: 'accepted', responded_at: now }).eq('id', inv.id);
    void notifyUnlessBlocked(userId, {
      userId: inv.inviter_id, type: 'pair_accepted', title: 'Partner request accepted',
      body: `${nameOf(ppl.get(userId))} accepted — you’re ${landed === 'approved' ? 'entered' : 'waiting for the organiser'} in ${t.name ?? 'the doubles event'}.`,
      data: { tournamentId: t.id, entryId: String(made.entry.id) },
    });
    void tellOrganiser(t, userId, String((made.entry.team as { name: string }).name), landed, String(made.entry.id));
    return res.json({ entry: made.entry });
  } catch {
    return res.status(500).json({ error: 'Internal server error' });
  }
}

// GET /tournaments/:id/pairs — my entry in this singles / doubles event, the
// partner requests I sent and received, and who is looking for a partner.
export async function getPairs(req: Request, res: Response) {
  const userId = req.userId;
  if (!userId) return res.status(401).json({ error: 'Unauthorized' });
  try {
    const t = await loadTournament(String(req.params.id));
    if (!t) return res.status(404).json({ error: 'Tournament not found' });
    const entered = await enteredPlayers(t.id);
    const mine = entered.get(userId) ?? null;
    let partner: { id: string; name: string } | null = null;
    if (mine && t.entry_kind === 'doubles') {
      const other = [...entered.entries()].find(([u, e]) => u !== userId && e.entry_id === mine.entry_id);
      if (other) { const p = (await people([other[0]])).get(other[0]); partner = { id: other[0], name: nameOf(p) }; }
    }
    // Oct 2026: every open invite (it stopped at 500).
    const rows = await selectAll((f, to) => supabase.from('tournament_pair_invites')
      .select('id, inviter_id, invitee_id, entry_id, status, note, created_at')
      .eq('tournament_id', t.id).in('status', ['open', 'pending'])
      .order('created_at', { ascending: false }).order('id', { ascending: false }).range(f, to));
    const invites = (rows ?? []) as Invite[];
    const ids = [...new Set(invites.flatMap((i) => [i.inviter_id, i.invitee_id]).filter((x): x is string => !!x))];
    const { data: users } = ids.length
      ? await supabase.from('users').select('id, name, username, profile_picture_url, gender').in('id', ids).is('deleted_at', null)
      : { data: [] };
    const u = new Map(((users ?? []) as Array<{ id: string; name: string | null; username: string | null; profile_picture_url: string | null; gender: string | null }>).map((x) => [x.id, x]));
    const card = (id: string | null) => {
      const x = id ? u.get(id) : null;
      return x ? { id: x.id, name: nameOf(x), username: x.username, profile_picture_url: x.profile_picture_url, gender: x.gender } : null;
    };
    const blocked = await blockedUserIds(userId);
    return res.json({
      entry_kind: t.entry_kind,
      my_entry: mine ? { entry_id: mine.entry_id, status: mine.status, team_id: mine.team_id, partner } : null,
      sent: invites.filter((i) => i.inviter_id === userId && i.status === 'pending').map((i) => ({ id: i.id, invitee: card(i.invitee_id), entry_id: i.entry_id, note: i.note, created_at: i.created_at })),
      received: invites.filter((i) => i.invitee_id === userId && i.status === 'pending' && u.has(i.inviter_id) && !blocked.has(i.inviter_id))
        .map((i) => ({ id: i.id, inviter: card(i.inviter_id), entry_id: i.entry_id, note: i.note, created_at: i.created_at })),
      my_open: invites.find((i) => i.inviter_id === userId && i.status === 'open') ? { id: invites.find((i) => i.inviter_id === userId && i.status === 'open')!.id } : null,
      looking: invites.filter((i) => i.status === 'open' && i.inviter_id !== userId && u.has(i.inviter_id) && !blocked.has(i.inviter_id) && !entered.has(i.inviter_id))
        .map((i) => ({ id: i.id, user: card(i.inviter_id), note: i.note, created_at: i.created_at })),
    });
  } catch {
    return res.status(500).json({ error: 'Internal server error' });
  }
}

// GET /tournaments/:id/teams/:teamId/related-entries — badminton gap 6. After a
// retirement (GCR): this entry in this event, and every live entry its players
// have in the tournament's other events, so the organiser can withdraw them.
export async function relatedEntries(req: Request, res: Response) {
  const userId = req.userId;
  if (!userId) return res.status(401).json({ error: 'Unauthorized' });
  try {
    const t = await loadTournament(String(req.params.id));
    const teamId = String(req.params.teamId);
    if (!t || !isUuid(teamId)) return res.status(404).json({ error: 'Not found' });
    if (!(await isTournamentOrganiser(t.id, userId))) return res.status(403).json({ error: 'Only the organiser can see this.' });
    const { data: own } = await supabase.from('tournament_entries').select('id, status').eq('tournament_id', t.id).eq('team_id', teamId).maybeSingle();
    const { data: members } = await supabase.from('team_members').select('user_id').eq('team_id', teamId);
    const players = ((members ?? []) as Array<{ user_id: string }>).map((m) => m.user_id);
    let others: Array<{ tournament_id: string; event_label: string | null; entry_id: string; team_name: string | null; status: string }> = [];
    if (t.parent_id && players.length) {
      const { data: sibs } = await supabase.from('tournaments').select('id, event_label, status').eq('parent_id', t.parent_id).neq('id', t.id).in('status', ['upcoming', 'live']);
      const sib = (sibs ?? []) as Array<{ id: string; event_label: string | null }>;
      if (sib.length) {
        const { data: ents } = await supabase.from('tournament_entries').select('id, tournament_id, team_id, status').in('tournament_id', sib.map((x) => x.id)).in('status', ['pending', 'approved']);
        const rows = (ents ?? []) as Array<{ id: string; tournament_id: string; team_id: string; status: string }>;
        const { data: mem2 } = rows.length ? await supabase.from('team_members').select('team_id, user_id').in('team_id', rows.map((r) => r.team_id)).in('user_id', players) : { data: [] };
        const hit = new Set(((mem2 ?? []) as Array<{ team_id: string }>).map((m) => m.team_id));
        const { data: names } = hit.size ? await supabase.from('teams').select('id, name').in('id', [...hit]) : { data: [] };
        const nameOf = new Map(((names ?? []) as Array<{ id: string; name: string }>).map((x) => [x.id, x.name]));
        const labelOf = new Map(sib.map((x) => [x.id, x.event_label]));
        others = rows.filter((r) => hit.has(r.team_id)).map((r) => ({ tournament_id: r.tournament_id, event_label: labelOf.get(r.tournament_id) ?? null, entry_id: r.id, team_name: nameOf.get(r.team_id) ?? null, status: r.status }));
      }
    }
    return res.json({ this_entry: own && ['pending', 'approved'].includes((own as { status: string }).status) ? { entry_id: (own as { id: string }).id } : null, others });
  } catch {
    return res.status(500).json({ error: 'Internal server error' });
  }
}
