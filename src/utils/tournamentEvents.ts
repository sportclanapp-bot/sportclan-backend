/**
 * Badminton gap 1 (Oct 2026) · events inside a tournament.
 *
 * A badminton open is one tournament with several events: men's singles,
 * women's doubles, U-15 mixed … Each event is a tournament row with
 * `parent_id` set, so it keeps everything a tournament has (format, category,
 * rules, seeds, entries, fixtures, standings). The parent (`is_parent`) holds
 * what the events share — venue, dates, courts, schedule, officials, organisers
 * and the chat — and has no entries or fixtures of its own.
 *
 * Built for every sport, not just badminton. Older apps never see a parent:
 * the list shows them each event as its own tournament, named
 * "Parent · Event", which they can open, follow and score as today.
 *
 * Gap 2: `entry_kind` says who enters — a team (as today), one player
 * (singles) or a pair (doubles).
 */
import type { Request } from 'express';
import { supabase } from './supabase';
import { LIMITS } from './validation';
import { sportKeyOf } from './tournamentSettings';
import type { TournamentStatus } from './tournamentStatus';

export const EVENTS_MAX = 40;
export const EVENT_LABEL_MAX = 60;
export const ENTRY_KINDS = ['team', 'singles', 'doubles'] as const;
export type EntryKind = typeof ENTRY_KINDS[number];

/**
 * What the events share. Set on the tournament (the parent) and copied to every
 * event, at creation and on every edit of the parent. An event can't change
 * them on its own.
 */
export const SHARED_KEYS = [
  'city_id', 'city', 'venue', 'start_date', 'end_date', 'registration_deadline',
  'daily_start_time', 'daily_end_time', 'match_duration_minutes', 'buffer_minutes',
  'ground_count', 'ground_names', 'organiser_name', 'organiser_mobile',
  'sponsor_name', 'sponsor_logo_url', 'banner_url', 'logo_url', 'description',
] as const;

/** What each event sets for itself (beside its label and entry kind). */
export const EVENT_KEYS = [
  'format', 'max_teams', 'entry_fee', 'prize_pool', 'settings', 'match_rules',
  'tiebreaker_rules', 'num_groups', 'group_size', 'qualifiers_per_group', 'home_away',
] as const;

/**
 * Who can enter as one player or a pair, by sport. Team sports enter as teams
 * only. Chess is one player a side; carrom, and the racket sports, play singles
 * and doubles.
 */
export function entryKindsFor(sport: string | null | undefined): EntryKind[] {
  switch (sportKeyOf(sport)) {
    case 'badminton': case 'tennis': case 'tabletennis': case 'pickleball': case 'carrom':
      return ['team', 'singles', 'doubles'];
    case 'chess':
      return ['team', 'singles'];
    default:
      return ['team'];
  }
}

export type Refusal = { error: string; code: string };

export function entryKindRefusal(sport: string | null | undefined, kind: unknown): Refusal | null {
  if (kind === undefined || kind === null) return null;
  if (typeof kind !== 'string' || !(ENTRY_KINDS as readonly string[]).includes(kind)) {
    return { error: 'Entries are by team, one player (singles) or a pair (doubles).', code: 'BAD_ENTRY_KIND' };
  }
  if (!entryKindsFor(sport).includes(kind as EntryKind)) {
    return { error: kind === 'doubles' ? 'This sport has no doubles events.' : 'This sport is entered by teams only.', code: 'BAD_ENTRY_KIND' };
  }
  return null;
}

export function eventLabelRefusal(label: unknown): Refusal | null {
  if (typeof label !== 'string' || label.trim().length < 1) return { error: 'Give each event a name, like Men’s singles.', code: 'BAD_EVENT_LABEL' };
  if (label.trim().length > EVENT_LABEL_MAX) return { error: `An event’s name is up to ${EVENT_LABEL_MAX} characters.`, code: 'BAD_EVENT_LABEL' };
  return null;
}

/** The events list on a create (or "add events"): 1 to 40, each named once. */
export function eventsListRefusal(events: unknown, existingLabels: string[] = []): Refusal | null {
  if (!Array.isArray(events) || events.length === 0) return { error: 'Add at least one event.', code: 'BAD_EVENTS' };
  if (events.length + existingLabels.length > EVENTS_MAX) return { error: `A tournament has up to ${EVENTS_MAX} events.`, code: 'BAD_EVENTS' };
  const seen = new Set(existingLabels.map((l) => l.trim().toLowerCase()));
  for (const e of events) {
    if (!e || typeof e !== 'object' || Array.isArray(e)) return { error: 'Each event needs its details.', code: 'BAD_EVENTS' };
    const bad = eventLabelRefusal((e as { label?: unknown }).label);
    if (bad) return bad;
    const key = String((e as { label: string }).label).trim().toLowerCase();
    if (seen.has(key)) return { error: `There are two events called ${String((e as { label: string }).label).trim()}.`, code: 'DUPLICATE_EVENT' };
    seen.add(key);
  }
  return null;
}

/** "Sunday Open · Men's singles", cut to fit the name column. */
export function eventName(parentName: string, label: string): string {
  const tail = ` · ${label.trim()}`;
  const room = LIMITS.tournamentNameMax - tail.length;
  const head = parentName.trim();
  return (head.length > room ? `${head.slice(0, Math.max(1, room - 1)).trimEnd()}…` : head) + tail;
}

/**
 * The parent's status from its events: cancelled when every event is; finished
 * when every event is finished or cancelled (and one finished); live once any
 * event is live or finished; otherwise upcoming. No events → as it is.
 */
export function parentStatusOf(events: Array<{ status?: string | null }>, current: TournamentStatus): TournamentStatus {
  if (events.length === 0) return current;
  const s = events.map((e) => e.status ?? 'upcoming');
  if (s.every((x) => x === 'cancelled')) return 'cancelled';
  if (s.every((x) => x === 'completed' || x === 'cancelled')) return 'completed';
  if (s.some((x) => x === 'live' || x === 'completed')) return 'live';
  return 'upcoming';
}

/**
 * Does this request come from an app that knows about events? The app sends
 * `X-Client-Features: events` (and more, comma separated). Older apps don't.
 */
export function clientHas(req: Request | { headers?: Record<string, unknown> }, feature: string): boolean {
  const raw = (req.headers ?? {})['x-client-features'];
  const s = Array.isArray(raw) ? raw.join(',') : typeof raw === 'string' ? raw : '';
  return s.split(',').map((x) => x.trim().toLowerCase()).includes(feature);
}

export type FamilyRow = { id: string; parent_id: string | null; is_parent: boolean | null };

/** The tournament a row belongs to for shared things: its parent, or itself. */
export function rootIdOf(t: { id: string; parent_id?: string | null }): string {
  return t.parent_id || t.id;
}

/** This tournament and, for an event, its parent: where officials and organisers are kept. */
export async function familyLookupIds(tournamentId: string): Promise<string[]> {
  const { data } = await supabase.from('tournaments').select('id, parent_id').eq('id', tournamentId).maybeSingle();
  const parent = (data as { parent_id?: string | null } | null)?.parent_id;
  return parent ? [tournamentId, parent] : [tournamentId];
}

/** Every tournament id in the family of this one: the parent and all its events. */
export async function familyIds(tournamentId: string): Promise<string[]> {
  const { data } = await supabase.from('tournaments').select('id, parent_id, is_parent').eq('id', tournamentId).maybeSingle();
  const row = data as FamilyRow | null;
  if (!row) return [tournamentId];
  const root = row.parent_id || (row.is_parent ? row.id : null);
  if (!root) return [tournamentId];
  const { data: events } = await supabase.from('tournaments').select('id').eq('parent_id', root);
  return [root, ...((events ?? []) as Array<{ id: string }>).map((e) => e.id)];
}

/** Bring a parent's status in line with its events. Best-effort; returns the status. */
export async function refreshParentStatus(parentId: string): Promise<TournamentStatus | null> {
  try {
    const [{ data: parent }, { data: events }] = await Promise.all([
      supabase.from('tournaments').select('id, status, is_parent').eq('id', parentId).maybeSingle(),
      supabase.from('tournaments').select('status').eq('parent_id', parentId),
    ]);
    if (!parent || !(parent as { is_parent?: boolean }).is_parent) return null;
    const current = (parent as { status: TournamentStatus }).status;
    const next = parentStatusOf((events ?? []) as Array<{ status: string }>, current);
    if (next !== current) {
      await supabase.from('tournaments').update({ status: next, updated_at: new Date().toISOString() }).eq('id', parentId);
    }
    return next;
  } catch {
    return null;
  }
}

/** An event changed status: its parent follows. Best-effort, never throws. */
export async function refreshParentOf(tournamentId: string): Promise<void> {
  try {
    const { data } = await supabase.from('tournaments').select('parent_id').eq('id', tournamentId).maybeSingle();
    const p = (data as { parent_id?: string | null } | null)?.parent_id;
    if (p) await refreshParentStatus(p);
  } catch { /* best-effort */ }
}

export const EVENT_SUMMARY_COLS = 'id, name, event_label, event_order, entry_kind, format, status, max_teams, entry_fee, entry_code, settings, match_rules, fixtures_generated, champion_team_id';

/** A parent's events in their order, each with its approved-entry count. */
export async function eventsOf(parentId: string): Promise<Array<Record<string, unknown>>> {
  const { data } = await supabase
    .from('tournaments')
    .select(EVENT_SUMMARY_COLS)
    .eq('parent_id', parentId)
    .order('event_order', { ascending: true })
    .order('created_at', { ascending: true });
  const events = (data ?? []) as Array<Record<string, unknown>>;
  if (events.length === 0) return events;
  const { data: entries } = await supabase
    .from('tournament_entries')
    .select('tournament_id, status')
    .in('tournament_id', events.map((e) => e.id as string))
    .in('status', ['pending', 'approved']);
  const approved = new Map<string, number>();
  const pending = new Map<string, number>();
  for (const r of (entries ?? []) as Array<{ tournament_id: string; status: string }>) {
    const m = r.status === 'approved' ? approved : pending;
    m.set(r.tournament_id, (m.get(r.tournament_id) ?? 0) + 1);
  }
  return events.map((e) => ({ ...e, entries_count: approved.get(e.id as string) ?? 0, pending_count: pending.get(e.id as string) ?? 0 }));
}

/** The refusal for entering a parent directly (an older app, or a stale link). */
export const ENTER_AN_EVENT: Refusal = {
  error: 'This tournament is made of events. Update SportClan to enter one of them.',
  code: 'ENTER_AN_EVENT',
};

const TIME_RE = /^\d{2}:\d{2}(:\d{2})?$/;
/** Is an edit's value for a shared key the same as the tournament's? (Older apps send them back unchanged.) */
export function sameSharedValue(key: string, a: unknown, b: unknown): boolean {
  const norm = (v: unknown): string => {
    if (v === undefined || v === null || v === '') return '';
    if (Array.isArray(v)) return JSON.stringify(v.map((x) => String(x)));
    const s = String(v);
    if ((key === 'daily_start_time' || key === 'daily_end_time') && TIME_RE.test(s)) return s.slice(0, 5);
    if ((key === 'start_date' || key === 'end_date') && /^\d{4}-\d{2}-\d{2}/.test(s)) return s.slice(0, 10);
    if (key === 'registration_deadline' && Number.isFinite(Date.parse(s))) return String(Date.parse(s));
    return s;
  };
  return norm(a) === norm(b);
}

/** The tournament that keeps shared things (officials, organisers) for this one: its parent, or itself. */
export async function rootTournamentId(tournamentId: string): Promise<string> {
  try {
    const { data } = await supabase.from('tournaments').select('parent_id').eq('id', tournamentId).maybeSingle();
    return (data as { parent_id?: string | null } | null)?.parent_id || tournamentId;
  } catch {
    return tournamentId;
  }
}
