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
import { joinChat, leaveChat } from './chatMembership';
import type { Response } from 'express';
import { supabase } from './supabase';

export interface ChatAudience {
  organisers: Set<string>;
  players: Set<string>;
}

/**
 * Who belongs in the tournament's chat. Returns null if any read failed — a
 * sync must never remove people on the strength of a failed query.
 */
export async function tournamentChatAudience(tournamentId: string): Promise<ChatAudience | null> {
  const [tRes, coRes, entRes] = await Promise.all([
    supabase.from('tournaments').select('created_by').eq('id', tournamentId).maybeSingle(),
    supabase.from('tournament_organisers').select('user_id').eq('tournament_id', tournamentId),
    supabase.from('tournament_entries').select('team_id').eq('tournament_id', tournamentId).eq('status', 'approved'),
  ]);
  if (tRes.error || coRes.error || entRes.error || !tRes.data) return null;
  const organisers = new Set<string>();
  if (tRes.data.created_by) organisers.add(tRes.data.created_by as string);
  for (const r of coRes.data ?? []) organisers.add(r.user_id as string);

  const teamIds = (entRes.data ?? []).map((e) => e.team_id as string).filter(Boolean);
  const players = new Set<string>();
  if (teamIds.length > 0) {
    const { data: members, error } = await supabase.from('team_members').select('user_id').in('team_id', teamIds);
    if (error) return null;
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

/** Pure: what to change so the chat equals the audience. */
export function planChatSync(
  audience: ChatAudience,
  current: Array<{ user_id: string; role: string }>,
): { add: Array<{ user_id: string; role: 'admin' | 'member' }>; promote: string[]; remove: string[] } {
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
  return { add, promote, remove };
}

/** Make the tournament's chat equal its audience. Best-effort; never throws. */
export async function syncTournamentChatMembers(tournamentId: string): Promise<{ added: number; removed: number } | null> {
  try {
    const chatId = await tournamentChatId(tournamentId);
    if (!chatId) return null;
    const audience = await tournamentChatAudience(tournamentId);
    if (!audience) return null;
    const { data: current, error } = await supabase
      .from('chat_participants').select('user_id, role').is('left_at', null).eq('chat_id', chatId);
    if (error) return null;
    const plan = planChatSync(audience, (current ?? []) as Array<{ user_id: string; role: string }>);
    // 098: joining clears left_at on a returning member's row; nobody is deleted.
    if (plan.add.length > 0) await joinChat(chatId, plan.add);
    if (plan.promote.length > 0) {
      await supabase.from('chat_participants').update({ role: 'admin' }).eq('chat_id', chatId).in('user_id', plan.promote);
    }
    if (plan.remove.length > 0) await leaveChat(chatId, plan.remove); // 098: soft leave
    return { added: plan.add.length, removed: plan.remove.length };
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
    const ids = [...new Set((data ?? []).map((e) => e.tournament_id as string))];
    for (const id of ids) await syncTournamentChatMembers(id);
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
