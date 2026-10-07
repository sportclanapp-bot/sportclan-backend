/**
 * Stage 9 · T13 (Oct 2026) · a full event's waitlist, every sport.
 * Entries made when the event is full wait as 'waitlisted' in the order they
 * came (entered_at; migration 130). When a place frees — an entry withdraws or
 * is refused, or the organiser makes the draw bigger — the first ones move up:
 * straight in for an open event, else to the organiser's approval. Each is
 * told. Never after the draw (the fixtures are made).
 */
import { supabase } from './supabase';
import { notifyUsers } from './notify';
import { settingsOf } from './tournamentSettings';

const PAGE = 500;

/** Move waiting entries up into the free places; returns the entry ids moved. Best-effort. */
export async function promoteWaitlist(tournamentId: string): Promise<string[]> {
  const { data: t } = await supabase.from('tournaments').select('id, name, max_teams, fixtures_generated, status, settings')
    .eq('id', tournamentId).maybeSingle();
  if (!t || (t as { fixtures_generated?: boolean }).fixtures_generated) return [];
  const status = (t as { status?: string }).status;
  if (status === 'completed' || status === 'cancelled') return [];
  const max = (t as { max_teams?: number | null }).max_teams ?? null;
  let free = Infinity;
  if (max != null) {
    const { count } = await supabase.from('tournament_entries').select('id', { count: 'exact', head: true })
      .eq('tournament_id', tournamentId).in('status', ['pending', 'approved']);
    free = max - (count ?? 0);
  }
  if (free <= 0) return [];
  const landing = settingsOf(t as { settings?: unknown }).entry === 'open' ? 'approved' : 'pending';
  const moved: Array<{ id: string; team_id: string }> = [];
  // The first in line, a page at a time (no top on how many wait).
  while (free > 0) {
    const take = Number.isFinite(free) ? Math.min(PAGE, free) : PAGE;
    const { data: next } = await supabase.from('tournament_entries').select('id, team_id')
      .eq('tournament_id', tournamentId).eq('status', 'waitlisted')
      .order('entered_at', { ascending: true }).order('id', { ascending: true }).range(0, take - 1);
    const rows = (next ?? []) as Array<{ id: string; team_id: string }>;
    if (rows.length === 0) break;
    for (const r of rows) {
      // Only if still waiting (two promotions at once can't move it twice).
      const { data: up } = await supabase.from('tournament_entries').update({ status: landing })
        .eq('id', r.id).eq('status', 'waitlisted').select('id').maybeSingle();
      if (up) { moved.push(r); free -= 1; }
      if (free <= 0) break;
    }
    if (rows.length < take) break;
  }
  if (moved.length) {
    const { data: members } = await supabase.from('team_members').select('team_id, user_id').in('team_id', moved.map((m) => m.team_id));
    const people = [...new Set(((members ?? []) as Array<{ user_id: string | null }>).map((m) => m.user_id).filter((x): x is string => !!x))];
    const name = (t as { name?: string }).name ?? 'the tournament';
    void notifyUsers(people, {
      type: 'waitlist_in',
      title: landing === 'approved' ? `You’re in · ${name}` : `Off the waitlist · ${name}`,
      body: landing === 'approved' ? 'A place opened and your entry moved up from the waitlist.' : 'A place opened: your entry moved up from the waitlist and waits for the organiser’s approval.',
      data: { tournamentId },
    });
  }
  return moved.map((m) => m.id);
}
