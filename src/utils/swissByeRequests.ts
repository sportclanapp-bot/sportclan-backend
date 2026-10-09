/**
 * Stage 12 follow-up · byes a player asks for in a Swiss (swiss_bye_requests,
 * migration 139). Shared by the desk and the pairing: once a round is paired,
 * the requests still waiting for it can't be met — they're declined and the
 * players told.
 */
import { supabase } from './supabase';
import { notifyUsers } from './notify';

export type ByeKind = 'half' | 'zero' | 'absent';
export const byeWords = (k: ByeKind): string => (k === 'half' ? 'a half-point bye' : k === 'zero' ? 'a zero-point bye' : 'to be absent');

/** The players of an entry (a singles entry: the player; a team: its members). */
export async function entryPlayers(teamId: string): Promise<string[]> {
  const { data } = await supabase.from('team_members').select('user_id').eq('team_id', teamId);
  return ((data ?? []) as Array<{ user_id: string }>).map((r) => r.user_id);
}

/** Decline what's still waiting for rounds up to `round` (now paired), and tell the players. */
export async function declineStaleByeRequests(tournamentId: string, round: number): Promise<number> {
  const { data } = await supabase.from('swiss_bye_requests')
    .update({ status: 'declined', note: 'The round was paired before a decision.', decided_at: new Date().toISOString() })
    .eq('tournament_id', tournamentId).eq('status', 'pending').lte('round', round)
    .select('id, team_id, round, kind');
  const rows = (data ?? []) as Array<{ team_id: string; round: number; kind: ByeKind }>;
  for (const r of rows) {
    await notifyUsers(await entryPlayers(r.team_id), {
      type: 'tournament', title: `No bye in round ${r.round}`,
      body: `Round ${r.round} was paired before your request for ${byeWords(r.kind)} was decided — check your pairing.`,
      data: { tournamentId },
    }).catch(() => undefined);
  }
  return rows.length;
}
