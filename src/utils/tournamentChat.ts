/**
 * Visual review B02 · a tournament's chat holds its people, and only them.
 *
 * V022: "S5 Group Cup Chat" had ONE member, the organiser. createTournament
 * added only the creator, and the only other way in was GET /tournaments/:id/chat,
 * which added whoever called it — so the players of the entered teams were never
 * in their own tournament's chat.
 *
 * N2 (found while tracing V022): that same endpoint added ANY signed-in caller,
 * so anyone with a tournament id could read its chat.
 *
 * Decision D7: the chat is every organiser (creator + co-organisers, as admins)
 * plus every rostered player of an APPROVED team. People are added when their
 * team is approved or they join it, and removed when their team withdraws, is
 * rejected, or they leave it.
 *
 * Membership is recomputed rather than patched: every trigger calls one sync
 * that makes the chat equal the audience. A missed trigger is then corrected by
 * the next one, and the sync is idempotent.
 */
import { selectAllIn } from './selectAll';
import { joinChat, leaveChat } from './chatMembership';
import type { Response } from 'express';
import { supabase } from './supabase';
import { familyIds, rootTournamentId } from './tournamentEvents';

export interface ChatAudience {
  organisers: Set<string>;
  players: Set<string>;
}

/**
 * Who belongs in the tournament's chat. Returns null if any read failed — a
 * sync must never remove people on the strength of a failed query.
 */
export async function tournamentChatAudience(tournamentId: string): Promise<ChatAudience | null> {
  // Badminton gap 1: one chat for a tournament and all its events — its
  // organisers and the players of every event.
  const ids = await familyIds(tournamentId);
  const [tRes, coRes, entRes] = await Promise.all([
    supabase.from('tournaments').select('created_by').eq('id', tournamentId).maybeSingle(),
    supabase.from('tournament_organisers').select('user_id').in('tournament_id', ids),
    selectAllIn(ids, (c, f, to) => supabase.from('tournament_entries').select('team_id').in('tournament_id', c).eq('status', 'approved').order('id').range(f, to))
      .then((data) => ({ data, error: null }), (error: unknown) => ({ data: null, error })),
  ]);
  if (tRes.error || coRes.error || entRes.error || !tRes.data) return null;
  const organisers = new Set<string>();
  if (tRes.data.created_by) organisers.add(tRes.data.created_by as string);
  for (const r of coRes.data ?? []) organisers.add(r.user_id as string);

  const teamIds = (entRes.data ?? []).map((e) => e.team_id as string).filter(Boolean);
  const players = new Set<string>();
  if (teamIds.length > 0) {
    // Oct 2026: every member of every team (no caps), read in chunks.
    let members: Array<{ user_id: string }>;
    try { members = await selectAllIn(teamIds, (c, f, to) => supabase.from('team_members').select('user_id').in('team_id', c).order('id').range(f, to)); } catch { return null; }
    for (const m of members ?? []) players.add(m.user_id as string);
  }
  return { organisers, players };
}

/** The chat id stored on the tournament (sport_metadata._chat_id), if any. */
export async function tournamentChatId(tournamentId: string): Promise<string | null> {
  const { data } = await supabase.from('tournaments').select('sport_metadata').eq('id', tournamentId).maybeSingle();
  const meta = (data?.sport_metadata as Record<string, unknown> | null) ?? {};
  return typeof meta._chat_id === 'string' ? meta._chat_id : null;
}

/**
 * Pure: what to change so the chat equals the audience. E-128 (Round 6): the admins too — only the
 * organisers are admins (D7), so an admin who isn't one any more (a removed co-organiser who still
 * plays, the creator before a reassign, a player made admin when the organiser left) is made a
 * member again. It only ever promoted.
 */
export function planChatSync(
  audience: ChatAudience,
  current: Array<{ user_id: string; role: string }>,
): { add: Array<{ user_id: string; role: 'admin' | 'member' }>; promote: string[]; demote: string[]; remove: string[] } {
  const want = new Map<string, 'admin' | 'member'>();
  for (const u of audience.players) want.set(u, 'member');
  for (const u of audience.organisers) want.set(u, 'admin'); // organiser wins over player
  const have = new Map(current.map((c) => [c.user_id, c.role]));
  const add: Array<{ user_id: string; role: 'admin' | 'member' }> = [];
  const promote: string[] = [];
  for (const [u, role] of want) {
    if (!have.has(u)) add.push({ user_id: u, role });
    else if (role === 'admin' && have.get(u) !== 'admin') promote.push(u);
  }
  const remove = current.map((c) => c.user_id).filter((u) => !want.has(u));
  const demote = current.filter((c) => c.role === 'admin' && want.get(c.user_id) === 'member').map((c) => c.user_id);
  return { add, promote, demote, remove };
}

/**
 * E-079 (Round 6): the chats of a tournament made of events. Its one chat is the tournament's (the
 * parent's), but every trigger synced the chat of the id it was called with — an event's own, which
 * normally doesn't exist — so approving, withdrawing or rejecting in an event left the tournament's
 * chat as it was. Opening the chat from an event's page also made a second chat for that event; any
 * such chat (made before this fix) is kept in step too.
 */
async function familyChatIds(rootId: string): Promise<string[]> {
  const ids = await familyIds(rootId);
  const { data } = await supabase.from('tournaments').select('id, sport_metadata').in('id', ids);
  const rows = (data ?? []) as Array<{ id: string; sport_metadata: Record<string, unknown> | null }>;
  // The tournament's own chat first.
  rows.sort((a, b) => (a.id === rootId ? -1 : b.id === rootId ? 1 : 0));
  const chats = rows.map((r) => r.sport_metadata?._chat_id).filter((c): c is string => typeof c === 'string');
  return [...new Set(chats)];
}

/** Make the tournament's chat equal its audience. Best-effort; never throws. */
export async function syncTournamentChatMembers(tournamentId: string): Promise<{ added: number; removed: number } | null> {
  try {
    const rootId = await rootTournamentId(tournamentId); // E-079: an event's chat is its tournament's
    const chatIds = await familyChatIds(rootId);
    if (chatIds.length === 0) return null;
    const audience = await tournamentChatAudience(rootId);
    if (!audience) return null;
    let added = 0; let removed = 0;
    for (const chatId of chatIds) {
      const { data: current, error } = await supabase
        .from('chat_participants').select('user_id, role').is('left_at', null).eq('chat_id', chatId);
      if (error) return null;
      const plan = planChatSync(audience, (current ?? []) as Array<{ user_id: string; role: string }>);
      // 098: joining clears left_at on a returning member's row; nobody is deleted.
      if (plan.add.length > 0) await joinChat(chatId, plan.add);
      if (plan.promote.length > 0) {
        await supabase.from('chat_participants').update({ role: 'admin' }).eq('chat_id', chatId).in('user_id', plan.promote);
      }
      if (plan.demote.length > 0) {
        await supabase.from('chat_participants').update({ role: 'member' }).eq('chat_id', chatId).in('user_id', plan.demote);
      }
      if (plan.remove.length > 0) await leaveChat(chatId, plan.remove); // 098: soft leave
      added += plan.add.length; removed += plan.remove.length;
    }
    return { added, removed };
  } catch (e) {
    // eslint-disable-next-line no-console
    console.error('[tournament-chat] sync failed', tournamentId, e instanceof Error ? e.message : e);
    return null;
  }
}

/** A team's roster changed: re-sync the chat of every tournament it is approved in. */
export async function syncTournamentChatsForTeam(teamId: string): Promise<void> {
  try {
    const { data } = await supabase
      .from('tournament_entries').select('tournament_id').eq('team_id', teamId).eq('status', 'approved');
    // E-079: an entry in an event syncs its tournament's chat, once per tournament.
    const roots = await Promise.all([...new Set((data ?? []).map((e) => e.tournament_id as string))].map((id) => rootTournamentId(id)));
    for (const id of new Set(roots)) await syncTournamentChatMembers(id);
  } catch { /* best-effort */ }
}

/**
 * Run a sync once the response has gone out successfully. Used on handlers with
 * several success returns, so no early return can skip it; a failed request
 * changes nothing and so syncs nothing.
 */
export function syncAfterSuccess(res: Response, run: () => Promise<unknown>): void {
  res.once('finish', () => {
    if (res.statusCode < 300) void run();
  });
}

/** N2: may this user open the tournament's chat? Organisers and approved players only. */
export async function canOpenTournamentChat(tournamentId: string, userId: string): Promise<boolean> {
  const audience = await tournamentChatAudience(tournamentId);
  if (!audience) return false;
  return audience.organisers.has(userId) || audience.players.has(userId);
}
