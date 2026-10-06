/**
 * Badminton gap 3 · one schedule over a tournament's shared courts.
 *
 * Each event is drawn on its own, but its events share the venue's courts and
 * its players: the same player is often in singles, doubles and mixed. When an
 * event's fixtures are timed, the courts its sibling events already hold are
 * taken, and each player's matches in those events are kept apart (with the
 * event's rest between them), per player, not per team.
 */
import { supabase } from './supabase';
import { absMinutesOf } from './scheduleFixtures';

export async function sharedScheduleFor(
  t: { id: string; parent_id?: string | null },
  ownTeamIds: string[],
  startYmd: string,
  durationMin: number,
): Promise<{ busyGrounds: Array<{ ground: string; start: number; end: number }>; playersOf: Map<string, string[]>; playerBusy: Map<string, Array<[number, number]>> } | null> {
  if (!t.parent_id) return null;
  const { data: sibs } = await supabase.from('tournaments').select('id, match_duration_minutes').eq('parent_id', t.parent_id).neq('id', t.id);
  const siblings = (sibs ?? []) as Array<{ id: string; match_duration_minutes: number | null }>;
  const durOf = new Map(siblings.map((x) => [x.id, Math.max(1, Number(x.match_duration_minutes ?? durationMin) || durationMin)]));
  const matches = siblings.length
    ? ((await supabase.from('matches')
      .select('tournament_id, scheduled_at, ground_label, team_a_id, team_b_id, status, voided_at')
      .in('tournament_id', siblings.map((x) => x.id))
      .not('scheduled_at', 'is', null)).data ?? []) as Array<{ tournament_id: string; scheduled_at: string; ground_label: string | null; team_a_id: string | null; team_b_id: string | null; status: string; voided_at: string | null }>
    : [];
  const live = matches.filter((m) => !m.voided_at && m.status !== 'cancelled' && m.status !== 'completed' && m.status !== 'abandoned');
  const teamIds = [...new Set([...ownTeamIds, ...live.flatMap((m) => [m.team_a_id, m.team_b_id]).filter((x): x is string => !!x)])];
  const playersOf = new Map<string, string[]>();
  if (teamIds.length) {
    const { data: members } = await supabase.from('team_members').select('team_id, user_id').in('team_id', teamIds);
    for (const r of (members ?? []) as Array<{ team_id: string; user_id: string }>) playersOf.set(r.team_id, [...(playersOf.get(r.team_id) ?? []), r.user_id]);
  }
  const busyGrounds: Array<{ ground: string; start: number; end: number }> = [];
  const playerBusy = new Map<string, Array<[number, number]>>();
  for (const m of live) {
    const start = absMinutesOf(m.scheduled_at, startYmd);
    const end = start + (durOf.get(m.tournament_id) ?? durationMin);
    if (m.ground_label) busyGrounds.push({ ground: m.ground_label, start, end });
    for (const tid of [m.team_a_id, m.team_b_id]) {
      for (const p of (tid && playersOf.get(tid)) || []) playerBusy.set(p, [...(playerBusy.get(p) ?? []), [start, end]]);
    }
  }
  return { busyGrounds, playersOf, playerBusy };
}
