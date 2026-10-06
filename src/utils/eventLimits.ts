/**
 * Badminton gap 3 (Oct 2026) · how many of a tournament's events a player may
 * enter. BAI Masters allows one singles, one doubles and one mixed doubles; a
 * local open often says "at most 2 events". Set on the tournament (the parent,
 * settings.eventLimits); checked whenever a player — alone, in a pair or on a
 * team — enters one of its events.
 */
import { selectAllIn } from './selectAll';
import { supabase } from './supabase';
import { isCount } from './validation';

export type EventClass = 'singles' | 'doubles' | 'mixed' | 'team';
export type EventLimits = { total?: number | null; singles?: number | null; doubles?: number | null; mixed?: number | null };
const KEYS = ['total', 'singles', 'doubles', 'mixed'] as const;

/** Which kind of event this is, for the limits: singles, doubles, mixed doubles, or a team event. */
export function eventClass(e: { entry_kind?: string | null; settings?: unknown }): EventClass {
  if (e.entry_kind === 'singles') return 'singles';
  if (e.entry_kind === 'doubles') {
    const g = ((e.settings as { category?: { gender?: string } } | null)?.category?.gender) ?? null;
    return g === 'mixed' ? 'mixed' : 'doubles';
  }
  return 'team';
}

export function eventLimitsRefusal(raw: unknown): { error: string; code: string } | null {
  if (raw === undefined || raw === null) return null;
  if (typeof raw !== 'object' || Array.isArray(raw)) return { error: 'Event limits are numbers per kind of event.', code: 'BAD_EVENT_LIMITS' };
  for (const [k, v] of Object.entries(raw as Record<string, unknown>)) {
    if (!(KEYS as readonly string[]).includes(k)) return { error: `Unknown event limit: ${k}.`, code: 'BAD_EVENT_LIMITS' };
    if (v === null) continue;
    // The organiser's own limit: optional (blank = none), at least 1 (Oct 2026: no top).
    if (!isCount(v, 1)) {
      return { error: 'An event limit is 1 or more, or blank for none.', code: 'BAD_EVENT_LIMITS' };
    }
  }
  return null;
}

/** Only the limits that are set (null when none). */
export function storedEventLimits(raw: unknown): EventLimits | null {
  if (!raw || typeof raw !== 'object') return null;
  const out: EventLimits = {};
  for (const k of KEYS) {
    const v = (raw as Record<string, unknown>)[k];
    if (Number.isInteger(v)) out[k] = v as number;
  }
  return Object.keys(out).length ? out : null;
}

export function limitsOf(settings: unknown): EventLimits | null {
  return storedEventLimits((settings as { eventLimits?: unknown } | null)?.eventLimits);
}

const WORD: Record<EventClass, string> = { singles: 'singles', doubles: 'doubles', mixed: 'mixed doubles', team: 'team' };

/** "Up to 1 singles, 1 doubles and 1 mixed doubles event · 2 events in all, per player" — or null. */
export function limitsLine(l: EventLimits | null): string | null {
  if (!l) return null;
  const parts = (['singles', 'doubles', 'mixed'] as const).filter((k) => l[k] != null).map((k) => `${l[k]} ${WORD[k]}`);
  const kinds = parts.length > 1 ? `${parts.slice(0, -1).join(', ')} and ${parts[parts.length - 1]} event${parts.length ? 's' : ''}` : parts.length ? `${parts[0]} event${parts[0]!.startsWith('1 ') ? '' : 's'}` : null;
  const total = l.total != null ? `${l.total} event${l.total === 1 ? '' : 's'} in all` : null;
  const body = [kinds, total].filter(Boolean).join(' · ');
  return body ? `Up to ${body}, per player` : null;
}

/**
 * Would entering this event take one of these players past the tournament's
 * limits? Counts each player's live entries (pending or approved) in the
 * tournament's other events.
 */
export async function eventLimitRefusal(
  t: { id: string; parent_id: string | null; entry_kind?: string | null; settings?: unknown },
  userIds: string[],
  people: Map<string, { name?: string | null; username?: string | null } | unknown>,
  _except: string | null,
): Promise<{ status: number; body: { error: string; code: string; user_id?: string } } | null> {
  if (!t.parent_id || userIds.length === 0) return null;
  const { data: parent } = await supabase.from('tournaments').select('settings').eq('id', t.parent_id).maybeSingle();
  const limits = limitsOf((parent as { settings?: unknown } | null)?.settings);
  if (!limits) return null;
  const { data: sibs } = await supabase.from('tournaments').select('id, entry_kind, settings, status').eq('parent_id', t.parent_id).neq('id', t.id);
  const events = ((sibs ?? []) as Array<{ id: string; entry_kind: string | null; settings: unknown; status: string }>).filter((e) => e.status !== 'cancelled');
  if (events.length === 0) return null;
  const classOf = new Map(events.map((e) => [e.id, eventClass(e)]));
  const entries = await selectAllIn(events.map((e) => e.id), (c, f, to) => supabase.from('tournament_entries').select('tournament_id, team_id')
    .in('tournament_id', c).in('status', ['pending', 'approved']).order('id').range(f, to));
  const rows = (entries ?? []) as Array<{ tournament_id: string; team_id: string }>;
  if (rows.length === 0) return null;
  const members = await selectAllIn([...new Set(rows.map((r) => r.team_id))], (c, f, to) => supabase.from('team_members').select('team_id, user_id')
    .in('team_id', c).in('user_id', userIds).order('id').range(f, to));
  const eventsOfTeam = new Map<string, string[]>();
  for (const r of rows) eventsOfTeam.set(r.team_id, [...(eventsOfTeam.get(r.team_id) ?? []), r.tournament_id]);
  const mine = eventClass(t);
  for (const u of userIds) {
    const evIds = new Set(((members ?? []) as Array<{ team_id: string; user_id: string }>).filter((m) => m.user_id === u).flatMap((m) => eventsOfTeam.get(m.team_id) ?? []));
    const p = people.get(u) as { name?: string | null; username?: string | null } | undefined;
    const name = (p?.name || p?.username || 'A player').trim();
    if (limits.total != null && evIds.size >= limits.total) {
      return { status: 409, body: { error: `${name} is already in ${evIds.size} event${evIds.size === 1 ? '' : 's'} — this tournament allows ${limits.total} per player.`, code: 'EVENT_LIMIT', user_id: u } };
    }
    const lim = mine !== 'team' ? limits[mine] : null;
    if (lim != null) {
      const same = [...evIds].filter((id) => classOf.get(id) === mine).length;
      if (same >= lim) {
        return { status: 409, body: { error: `${name} is already in ${same} ${WORD[mine]} event${same === 1 ? '' : 's'} — this tournament allows ${lim} per player.`, code: 'EVENT_LIMIT', user_id: u } };
      }
    }
  }
  return null;
}
