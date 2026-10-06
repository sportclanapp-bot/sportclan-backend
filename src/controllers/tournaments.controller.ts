import { selectAll } from '../utils/selectAll';
import { TEAM_DISBANDED, isTeamDisbanded } from '../utils/teamVisibility';
import { hideTestFor, excludeTest } from '../utils/testContent';
import { syncTournamentChatMembers, syncAfterSuccess, canOpenTournamentChat } from '../utils/tournamentChat';
import { isTeamManager } from '../utils/teamAuth';
import { Request, Response } from 'express';
import { supabase } from '../utils/supabase';
import { statusAfterFixtures, shouldGoLive } from '../utils/tournamentStatus';

/**
 * F-52 · the other half: something has to start the tournament on the day.
 *
 * With the draw no longer flipping the status, an `upcoming` tournament would
 * sit at `upcoming` for ever. This is the hourly tick that starts it — on the
 * EXISTING in-process scheduler, beside the match sweepers, so no new Render
 * service is needed (decision D2).
 *
 * Only tournaments that have fixtures: a cup whose draw was never made is not
 * live, it is unstarted, and flipping it would swap one wrong badge for
 * another. Idempotent — the `.eq('status', 'upcoming')` on the write means a
 * second instance on the same tick, or an overlapping run, changes nothing.
 */
export async function sweepTournamentsDue(): Promise<{ started: number }> {
  const today = new Date().toISOString().slice(0, 10);
  const { data: due } = await supabase
    .from('tournaments')
    .select('id, status, start_date')
    .eq('status', 'upcoming')
    .not('start_date', 'is', null)
    .lte('start_date', today)
    .limit(200);

  let started = 0;
  for (const t of (due ?? []) as { id: string; status: string; start_date: string | null }[]) {
    const { count } = await supabase
      .from('matches')
      .select('id', { count: 'exact', head: true })
      .eq('tournament_id', t.id);
    if (!shouldGoLive(t, (count ?? 0) > 0)) continue;
    const { error } = await supabase
      .from('tournaments')
      .update({ status: 'live' })
      .eq('id', t.id)
      .eq('status', 'upcoming');
    if (!error) { started += 1; await refreshParentOf(t.id); } // badminton gap 1
  }
  return { started };
}

import { resolveSportId } from '../utils/sportId';
import { parsePagination, pageMeta, isRangeError } from '../utils/pagination';
import { sanitizeError } from '../utils/response';
import { validateSportForCreate } from '../utils/sports';
import { isValidTournamentFormat, TOURNAMENT_FORMATS, LIMITS, firstTooLong, firstInvalidUrl, firstDisallowedImageUrl } from '../utils/validation';
import { rankTeams, computeStats, pointsFor, bestPlacedAcrossGroups, openKnockoutPlaces, type PointsModel } from '../utils/standings';
import { crossGroupFirstRound } from '../utils/koFirstRound';
import { getSport, normSportSlug } from '../utils/sportCache';
import { withWalkoverScore } from '../utils/walkoverScore';
import { DEFAULT_OVERS } from '../utils/cricketRules';
import { legacyFromRules, rulesOf, stageRules, tournamentRulesRefusal, normalizeRules, STAGE_KEYS, type Stage } from '../utils/matchRules';
import { groupsDrawRefusal, planGroups } from '../utils/groupsPlan';
import {
  buildSchedule, timeToMinutes, keyOf, formatSlotIst,
  type SchedulingConfig, type FixtureShape, type SlotAssign,
} from '../utils/scheduleFixtures';
import { isTournamentOrganiser, authorizeCarveout, logAdminAction } from '../utils/tournamentAuth';
import { isUuid } from '../utils/uuid';
import { notifyUnlessBlocked, notifyUsers, matchAudienceIds } from '../utils/notify';
import { possessive } from '../utils/possessive';
import { TOURNAMENT_STATUSES, listStatusFilter, tournamentNameRefusal, tournamentDetailsRefusal } from '../utils/tournamentRules';
import { settingsRefusal, storedSettings, settingsOf, tiebreakRefusal, storedTiebreaks, changedDrawKey, categoryProblem, swissCreateRefusal, tableInputs } from '../utils/tournamentSettings';
import { drawOrder } from '../utils/drawOrder';
import { sharedScheduleFor } from '../utils/sharedCourts';
import { fillEntryLineups, doublesRulesSport } from '../utils/entryLineups';
import { eventLimitRefusal, eventLimitsRefusal, storedEventLimits } from '../utils/eventLimits';
import { separateClubsInGroups, separateClubsInRound1 } from '../utils/clubSeparation';
import { swissFirstRound, swissNextRound, type SwissRound } from '../utils/swiss';
import {
  SHARED_KEYS, EVENT_KEYS, eventsListRefusal, eventName, entryKindRefusal, eventLabelRefusal, refreshParentStatus, refreshParentOf,
  clientHas, eventsOf, ENTER_AN_EVENT, ENTER_AS_PLAYERS, familyIds, sameSharedValue, rootTournamentId,
} from '../utils/tournamentEvents';

function generateEntryCode(): string {
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  let out = '';
  for (let i = 0; i < 6; i++) out += chars[Math.floor(Math.random() * chars.length)];
  return out;
}

// POST /tournaments — Premium required (Change #6)
/** BUILD 2.4: stage rules as stored — each stage the organiser set, as full rules. */
function storedStageRules(sport: string, rules: unknown): Record<string, unknown> | null {
  if (!rules || typeof rules !== 'object') return null;
  const out: Record<string, unknown> = {};
  for (const k of STAGE_KEYS) {
    const v = (rules as Record<string, unknown>)[k];
    if (v && typeof v === 'object') out[k] = normalizeRules(sport, v);
  }
  return Object.keys(out).length > 0 ? out : null;
}

/**
 * BUILD 1.11 · `home_away` says what the format already decides: a league
 * plays each pair twice (home and away), a round robin once, and knockouts
 * are single ties (two-legged ties aren't offered). It was stored as sent and
 * never read, so `home_away: true` on a round robin promised a second leg
 * nobody would play. Stored from the format now; a value that contradicts it
 * is refused, pointing at the format.
 */
export function homeAwayFor(format: unknown): boolean {
  return String(format ?? '').toLowerCase() === 'league';
}
export function homeAwayRefusal(format: unknown, homeAway: unknown): { error: string; code: string } | null {
  if (homeAway === undefined || homeAway === null) return null;
  if (typeof homeAway !== 'boolean' || homeAway !== homeAwayFor(format)) {
    return {
      error: 'Home and away comes from the format: a league plays each pair twice, a round robin once. Knockout ties are one match.',
      code: 'HOME_AWAY_MISMATCH',
    };
  }
  return null;
}

/** BUILD 4.3 / 4.4: the groups a groups → knockout draw can have, and how many go through from each. */
const GROUPS_MIN = 2;
const GROUPS_MAX = 16;
const QUALIFIERS_MIN = 1;
const QUALIFIERS_MAX = 4;

/**
 * BUILD 4.3 / 4.4 · an edit's groups set-up: before the draw only, in range,
 * and still able to hold the tournament's teams. `row` is the stored tournament.
 */
function groupsEditRefusal(
  body: Record<string, unknown>,
  row: { fixtures_generated?: boolean; num_groups?: number | null; group_size?: number | null; qualifiers_per_group?: number | null; max_teams?: number | null; format?: string | null },
): { status: number; body: { error: string; code: string } } | null {
  const keys = ['num_groups', 'group_size', 'qualifiers_per_group'].filter((k) => k in body);
  if (keys.length === 0) return null;
  const same = keys.every((k) => (body[k] ?? null) === ((row as Record<string, unknown>)[k] ?? null));
  if (row.fixtures_generated && !same) {
    return { status: 409, body: { error: 'The groups are drawn, so their set-up can’t change.', code: 'GROUPS_LOCKED' } };
  }
  const int = (v: unknown) => (v === null ? null : Number(v));
  const ng = 'num_groups' in body ? int(body.num_groups) : row.num_groups ?? null;
  const gs = 'group_size' in body ? int(body.group_size) : row.group_size ?? null;
  const q = 'qualifiers_per_group' in body ? int(body.qualifiers_per_group) : row.qualifiers_per_group ?? 2;
  const bad = (error: string) => ({ status: 400, body: { error, code: 'BAD_GROUPS' } });
  if (ng !== null && (!Number.isInteger(ng) || ng < GROUPS_MIN || ng > GROUPS_MAX)) return bad(`Groups must be ${GROUPS_MIN} to ${GROUPS_MAX}.`);
  if (gs !== null && (!Number.isInteger(gs) || gs < 2 || gs > 64)) return bad('group_size must be an integer between 2 and 64');
  if (q === null || !Number.isInteger(q) || q < QUALIFIERS_MIN || q > QUALIFIERS_MAX) return bad(`Teams through from each group must be ${QUALIFIERS_MIN} to ${QUALIFIERS_MAX}.`);
  if (gs !== null && q > gs) return bad('qualifiers_per_group cannot exceed group_size');
  const maxTeams = 'max_teams' in body ? Number(body.max_teams) : row.max_teams ?? null;
  if (row.format === 'groups_knockout' && ng !== null && maxTeams != null && maxTeams < ng * 2) {
    return { status: 400, body: { error: `${ng} groups need at least ${ng * 2} teams; max teams is ${maxTeams}.`, code: 'GROUPS_TOO_SMALL' } };
  }
  if (row.format === 'groups_knockout' && ng !== null && gs !== null && maxTeams != null && maxTeams > ng * gs) {
    return { status: 400, body: { error: `Max teams (${maxTeams}) is more than ${ng} groups of ${gs} can hold (${ng * gs}).`, code: 'GROUPS_TOO_SMALL' } };
  }
  return null;
}

type RowBuild = { refusal: Record<string, unknown> } | { row: Record<string, unknown> };

/**
 * A create body's checks and the row it inserts (everything but the entry code
 * and the creator). Badminton gap 1: the same checks make a tournament, the
 * parent of a tournament with events (`parent` — the events carry the format,
 * size and rules, so those aren't asked of it) and each event.
 */
async function tournamentRowFrom(body: Record<string, any>, kind: 'single' | 'parent' | 'event'): Promise<RowBuild> {
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
    home_away,
    match_rules,
    num_groups,
    group_size,
    qualifiers_per_group,
    settings,
    entry_kind,
  } = body;
  const bad = (b: Record<string, unknown>): RowBuild => ({ refusal: b });
  if (!sport_id || !name || !format) {
    return bad({ error: 'sport_id, name, format are required' });
  }
  // Phase 3 B08-F11/F12: a real name, and dates/money/schedule numbers that
  // mean something — not "   ", {"a":1}, 'soon' or -5.
  const cBad = tournamentNameRefusal(name) ?? tournamentDetailsRefusal(body);
  if (cBad) return bad(cBad);
  // SC-95/96: bound name/description; validate image URLs (were unbounded/arbitrary).
  const tLong = firstTooLong({ name, description }, [['name', LIMITS.tournamentNameMax], ['description', LIMITS.descriptionMax]]);
  if (tLong) return bad({ error: `${tLong[0]} must be ${tLong[1]} characters or fewer` });
  const tBadUrl = firstDisallowedImageUrl({ banner_url, logo_url, sponsor_logo_url }, ['banner_url', 'logo_url', 'sponsor_logo_url']);
  if (tBadUrl) return bad({ error: `${tBadUrl} must be an uploaded image URL`, code: 'INVALID_IMAGE_URL' });
  // Validate format (SC-37) — unknown enum previously 500'd on insert.
  if (!isValidTournamentFormat(format)) {
    return bad({ error: `Invalid format. Must be one of: ${TOURNAMENT_FORMATS.join(', ')}` });
  }
  const parent = kind === 'parent';
  const haBad = parent ? null : homeAwayRefusal(format, home_away);
  if (haBad) return bad(haBad);
  // BUILD 2.4: the organiser's rules per stage, checked by the shared validator.
  const createSportSlug = normSportSlug((await getSport(String(sport_id)))?.slug);
  const mrBad = parent ? null : tournamentRulesRefusal(createSportSlug, match_rules);
  if (mrBad) return bad(mrBad);
  // BUILD 4.11: open entry is settings.entry. Apps before it send `is_open:
  // true` on every create with no choice behind it, so that field stays
  // ignored — honouring it would turn every older app's tournament open.
  // BUILD Stage 4: the tournament-wide settings, checked by the shared validator.
  const setBad = parent ? null : settingsRefusal(createSportSlug, format, settings);
  if (setBad) return bad(setBad);
  // BUILD 4.15: a Swiss is chess, with its rounds.
  if (!parent && format === 'swiss') {
    const swBad = swissCreateRefusal(createSportSlug, settings);
    if (swBad) return bad(swBad);
  }
  // BUILD 4.2: tie-break names are checked (they were stored as sent, and an
  // unknown one was silently skipped by the table).
  const tbBad = parent ? null : tiebreakRefusal(createSportSlug, tiebreaker_rules);
  if (tbBad) return bad(tbBad);
  // Badminton gap 2: who enters — a team, one player or a pair.
  const ekBad = parent ? null : entryKindRefusal(createSportSlug, entry_kind);
  if (ekBad) return bad(ekBad);
  // Badminton gap 3: how many events a player may enter (a tournament made of events).
  const elBad = parent ? eventLimitsRefusal(body.event_limits) : null;
  if (elBad) return bad(elBad);
  // Bound max_teams (SC-39) — 0/1/absurd values previously created degenerate
  // tournaments. A parent has no entries of its own, so no size.
  const maxTeamsNum = Number(max_teams);
  if (!parent && (
    !Number.isInteger(maxTeamsNum) ||
    maxTeamsNum < LIMITS.tournamentMinTeams ||
    maxTeamsNum > LIMITS.tournamentMaxTeams
  )) {
    return bad({ error: `max_teams must be between ${LIMITS.tournamentMinTeams} and ${LIMITS.tournamentMaxTeams}` });
  }
  // Validate the sport (unknown/malformed/deactivated → clean 400, not a 500).
  const sportErr = await validateSportForCreate(sport_id);
  if (sportErr) return bad({ error: sportErr });
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
  const cfgInt = (v: unknown) => (v === undefined || v === null || parent ? null : Number(v));
  const ng = cfgInt(num_groups);
  if (ng !== null) {
    // BUILD 4.3: 2 to 16 groups (it was 1 to 64; the app never sent it).
    if (!Number.isInteger(ng) || ng < GROUPS_MIN || ng > GROUPS_MAX) {
      return bad({ error: `Groups must be ${GROUPS_MIN} to ${GROUPS_MAX}.`, code: 'BAD_GROUPS' });
    }
    groupsConfigFields.num_groups = ng;
  }
  const gs = cfgInt(group_size);
  if (gs !== null) {
    if (!Number.isInteger(gs) || gs < 2 || gs > 64) {
      return bad({ error: 'group_size must be an integer between 2 and 64' });
    }
    groupsConfigFields.group_size = gs;
  }
  const qpg = cfgInt(qualifiers_per_group);
  if (qpg !== null) {
    // BUILD 4.4: 1 to 4 through from each group (it was 1 to 32).
    if (!Number.isInteger(qpg) || qpg < QUALIFIERS_MIN || qpg > QUALIFIERS_MAX) {
      return bad({ error: `Teams through from each group must be ${QUALIFIERS_MIN} to ${QUALIFIERS_MAX}.`, code: 'BAD_GROUPS' });
    }
    groupsConfigFields.qualifiers_per_group = qpg;
  }
  // SC-110: for groups_knockout, qualifiers_per_group cannot exceed group_size
  // (you can't advance more teams from a group than the group contains).
  if (format === 'groups_knockout' && gs !== null && qpg !== null && qpg > gs) {
    return bad({ error: 'qualifiers_per_group cannot exceed group_size' });
  }
  // BUILD 4.3: every group needs 2 teams, so a group count the tournament
  // can't fill could never be drawn.
  if (format === 'groups_knockout' && ng !== null && maxTeamsNum < ng * 2) {
    return bad({ error: `${ng} groups need at least ${ng * 2} teams; max teams is ${maxTeamsNum}.`, code: 'GROUPS_TOO_SMALL' });
  }
  // BUILD 1.12: the group size is a cap — a tournament that takes more teams
  // than its groups can hold could never be drawn.
  if (format === 'groups_knockout' && ng !== null && gs !== null && maxTeamsNum > ng * gs) {
    return bad({
      error: `Max teams (${maxTeamsNum}) is more than ${ng} groups of ${gs} can hold (${ng * gs}).`,
      code: 'GROUPS_TOO_SMALL',
    });
  }

  return {
    row: {
      sport_id,
      name: String(name).trim(),
      description: description || null,
      format,
      city_id: city_id || null,
      city: city || null,
      venue: venue || null,
      start_date: start_date || null,
      end_date: end_date || null,
      entry_fee: entry_fee ?? 0,
      max_teams: parent ? null : max_teams ?? null,
      prize_pool: prize_pool ?? null,
      banner_url: banner_url || null,
      logo_url: logo_url || null,
      // BUILD 4.2; BUILD 4.15: a Swiss without its own order ranks on Buchholz, then Sonneborn-Berger, then wins.
      tiebreaker_rules: !parent && Array.isArray(tiebreaker_rules) && tiebreaker_rules.length ? storedTiebreaks(tiebreaker_rules)
        : !parent && format === 'swiss' ? ['buchholz', 'sonneborn_berger', 'wins'] : [],
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
      home_away: homeAwayFor(format), // BUILD 1.11
      match_rules: parent ? null : storedStageRules(createSportSlug, match_rules), // BUILD 2.4
      // BUILD Stage 4; badminton gap 3: a parent's settings are its limit of events per player.
      settings: parent ? (storedEventLimits(body.event_limits) ? { v: 1, eventLimits: storedEventLimits(body.event_limits) } : null)
        : settings ? storedSettings(settings) : null,
      // Badminton gaps 1–2. Only written when they differ from the column
      // defaults, so a plain tournament's insert is exactly as before.
      ...(parent ? { is_parent: true } : {}),
      ...(!parent && typeof entry_kind === 'string' && entry_kind !== 'team' ? { entry_kind } : {}),
      ...groupsConfigFields,
    },
  };
}

/** A join code no tournament has (retrying a few times on a collision). */
async function freshEntryCode(): Promise<string> {
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
  return entry_code;
}

/**
 * Badminton gap 1: the rows for these events of `parent` — each event's own
 * settings over the parent's shared ones, checked like any tournament. Returns
 * the first refusal (naming the event) or the rows to insert.
 */
async function eventRowsFor(
  parent: Record<string, any>,
  events: Array<Record<string, any>>,
  startOrder: number,
  probe = false,
): Promise<{ refusal: Record<string, unknown> } | { rows: Array<Record<string, unknown>> }> {
  const rows: Array<Record<string, unknown>> = [];
  for (let i = 0; i < events.length; i++) {
    const ev = events[i];
    const label = String(ev.label).trim();
    const body: Record<string, any> = { sport_id: parent.sport_id };
    for (const k of SHARED_KEYS) body[k] = parent[k];
    for (const k of EVENT_KEYS) if (k in ev) body[k] = ev[k];
    body.entry_kind = ev.entry_kind;
    body.name = eventName(String(parent.name), label);
    if (body.format === undefined) body.format = parent.format;
    // An event without its own fee or prize takes the tournament's.
    if (body.entry_fee === undefined) body.entry_fee = parent.entry_fee;
    if (body.prize_pool === undefined) body.prize_pool = parent.prize_pool;
    const built = await tournamentRowFrom(body, 'event');
    if ('refusal' in built) {
      const r = built.refusal as { error?: string };
      return { refusal: { ...built.refusal, error: `${label}: ${r.error ?? 'check this event'}`, event: label } };
    }
    rows.push({
      ...built.row,
      sport_metadata: parent.sport_metadata ?? {},
      parent_id: parent.id,
      event_label: label,
      event_order: Math.min(99, startOrder + i),
      created_by: parent.created_by,
      entry_code: probe ? null : await freshEntryCode(),
    });
  }
  return { rows };
}

/** Best-effort: the tournament's group chat, its creator in it as admin. */
async function createTournamentChat(name: string, userId: string): Promise<string | null> {
  try {
    const { data: chat } = await supabase
      .from('chats')
      .insert({ is_group: true, name: `${name} Chat`, created_by: userId })
      .select('id')
      .single();
    if (!chat) return null;
    await supabase.from('chat_participants').insert({ chat_id: chat.id, user_id: userId, role: 'admin' });
    return chat.id as string;
  } catch {
    return null; /* chat creation is best-effort */
  }
}

export async function createTournament(req: Request, res: Response) {
  const userId = req.userId;
  if (!userId) return res.status(401).json({ error: 'Unauthorized' });
  try {
    // SC-434: hosting a tournament used to need Premium. There are no tiers any
    // more — anyone signed in can run one.
    const body = (req.body || {}) as Record<string, any>;
    // Badminton gap 1: a tournament made of events. The parent takes the shared
    // details; each event its own format, size, category, rules and fee.
    const events = body.events;
    const withEvents = events !== undefined && events !== null;
    if (withEvents) {
      const evBad = eventsListRefusal(events);
      if (evBad) return res.status(400).json(evBad);
    }
    const parentBody = withEvents ? { ...body, format: body.format ?? events[0]?.format ?? 'knockout' } : body;
    const built = await tournamentRowFrom(parentBody, withEvents ? 'parent' : 'single');
    if ('refusal' in built) return res.status(400).json(built.refusal);
    // Each event is checked before anything is written.
    if (withEvents) {
      const probe = await eventRowsFor({ ...built.row, id: null, created_by: userId }, events, 0, true);
      if ('refusal' in probe) return res.status(400).json(probe.refusal);
    }

    const entry_code = await freshEntryCode();
    const { data: tournament, error } = await supabase
      .from('tournaments')
      .insert({ ...built.row, entry_code, created_by: userId })
      .select('*')
      .single();
    if (error || !tournament) return res.status(500).json({ error: sanitizeError(error) || 'Failed to create tournament' });

    // Auto-create tournament group chat (best-effort). Store the chat reference
    // on the tournament — a loose metadata link, there's no FK column for it.
    const metadata = (built.row.sport_metadata ?? {}) as Record<string, string>;
    const chatId = await createTournamentChat(String(built.row.name), userId);
    if (chatId) {
      await supabase.from('tournaments').update({ sport_metadata: { ...metadata, _chat_id: chatId } }).eq('id', tournament.id);
      (tournament as Record<string, unknown>).sport_metadata = { ...metadata, _chat_id: chatId };
    }

    // Per-day window overrides (optional).
    await upsertDayWindows(tournament.id, body.day_windows);

    if (withEvents) {
      // The events share the parent's chat (one chat for the whole tournament).
      const made = await eventRowsFor(tournament as Record<string, any>, events, 0);
      if ('refusal' in made) return res.status(400).json(made.refusal);
      const { data: eventRows, error: evErr } = await supabase.from('tournaments').insert(made.rows).select('*');
      if (evErr || !eventRows) {
        // All or nothing: an event that won't insert takes the parent with it.
        await supabase.from('tournaments').delete().eq('id', tournament.id);
        return res.status(500).json({ error: sanitizeError(evErr) || 'Failed to create the events' });
      }
      const sorted = [...(eventRows as Array<Record<string, any>>)].sort((a, b) => (a.event_order ?? 0) - (b.event_order ?? 0));
      return res.json({ tournament: { ...tournament, events: sorted } });
    }

    return res.json({ tournament });
  } catch (e) {
    return res.status(500).json({ error: 'Internal server error' });
  }
}

// POST /tournaments/:id/events — badminton gap 1: add events to a tournament
// made of events (before it's finished). Any organiser.
export async function addEvents(req: Request, res: Response) {
  const userId = req.userId;
  if (!userId) return res.status(401).json({ error: 'Unauthorized' });
  try {
    const { id } = req.params;
    const { data: parent } = await supabase.from('tournaments').select('*').eq('id', id).maybeSingle();
    if (!parent) return res.status(404).json({ error: 'Tournament not found' });
    if (!(await isTournamentOrganiser(id, userId))) return res.status(403).json({ error: 'Only the organiser can add events.' });
    if (!(parent as { is_parent?: boolean }).is_parent) {
      return res.status(409).json({ error: 'Events are added to a tournament made of events.', code: 'NOT_A_PARENT' });
    }
    if (parent.status === 'completed' || parent.status === 'cancelled') {
      return res.status(409).json({ error: parent.status === 'completed' ? 'This tournament is finished.' : 'This tournament was cancelled.', code: 'TOURNAMENT_FINISHED' });
    }
    const { data: existing } = await supabase.from('tournaments').select('event_label, event_order').eq('parent_id', id);
    const have = (existing ?? []) as Array<{ event_label: string | null; event_order: number | null }>;
    const events = (req.body || {}).events;
    const evBad = eventsListRefusal(events, have.map((e) => e.event_label ?? '').filter(Boolean));
    if (evBad) return res.status(400).json(evBad);
    const next = have.reduce((m, e) => Math.max(m, (e.event_order ?? -1) + 1), 0);
    const made = await eventRowsFor(parent as Record<string, any>, events, next);
    if ('refusal' in made) return res.status(400).json(made.refusal);
    const { data: rows, error } = await supabase.from('tournaments').insert(made.rows).select('*');
    if (error || !rows) return res.status(500).json({ error: sanitizeError(error) || 'Failed to add the events' });
    await refreshParentStatus(id);
    return res.json({ events: rows });
  } catch {
    return res.status(500).json({ error: 'Internal server error' });
  }
}

// GET /tournaments
export async function listTournaments(req: Request, res: Response) {
  const userId = req.userId;
  if (!userId) return res.status(401).json({ error: 'Unauthorized' });
  try {
    const { sport_id, city_id, mine } = req.query as Record<string, string | undefined>;
    // Phase 3 B08-F6/F11: a bad city is a 400, not a 500; an unknown status is a
    // 400, and an older build's `registration` reads as `upcoming`.
    if (city_id !== undefined && !isUuid(city_id)) return res.status(400).json({ error: 'city_id must be a valid city.' });
    const status = listStatusFilter(req.query.status);
    if (status === 'bad') return res.status(400).json({ error: `status must be one of: ${TOURNAMENT_STATUSES.join(', ')}` });
    const resolvedSportId = await resolveSportId(sport_id);
    const p = parsePagination(req.query as Record<string, unknown>);
    let query = supabase
      .from('tournaments')
      // D2 (visual review): list cards show "🏆 <champion>" on a completed tournament.
      .select('*, champion:teams!champion_team_id(id, name, short_name)', { count: 'exact' })
      .order('created_at', { ascending: false })
      .range(p.from, p.to);
    if (resolvedSportId) query = query.eq('sport_id', resolvedSportId);
    if (city_id) query = query.eq('city_id', city_id);
    if (status) query = query.eq('status', status);
    if (mine === '1') query = query.eq('created_by', userId);
    // B03 (V245, D3): test tournaments are hidden from real viewers' lists.
    else if (await hideTestFor(userId)) query = excludeTest(query);
    // Badminton gap 1: an app that knows events lists a tournament made of
    // events once (its events inside it); an older app gets each event as a
    // tournament of its own ("Open · Men's singles") and never the parent,
    // which it couldn't enter or draw.
    const grouped = clientHas(req, 'events');
    query = grouped ? query.is('parent_id', null) : query.eq('is_parent', false);
    const { data, error, count } = await query;
    if (error && !isRangeError(error)) return res.status(500).json({ error: sanitizeError(error) });
    const rows = (data || []) as Array<Record<string, unknown>>;
    if (grouped) await attachEventSummaries(rows);
    return res.json({ tournaments: rows, ...pageMeta(count, p) });
  } catch (e) {
    return res.status(500).json({ error: 'Internal server error' });
  }
}

/** Badminton gap 1: each parent on a list page carries its events' labels and kinds. */
async function attachEventSummaries(rows: Array<Record<string, unknown>>): Promise<void> {
  const parents = rows.filter((r) => r.is_parent).map((r) => r.id as string);
  if (parents.length === 0) return;
  const { data } = await supabase
    .from('tournaments')
    .select('id, parent_id, event_label, event_order, entry_kind, status')
    .in('parent_id', parents)
    .order('event_order', { ascending: true });
  const byParent = new Map<string, Array<Record<string, unknown>>>();
  for (const e of (data ?? []) as Array<Record<string, unknown>>) {
    const k = e.parent_id as string;
    byParent.set(k, [...(byParent.get(k) ?? []), { id: e.id, label: e.event_label, entry_kind: e.entry_kind, status: e.status }]);
  }
  for (const r of rows) if (r.is_parent) { r.events = byParent.get(r.id as string) ?? []; r.events_count = (r.events as unknown[]).length; }
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
    // Cricket gap 10 (5 Oct 2026): who has paid the entry fee is the organisers'
    // record — read only for them; nobody else gets the columns.
    const organiser = await isTournamentOrganiser(id, userId);
    const { data: entries } = await supabase
      .from('tournament_entries')
      // Phase 3 B08-F5: team_id too — the fixture editor keys its team chips on it.
      .select(`id, team_id, status, seed, group_label, club, entered_at,${organiser ? ' fee_paid_at, fee_note,' : ''} team:team_id (id, name, short_name, logo_url, sport_id)`)
      .eq('tournament_id', id);
    // SC-293: authoritative fixture count so the Overview's Quick Stats agrees
    // with the Bracket + Officials tabs. Was: the FE showed fixtures.length, but
    // fixtures are only fetched on the Bracket tab → the Overview (landing tab)
    // always showed "0 fixtures" even for a completed tournament with a full
    // bracket. Counted server-side here (same universe the bracket renders).
    const { count: fixturesCount } = await supabase
      .from('matches')
      .select('id', { count: 'exact', head: true })
      .eq('tournament_id', id);
    (tournament as { fixtures_count?: number }).fixtures_count = fixturesCount ?? 0;
    // BUILD 4.1: whether any result is in — the points and tie-breaks are fixed from then on.
    (tournament as { has_results?: boolean }).has_results = (fixturesCount ?? 0) > 0 ? await tournamentHasResult(String(tournament.id)) : false;
    // B02 (N2): whether THIS viewer may open the tournament chat, so the app can
    // hide a button that would only answer 403. Signed-out viewers can't.
    const can_open_chat = req.userId ? await canOpenTournamentChat(String(tournament.id), req.userId) : false;
    // Badminton gap 1: a parent lists its events (status brought up to date);
    // an event names its tournament and its sibling events.
    const family: Record<string, unknown> = {};
    if ((tournament as { is_parent?: boolean }).is_parent) {
      const st = await refreshParentStatus(String(tournament.id));
      if (st) (tournament as { status?: string }).status = st;
      family.events = await eventsOf(String(tournament.id));
    } else if ((tournament as { parent_id?: string | null }).parent_id) {
      const pid = String((tournament as { parent_id: string }).parent_id);
      const { data: parent } = await supabase.from('tournaments').select('id, name, status, entry_code, settings').eq('id', pid).maybeSingle();
      family.parent = parent ?? null;
      family.events = await eventsOf(pid);
    }
    return res.json({ tournament, entries: entries || [], can_open_chat, ...family });
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

// SC-316: when a team is approved into a tournament, re-evaluate the Tournament
// Veteran badge for every roster member (their approved-entry count moved).
// Best-effort — a badge failure never blocks the entry/approval.
async function awardTournamentBadges(teamId: string): Promise<void> {
  try {
    const { awardBadgesSafe } = await import('./badges.controller');
    const { data: members } = await supabase
      .from('team_members')
      .select('user_id')
      .eq('team_id', teamId);
    for (const m of members || []) void awardBadgesSafe(m.user_id);
  } catch {
    /* best-effort */
  }
}

type EntryTournament = {
  id: string;
  name?: string | null;
  status?: string | null;
  sport_id?: string | null;
  max_teams?: number | null;
  registration_deadline?: string | null;
  fixtures_generated?: boolean | null;
  created_by?: string | null;
  settings?: unknown; // BUILD 4.11 open entry, 4.14 category
  start_date?: string | null; // BUILD 4.14 ages on the start date
  is_parent?: boolean | null; // badminton gap 1
  parent_id?: string | null;
  entry_kind?: string | null; // badminton gap 2
};
type EntryRefusal = { status: number; body: { error: string; code: string } };
const ENTRY_TOURNAMENT_COLS = 'id, name, status, sport_id, max_teams, registration_deadline, fixtures_generated, created_by, settings, start_date, is_parent, parent_id, entry_kind';

/**
 * Phase 3 · B08-F2/F4/F8/F9: the rules EVERY way into a tournament passes — a
 * captain's entry, the join code, the organiser's direct add and the approval.
 * The join code inserted straight away and skipped all of them (a team joined
 * after the draw, into a full cup, with a player already on another entered
 * team); no path refused a cancelled or finished tournament or a team of
 * another sport; direct add and approve could push past max_teams.
 *
 *  - `capCounts`: the entries that fill the cap. A captain's request counts
 *    pending ones too (a request holds a place); the organiser's direct add and
 *    approval count approved only.
 *  - `deadline`: the registration deadline binds captains, not the organiser.
 */
/** BUILD 4.14 · why a team's roster doesn't fit a category (naming a player), or null. */
async function categoryRefusalFor(
  category: NonNullable<ReturnType<typeof settingsOf>['category']>, teamId: string, sportId: string | null, startDate: string | null,
): Promise<string | null> {
  const { data: roster } = await supabase.from('team_members').select('user_id').eq('team_id', teamId);
  const ids = Array.from(new Set(((roster ?? []) as Array<{ user_id: string | null }>).map((m) => m.user_id).filter((x): x is string => !!x)));
  if (ids.length === 0) return null;
  const { data: users } = await supabase.from('users').select('id, name, username, gender, dob').in('id', ids);
  const ratings = new Map<string, number>();
  if (sportId && (category.maxRating != null || category.minRating != null)) {
    const { data: profs } = await supabase.from('user_sport_profiles').select('user_id, rating').eq('sport_id', sportId).in('user_id', ids);
    for (const p of (profs ?? []) as Array<{ user_id: string; rating: number | null }>) if (p.rating != null) ratings.set(p.user_id, Number(p.rating));
  }
  const on = startDate && Number.isFinite(Date.parse(startDate)) ? new Date(startDate) : new Date();
  const players = ((users ?? []) as Array<{ id: string; name?: string | null; username?: string | null; gender?: string | null; dob?: string | null }>).map((u) => ({
    name: u.name || u.username || 'A player', gender: u.gender ?? null, dob: u.dob ?? null, rating: ratings.get(u.id) ?? null,
  }));
  return categoryProblem(category, players, on);
}

async function entryRefusal(
  t: EntryTournament,
  teamId: string,
  opts: { capCounts: Array<'pending' | 'approved'>; deadline: boolean; overlap: boolean },
): Promise<EntryRefusal | null> {
  // Badminton gap 1: a tournament made of events is entered through an event.
  if (t.is_parent) return { status: 409, body: ENTER_AN_EVENT };
  if (t.status === 'completed' || t.status === 'cancelled') {
    return {
      status: 409,
      body: {
        error: t.status === 'completed' ? 'This tournament is finished.' : 'This tournament was cancelled.',
        code: 'TOURNAMENT_FINISHED',
      },
    };
  }
  if (opts.deadline && t.registration_deadline && new Date(t.registration_deadline) < new Date()) {
    return { status: 400, body: { error: 'Registration closed', code: 'REGISTRATION_CLOSED' } };
  }
  // SC-99: no new entries once the bracket is generated (they would never play).
  if (t.fixtures_generated) {
    return { status: 409, body: { error: 'Registration is closed — the bracket has already been generated.', code: 'REGISTRATION_CLOSED' } };
  }
  const { data: team } = await supabase.from('teams').select('id, sport_id, kind').eq('id', teamId).maybeSingle();
  if (!team) return { status: 404, body: { error: 'Team not found', code: 'TEAM_NOT_FOUND' } };
  // Badminton gap 2: a singles or doubles event is entered by players (their
  // entry teams, made by the server), never by a club team.
  const playerEvent = t.entry_kind === 'singles' || t.entry_kind === 'doubles';
  if (playerEvent !== ((team as { kind?: string }).kind === 'entry')) {
    return { status: 409, body: playerEvent ? ENTER_AS_PLAYERS : { error: 'This tournament is entered by teams.', code: 'ENTER_AS_TEAM' } };
  }
  if (t.sport_id && team.sport_id && team.sport_id !== t.sport_id) {
    const { data: sport } = await supabase.from('sports').select('name').eq('id', t.sport_id).maybeSingle();
    const s = typeof sport?.name === 'string' ? sport.name.toLowerCase() : null;
    return {
      status: 400,
      body: {
        error: s ? `This is a ${s} tournament — enter a ${s} team.` : 'This tournament is for another sport — enter a team of its sport.',
        code: 'WRONG_SPORT',
      },
    };
  }
  if (t.max_teams) {
    const { count } = await supabase
      .from('tournament_entries')
      .select('id', { count: 'exact', head: true })
      .eq('tournament_id', t.id)
      .in('status', opts.capCounts);
    if ((count ?? 0) >= t.max_teams) {
      return { status: 400, body: { error: 'Tournament is full', code: 'TOURNAMENT_FULL' } };
    }
  }
  // BUILD 4.14: every player on the team fits the tournament's category.
  const category = settingsOf(t as { settings?: unknown }).category;
  if (category) {
    const why = await categoryRefusalFor(category, teamId, t.sport_id ?? null, (t as { start_date?: string | null }).start_date ?? null);
    if (why) return { status: 400, body: { error: why, code: 'CATEGORY' } };
  }
  // Badminton gap 3: the tournament's limit of events per player (its roster).
  if (t.parent_id) {
    const { data: roster } = await supabase.from('team_members').select('user_id').eq('team_id', teamId);
    const ids = [...new Set(((roster ?? []) as Array<{ user_id: string }>).map((r) => r.user_id))];
    const { data: ppl } = ids.length ? await supabase.from('users').select('id, name, username').in('id', ids) : { data: [] };
    const lim = await eventLimitRefusal(t as { id: string; parent_id: string | null; entry_kind?: string | null; settings?: unknown }, ids,
      new Map(((ppl ?? []) as Array<{ id: string }>).map((u) => [u.id, u])), null);
    if (lim) return { status: lim.status, body: { error: lim.body.error, code: lim.body.code } };
  }
  // SC-240: no player may appear on two teams in the same tournament.
  if (opts.overlap) {
    const overlap = await rosterOverlapConflict(t.id, teamId);
    if (overlap) {
      return {
        status: 409,
        body: {
          error: `A player on this team is already registered with ${overlap.teamName} in this tournament.`,
          code: 'ROSTER_OVERLAP',
        },
      };
    }
  }
  return null;
}

// GET /tournaments/code/:code — the tournament a join code names, so the app
// can offer only teams that can enter it (its sport; its category) before the
// captain picks one. 6 Oct 2026: join by code listed every team the captain had.
export async function tournamentByCode(req: Request, res: Response) {
  const userId = req.userId;
  if (!userId) return res.status(401).json({ error: 'Unauthorized' });
  try {
    const code = String(req.params.code ?? '').trim().toUpperCase();
    if (!code || code.length > 20) return res.status(400).json({ error: 'That isn’t a join code.', code: 'BAD_CODE' });
    const { data: t } = await supabase
      .from('tournaments')
      .select('id, name, sport_id, status, format, entry_fee, settings, start_date, is_parent, parent_id, entry_kind, event_label')
      .eq('entry_code', code)
      .maybeSingle();
    if (!t) return res.status(404).json({ error: 'No tournament has that code. Check it with the organiser.', code: 'TOURNAMENT_NOT_FOUND' });
    const category = settingsOf(t as { settings?: unknown }).category ?? null;
    // Badminton gaps 1–2: a code for a tournament made of events lists them, to pick one.
    const fam = t as { is_parent?: boolean; parent_id?: string | null; entry_kind?: string; event_label?: string | null };
    const extra = fam.is_parent
      ? { is_parent: true, events: await eventsOf(String(t.id)) }
      : { entry_kind: fam.entry_kind ?? 'team', parent_id: fam.parent_id ?? null, event_label: fam.event_label ?? null };
    return res.json({ tournament: { id: t.id, name: t.name, sport_id: t.sport_id, status: t.status, format: t.format, entry_fee: t.entry_fee, start_date: t.start_date, category, ...extra } });
  } catch {
    return res.status(500).json({ error: 'Internal server error' });
  }
}

type EntryOptionsTournament = EntryTournament & { name: string; format: string; entry_fee: number | null; start_date: string | null; settings?: unknown };

/**
 * The teams the caller can try to enter this tournament with — their own teams
 * of its sport, captain or co-captain, not disbanded — each with its verdict,
 * plus how many they run in other sports. Not paged: "my teams" is (100 a page),
 * so a captain of 127 teams was offered only the first page's.
 */
async function myEntryOptions(tour: EntryOptionsTournament, userId: string) {
  type Team = { id: string; name: string; sport_id: string | null; deleted_at: string | null; kind?: string | null };
  const memberships = await selectAll<{ team_id: string; role: string; team: Team | Team[] | null }>((from, to) => supabase
    .from('team_members').select('team_id, role, team:teams!team_id(id, name, sport_id, deleted_at, kind)')
    .eq('user_id', userId).order('team_id', { ascending: true }).range(from, to));
  const live = memberships
    .map((m) => ({ role: m.role, team: Array.isArray(m.team) ? m.team[0] : m.team }))
    // Badminton gap 2: a singles / doubles entry's hidden team is no team to enter with.
    .filter((m): m is { role: string; team: Team } => !!m.team && !m.team.deleted_at && m.team.kind !== 'entry');
  const runs = live.filter((m) => m.role === 'captain' || m.role === 'vice_captain');
  const ofSportAll = runs.filter((m) => !tour.sport_id || m.team.sport_id === tour.sport_id);
  // Every team, not the first 100 (Oct 2026 sweep): checked 100 at a time so
  // each query's id list stays short.
  const ofSport = ofSportAll;
  const verdicts: EntryVerdict[] = [];
  for (let i = 0; i < ofSport.length; i += 100) {
    verdicts.push(...await entryVerdicts(tour, ofSport.slice(i, i + 100).map((m) => m.team.id), false, userId));
  }
  const verdictOf = new Map(verdicts.map((v) => [v.team_id, v]));
  return {
    tournament: {
      id: tour.id, name: tour.name, sport_id: tour.sport_id, status: tour.status, format: tour.format,
      entry_fee: tour.entry_fee, start_date: tour.start_date, category: settingsOf(tour as { settings?: unknown }).category ?? null,
      // Badminton gaps 1–2: who enters, and the event's place.
      entry_kind: tour.entry_kind ?? 'team', parent_id: tour.parent_id ?? null,
    },
    teams: ofSport.map((m) => {
      const v = verdictOf.get(m.team.id);
      return { id: m.team.id, name: m.team.name, sport_id: m.team.sport_id, my_role: m.role, ok: v?.ok ?? true, code: v?.code ?? null, reason: v?.reason ?? null };
    }),
    // teams the caller runs in other sports — "this tournament is for another sport"
    other_sport_teams: runs.length - ofSportAll.length,
    // every team they're on, any role — "captain a team" vs "join a team first"
    member_teams: live.length,
  };
}

// GET /tournaments/code/:code/teams — join by code in one request: the
// tournament the code names and the caller's teams for it, each with its
// verdict. 7 Oct 2026: the app made two round trips (the lookup and "my teams",
// then the check), ~3.7 s on live.
export async function joinOptions(req: Request, res: Response) {
  const userId = req.userId;
  if (!userId) return res.status(401).json({ error: 'Unauthorized' });
  try {
    const code = String(req.params.code ?? '').trim().toUpperCase();
    if (!code || code.length > 20) return res.status(400).json({ error: 'That isn’t a join code.', code: 'BAD_CODE' });
    const { data: t } = await supabase.from('tournaments').select(`${ENTRY_TOURNAMENT_COLS}, format, entry_fee`).eq('entry_code', code).maybeSingle();
    if (!t) return res.status(404).json({ error: 'No tournament has that code. Check it with the organiser.', code: 'TOURNAMENT_NOT_FOUND' });
    const out = await myEntryOptions(t as EntryOptionsTournament, userId);
    // Badminton gap 1: a tournament made of events is entered through one of them.
    if ((t as { is_parent?: boolean }).is_parent) return res.json({ ...out, is_parent: true, events: await eventsOf(String(t.id)) });
    return res.json(out);
  } catch {
    return res.status(500).json({ error: 'Internal server error' });
  }
}

// GET /tournaments/:id/my-teams — the same for "Apply to enter" on the
// tournament's page (it used "my teams" — paged — and then the check).
export async function myTeamsForEntry(req: Request, res: Response) {
  const userId = req.userId;
  if (!userId) return res.status(401).json({ error: 'Unauthorized' });
  try {
    const { id } = req.params;
    if (!isUuid(id)) return res.status(404).json({ error: 'Tournament not found' });
    const { data: t } = await supabase.from('tournaments').select(`${ENTRY_TOURNAMENT_COLS}, format, entry_fee`).eq('id', id).maybeSingle();
    if (!t) return res.status(404).json({ error: 'Tournament not found' });
    return res.json(await myEntryOptions(t as EntryOptionsTournament, userId));
  } catch {
    return res.status(500).json({ error: 'Internal server error' });
  }
}

/** One entry verdict per team: can it enter, and if not, the entry's own reason. */
export type EntryVerdict = { team_id: string; ok: boolean; code: string | null; reason: string | null };

/**
 * The verdicts for these teams entering this tournament — the checks the entry
 * itself makes, in its order (as the captain asking, or as the organiser
 * adding). Shared by POST /:id/entry-check and GET /code/:code/teams.
 */
async function entryVerdicts(tournament: EntryTournament, ids: string[], asOrganiser: boolean, userId: string): Promise<EntryVerdict[]> {
  // 7 Oct 2026: every query is made once for all the teams (about eight, most
  // in parallel), and each team is then judged in memory by the entry's own
  // rules in the entry's order. One team at a time took ~0.45 s per team on
  // live (4.7 s for nine), and join by code waited for it.
  const t = tournament as EntryTournament & { settings?: unknown; start_date?: string | null };
  const id = t.id;
  const capCounts: Array<'pending' | 'approved'> = asOrganiser ? ['approved'] : ['pending', 'approved'];
  const category = settingsOf(t as { settings?: unknown }).category;
  const [{ data: roles }, { data: entered }, { data: teamRows }, { count: taken }, { data: rosterRows }, { data: liveEntries }] = await Promise.all([
    supabase.from('team_members').select('team_id, role').eq('user_id', userId).in('team_id', ids),
    supabase.from('tournament_entries').select('team_id, status').eq('tournament_id', id).in('team_id', ids),
    supabase.from('teams').select('id, sport_id, deleted_at').in('id', ids),
    t.max_teams
      ? supabase.from('tournament_entries').select('id', { count: 'exact', head: true }).eq('tournament_id', id).in('status', capCounts)
      : Promise.resolve({ count: 0 }),
    supabase.from('team_members').select('team_id, user_id').in('team_id', ids),
    supabase.from('tournament_entries').select('team_id').eq('tournament_id', id).in('status', ['pending', 'approved']),
  ]);
  const runs = new Set(((roles ?? []) as Array<{ team_id: string; role: string }>).filter((r) => r.role === 'captain' || r.role === 'vice_captain').map((r) => r.team_id));
  const live = new Map(((entered ?? []) as Array<{ team_id: string; status: string }>).map((e) => [e.team_id, e.status]));
  const teamById = new Map(((teamRows ?? []) as Array<{ id: string; sport_id: string | null; deleted_at: string | null }>).map((r) => [r.id, r]));
  const rosterOf = new Map<string, string[]>();
  for (const r of (rosterRows ?? []) as Array<{ team_id: string; user_id: string | null }>) {
    if (!r.user_id) continue;
    const list = rosterOf.get(r.team_id) ?? [];
    if (!list.includes(r.user_id)) list.push(r.user_id);
    rosterOf.set(r.team_id, list);
  }
  const enteredTeamIds = [...new Set(((liveEntries ?? []) as Array<{ team_id: string | null }>).map((e) => e.team_id).filter((x): x is string => !!x))];
  const allPlayers = [...new Set([...rosterOf.values()].flat())];
  const ratingsNeeded = !!category && !!t.sport_id && (category.maxRating != null || category.minRating != null);
  const [{ data: enteredMembers }, { data: users }, { data: profs }, { data: sport }] = await Promise.all([
    enteredTeamIds.length && allPlayers.length
      ? supabase.from('team_members').select('team_id, user_id').in('team_id', enteredTeamIds).in('user_id', allPlayers)
      : Promise.resolve({ data: [] }),
    category && allPlayers.length
      ? supabase.from('users').select('id, name, username, gender, dob').in('id', allPlayers)
      : Promise.resolve({ data: [] }),
    ratingsNeeded && allPlayers.length
      ? supabase.from('user_sport_profiles').select('user_id, rating').eq('sport_id', t.sport_id as string).in('user_id', allPlayers)
      : Promise.resolve({ data: [] }),
    t.sport_id && ids.some((tid) => { const r = teamById.get(tid); return !!r?.sport_id && r.sport_id !== t.sport_id; })
      ? supabase.from('sports').select('name').eq('id', t.sport_id).maybeSingle()
      : Promise.resolve({ data: null }),
  ]);
  const userById = new Map(((users ?? []) as Array<{ id: string; name?: string | null; username?: string | null; gender?: string | null; dob?: string | null }>).map((u) => [u.id, u]));
  const ratingOf = new Map<string, number>();
  for (const p of (profs ?? []) as Array<{ user_id: string; rating: number | null }>) if (p.rating != null) ratingOf.set(p.user_id, Number(p.rating));
  const teamsOfPlayer = new Map<string, string[]>();
  for (const m of (enteredMembers ?? []) as Array<{ team_id: string; user_id: string }>) {
    teamsOfPlayer.set(m.user_id, [...(teamsOfPlayer.get(m.user_id) ?? []), m.team_id]);
  }
  const sportName = typeof (sport as { name?: unknown } | null)?.name === 'string' ? (sport as { name: string }).name.toLowerCase() : null;
  const on = t.start_date && Number.isFinite(Date.parse(t.start_date)) ? new Date(t.start_date) : new Date();
  const clashIdOf = new Map<string, string>();
  const no = (teamId: string, code: string, reason: string) => ({ team_id: teamId, ok: false, code, reason });
  const verdicts = ids.map((teamId) => {
    if (t.is_parent) return no(teamId, ENTER_AN_EVENT.code, ENTER_AN_EVENT.error);
    if (t.entry_kind === 'singles' || t.entry_kind === 'doubles') return no(teamId, ENTER_AS_PLAYERS.code, ENTER_AS_PLAYERS.error);
    if (!asOrganiser && !runs.has(teamId)) return no(teamId, 'NOT_CAPTAIN', 'Only the team’s captain or a co-captain can enter it.');
    const team = teamById.get(teamId);
    if (team?.deleted_at) return no(teamId, 'TEAM_DISBANDED', 'This team was disbanded.');
    const st = live.get(teamId);
    if (st === 'pending' || st === 'approved') {
      return no(teamId, 'ALREADY_ENTERED', st === 'approved' ? 'Already in this tournament.'
        : asOrganiser ? 'Already entered — approve it under Entries.' : 'Already entered — waiting for the organiser.');
    }
    // entryRefusal's checks, in its order.
    if (t.status === 'completed' || t.status === 'cancelled') {
      return no(teamId, 'TOURNAMENT_FINISHED', t.status === 'completed' ? 'This tournament is finished.' : 'This tournament was cancelled.');
    }
    if (!asOrganiser && t.registration_deadline && new Date(t.registration_deadline) < new Date()) return no(teamId, 'REGISTRATION_CLOSED', 'Registration closed');
    if (t.fixtures_generated) return no(teamId, 'REGISTRATION_CLOSED', 'Registration is closed — the bracket has already been generated.');
    if (!team) return no(teamId, 'TEAM_NOT_FOUND', 'Team not found');
    if (t.sport_id && team.sport_id && team.sport_id !== t.sport_id) {
      return no(teamId, 'WRONG_SPORT', sportName ? `This is a ${sportName} tournament — enter a ${sportName} team.` : 'This tournament is for another sport — enter a team of its sport.');
    }
    if (t.max_teams && (taken ?? 0) >= t.max_teams) return no(teamId, 'TOURNAMENT_FULL', 'Tournament is full');
    const roster = rosterOf.get(teamId) ?? [];
    if (category && roster.length) {
      const players = roster.filter((u) => userById.has(u)).map((u) => {
        const x = userById.get(u)!;
        return { name: x.name || x.username || 'A player', gender: x.gender ?? null, dob: x.dob ?? null, rating: ratingOf.get(u) ?? null };
      });
      const why = categoryProblem(category, players, on);
      if (why) return no(teamId, 'CATEGORY', why);
    }
    const clash = roster.flatMap((u) => teamsOfPlayer.get(u) ?? []).find((other) => other !== teamId);
    if (clash) { clashIdOf.set(teamId, clash); return no(teamId, 'ROSTER_OVERLAP', '…'); }
    return { team_id: teamId, ok: true, code: null, reason: null };
  });
  const clashIds = [...new Set(clashIdOf.values())];
  if (clashIds.length) {
    const { data: names } = await supabase.from('teams').select('id, name').in('id', clashIds);
    const nameOf = new Map(((names ?? []) as Array<{ id: string; name: string | null }>).map((r) => [r.id, r.name]));
    for (const v of verdicts) {
      const c = clashIdOf.get(v.team_id);
      if (c) v.reason = `A player on this team is already registered with ${nameOf.get(c) ?? 'another team'} in this tournament.`;
    }
  }
  return verdicts;
}

// POST /tournaments/:id/entry-check { team_ids, as: 'captain' | 'organiser' }
// Each team: can it enter, and if not, why — the same checks the entry itself
// runs (sport, category, full, closed, already entered, a player on two teams),
// so a picker can say so beside the team instead of the entry being refused.
// A captain asks about teams they run; an organiser about any team.
export async function entryCheck(req: Request, res: Response) {
  const userId = req.userId;
  if (!userId) return res.status(401).json({ error: 'Unauthorized' });
  try {
    const { id } = req.params;
    const body = (req.body ?? {}) as { team_ids?: unknown; as?: unknown };
    const ids = Array.isArray(body.team_ids) ? body.team_ids.filter((x): x is string => typeof x === 'string' && isUuid(x)) : [];
    if (ids.length === 0 || ids.length > 30) return res.status(400).json({ error: 'Send 1 to 30 team ids.', code: 'BAD_TEAM_IDS' });
    const asOrganiser = body.as === 'organiser';
    const { data: tournament } = await supabase.from('tournaments').select(ENTRY_TOURNAMENT_COLS).eq('id', id).maybeSingle();
    if (!tournament) return res.status(404).json({ error: 'Tournament not found' });
    if (asOrganiser && !(await isTournamentOrganiser(id, userId))) return res.status(403).json({ error: 'Only the organiser can check teams to add.' });
    const teams = await entryVerdicts(tournament as EntryTournament, ids, asOrganiser, userId);
    return res.json({ teams });
  } catch {
    return res.status(500).json({ error: 'Internal server error' });
  }
}

export async function directAddTeam(req: Request, res: Response) {
  const userId = req.userId;
  if (!userId) return res.status(401).json({ error: 'Unauthorized' });
  try {
    // B02 (V022, D7): the chat follows the entries and organisers.
    syncAfterSuccess(res, () => syncTournamentChatMembers(String(req.params.id)));
    const { id } = req.params;
    const { team_id } = req.body || {};
    if (!team_id) return res.status(400).json({ error: 'team_id is required' });
    if (!isUuid(team_id)) return res.status(400).json({ error: 'team_id must be a valid team.' }); // B08-F11
    // #6: an organiser can't add a disbanded team either.
    if (await isTeamDisbanded(team_id)) return res.status(410).json(TEAM_DISBANDED);

    const { data: tournament } = await supabase
      .from('tournaments')
      .select(ENTRY_TOURNAMENT_COLS)
      .eq('id', id)
      .maybeSingle();
    if (!tournament) return res.status(404).json({ error: 'Tournament not found' });
    // Operational action → any organiser (creator or co-organiser).
    if (!(await isTournamentOrganiser(id, userId))) {
      return res.status(403).json({ error: 'Only the organiser can directly add teams' });
    }

    const refusal = await entryRefusal(tournament as EntryTournament, team_id, { capCounts: ['approved'], deadline: false, overlap: false });
    if (refusal) return res.status(refusal.status).json(refusal.body);

    // Check not already entered. 6 Oct 2026: a rejected or withdrawn entry is
    // reopened as approved (as a captain's new entry reopens it); it used to be
    // refused as "already registered", with no way for the organiser to add it.
    const { data: existing } = await supabase
      .from('tournament_entries')
      .select('id, status')
      .eq('tournament_id', id)
      .eq('team_id', team_id)
      .maybeSingle();
    if (existing && existing.status !== 'rejected' && existing.status !== 'withdrawn') {
      return res.status(400).json({ error: 'Team already registered', code: 'ALREADY_ENTERED' });
    }

    // SC-240: no player may appear on two teams in the same tournament.
    const overlap = await rosterOverlapConflict(id, team_id);
    if (overlap) {
      return res.status(409).json({
        error: `A player on this team is already registered with ${overlap.teamName} in this tournament.`,
        code: 'ROSTER_OVERLAP',
      });
    }

    const { data, error } = existing
      ? await supabase
        .from('tournament_entries')
        .update({ status: 'approved', entered_at: new Date().toISOString() })
        .eq('id', existing.id)
        .select('*')
        .single()
      : await supabase
        .from('tournament_entries')
        .insert({ tournament_id: id, team_id, status: 'approved' })
        .select('*')
        .single();
    if (error) return res.status(500).json({ error: sanitizeError(error) });
    void awardTournamentBadges(team_id); // SC-316: Tournament Veteran
    return res.json({ entry: data });
  } catch {
    return res.status(500).json({ error: 'Internal server error' });
  }
}

/**
 * A captain (or co-captain) enters their team: POST /:id/entries, and the join
 * code once it has named its tournament (B08-F2 — one routine, so the code can
 * never again skip a rule the entry form applies).
 */
async function enterTeam(tournamentId: string, teamId: unknown, userId: string): Promise<{ status: number; body: Record<string, unknown> }> {
  if (!teamId) return { status: 400, body: { error: 'team_id is required' } };
  if (!isUuid(teamId)) return { status: 400, body: { error: 'team_id must be a valid team.' } };
  // Hard-delete list #6: a disbanded team can't enter a tournament.
  if (await isTeamDisbanded(teamId)) return { status: 410, body: TEAM_DISBANDED as unknown as Record<string, unknown> };
  const { data: membership } = await supabase
    .from('team_members')
    .select('role')
    .eq('team_id', teamId)
    .eq('user_id', userId)
    .maybeSingle();
  // SC-267: a co-captain (vice_captain) may also enter the team into a tournament.
  if (membership?.role !== 'captain' && membership?.role !== 'vice_captain') {
    return { status: 403, body: { error: 'Only the team captain or a co-captain can enter a tournament' } };
  }

  const { data: tournament } = await supabase
    .from('tournaments')
    .select(ENTRY_TOURNAMENT_COLS)
    .eq('id', tournamentId)
    .maybeSingle();
  // B08-F11: an unknown tournament is a 404 (the insert used to 500 on the FK).
  if (!tournament) return { status: 404, body: { error: 'Tournament not found' } };

  // Checked before the reopen/insert so a re-entry after a rejection is
  // re-validated too.
  const refusal = await entryRefusal(tournament as EntryTournament, teamId, { capCounts: ['pending', 'approved'], deadline: true, overlap: true });
  if (refusal) return refusal;

  // BUILD 4.11: an open tournament takes a captain's entry straight in (up to
  // max teams); otherwise it waits for the organiser, as before.
  const open = settingsOf(tournament as { settings?: unknown }).entry === 'open';
  const landing = open ? 'approved' : 'pending';

  // SC-83: a team may re-enter after a REJECTED/WITHDRAWN entry. Reopen the
  // existing row to `pending` with a single filtered UPDATE (atomic per
  // statement). A row that is already pending/approved is a clean 400 —
  // never a duplicate row and never a raw 500 from the unique constraint.
  // Notify the ORGANISER that a team requested entry (block-respecting,
  // best-effort). Fired for a fresh request AND a re-request (reopen).
  const notifyEntryRequested = async (entryRowId: string) => {
    try {
      const organiserId = tournament.created_by;
      if (!organiserId || organiserId === userId) return;
      const { data: team } = await supabase.from('teams').select('name').eq('id', teamId).maybeSingle();
      await notifyUnlessBlocked(userId, {
        userId: organiserId,
        type: 'entry_requested',
        title: 'New tournament entry',
        body: open
          ? `${team?.name ?? 'A team'} entered ${tournament.name ?? 'your tournament'}.`
          : `${team?.name ?? 'A team'} requested to enter ${tournament.name ?? 'your tournament'}.`,
        data: { tournamentId, teamId, entryId: entryRowId },
      });
    } catch { /* best-effort */ }
  };

  const nowIso = new Date().toISOString();
  const { data: reopened } = await supabase
    .from('tournament_entries')
    .update({ status: landing, entered_at: nowIso })
    .eq('tournament_id', tournamentId)
    .eq('team_id', teamId)
    .in('status', ['rejected', 'withdrawn'])
    .select('*')
    .maybeSingle();
  if (reopened) {
    await notifyEntryRequested(reopened.id);
    if (open) void awardTournamentBadges(teamId as string);
    return { status: 200, body: { entry: reopened } };
  }

  // No rejected/withdrawn row was reopened → either a live (pending/approved)
  // entry already exists, or there is no row yet.
  const { data: existing } = await supabase
    .from('tournament_entries')
    .select('status')
    .eq('tournament_id', tournamentId)
    .eq('team_id', teamId)
    .maybeSingle();
  if (existing) {
    return { status: 400, body: { error: 'This team is already entered in this tournament.', code: 'ALREADY_ENTERED' } };
  }

  const { data, error } = await supabase
    .from('tournament_entries')
    .insert({ tournament_id: tournamentId, team_id: teamId, status: landing })
    .select('*')
    .single();
  if (error) {
    // Race backstop: a concurrent submit inserted first → unique violation.
    // The unique constraint guarantees no duplicate row; surface a clean 400,
    // never a 500.
    const code = (error as { code?: string }).code;
    if (code === '23505' || /duplicate|unique/i.test(error.message || '')) {
      return { status: 400, body: { error: 'This team is already entered in this tournament.', code: 'ALREADY_ENTERED' } };
    }
    return { status: 500, body: { error: sanitizeError(error) } };
  }
  await notifyEntryRequested(data.id);
  if (open) void awardTournamentBadges(teamId as string); // as an approval does
  return { status: 200, body: { entry: data } };
}

// POST /tournaments/:id/entries — captain enters their team
export async function createEntry(req: Request, res: Response) {
  const userId = req.userId;
  if (!userId) return res.status(401).json({ error: 'Unauthorized' });
  try {
    // B02 (V022, D7): the chat follows the entries and organisers.
    syncAfterSuccess(res, () => syncTournamentChatMembers(String(req.params.id)));
    const out = await enterTeam(String(req.params.id), (req.body || {}).team_id, userId);
    return res.status(out.status).json(out.body);
  } catch (e) {
    return res.status(500).json({ error: 'Internal server error' });
  }
}

// PATCH /tournaments/:id/entries/:entryId
export async function updateEntry(req: Request, res: Response) {
  const userId = req.userId;
  if (!userId) return res.status(401).json({ error: 'Unauthorized' });
  try {
    // B02 (V022, D7): the chat follows the entries and organisers.
    syncAfterSuccess(res, () => syncTournamentChatMembers(String(req.params.id)));
    const { id, entryId } = req.params;
    const { status, seed, group_label, club, fee_paid, fee_note } = req.body || {};
    // Cricket gap 10 (5 Oct 2026): the organiser keeps track of who has paid the
    // entry fee (cash / UPI, outside the app) — a yes/no and a short note.
    if (fee_paid !== undefined && typeof fee_paid !== 'boolean') {
      return res.status(400).json({ error: 'Paid is yes or no.', code: 'BAD_FEE_PAID' });
    }
    if (fee_note !== undefined && fee_note !== null && !(typeof fee_note === 'string' && fee_note.trim().length <= 120)) {
      return res.status(400).json({ error: 'A payment note is up to 120 characters.', code: 'BAD_FEE_NOTE' });
    }
    // BUILD 4.13: the entry's club / state (for keeping clubs apart in the draw).
    if (club !== undefined && club !== null && !(typeof club === 'string' && club.trim().length <= 60)) {
      return res.status(400).json({ error: 'A club is up to 60 characters.' });
    }
    if (status && !['pending', 'approved', 'rejected', 'withdrawn'].includes(status)) {
      return res.status(400).json({ error: 'Invalid status' });
    }
    // B08-F11: a seed is a whole number and a group a short label (text in the
    // integer column 500'd).
    if (seed !== undefined && seed !== null && !(Number.isInteger(seed) && seed >= 1 && seed <= 256)) {
      return res.status(400).json({ error: 'seed must be a whole number from 1 to 256.' });
    }
    if (group_label !== undefined && group_label !== null && !(typeof group_label === 'string' && group_label.trim().length >= 1 && group_label.trim().length <= 8)) {
      return res.status(400).json({ error: 'group_label must be a short label, like A.' });
    }
    const { data: entry } = await supabase
      .from('tournament_entries')
      .select('id, tournament_id, team_id, status')
      .eq('id', entryId)
      .eq('tournament_id', id)
      .maybeSingle();
    if (!entry) return res.status(404).json({ error: 'Entry not found' });

    const { data: tournament } = await supabase
      .from('tournaments')
      .select(ENTRY_TOURNAMENT_COLS)
      .eq('id', id)
      .maybeSingle();
    if (!tournament) return res.status(404).json({ error: 'Tournament not found' });

    // Operational: any organiser (creator or co-organiser) may approve/reject/manage entries.
    const isCreator = await isTournamentOrganiser(id, userId);
    // SC-396: reimplemented utils/teamAuth.isTeamManager inline — and named the
    // result `isTeamCaptain` while actually computing MANAGER (captain OR
    // vice-captain), which is a misreading waiting to happen at the call site.
    // SC-267: a co-captain may also withdraw the team (operational).
    const isTeamManagerOfEntry = await isTeamManager(entry.team_id, userId);

    if (status === 'approved' || status === 'rejected') {
      if (!isCreator) return res.status(403).json({ error: 'Only the tournament organiser can approve/reject' });
      // SC-99: can't approve a NEW team into the bracket after it's generated.
      // (reject stays allowed for pending cleanup; withdrawn → SC-88 walkover.)
      // B08-F4/F8/F9: nor into a finished tournament, past max_teams, or from
      // another sport — the same rules as every other way in.
      if (status === 'approved' && entry.status !== 'approved') {
        const refusal = await entryRefusal(tournament as EntryTournament, entry.team_id, { capCounts: ['approved'], deadline: false, overlap: false });
        if (refusal) return res.status(refusal.status).json(refusal.body);
      }
    } else if (status === 'withdrawn') {
      // SC-88: the team captain (self-withdraw) or the organiser may withdraw.
      if (!isTeamManagerOfEntry && !isCreator) {
        return res.status(403).json({ error: 'Only the team captain or organiser can withdraw' });
      }
    } else {
      if (!isCreator) return res.status(403).json({ error: 'Forbidden' });
    }

    // BUILD 1.13: once the groups are drawn, a team's group is its fixtures'
    // group — moving it would split the table from the matches it played.
    if (group_label !== undefined && (tournament as { fixtures_generated?: boolean }).fixtures_generated) {
      return res.status(409).json({ error: 'The groups are already drawn, so a team can’t change group.', code: 'GROUPS_LOCKED' });
    }
    // BUILD 4.6: the draw is made from the seeds, so they're fixed after it.
    if (seed !== undefined && (tournament as { fixtures_generated?: boolean }).fixtures_generated) {
      return res.status(409).json({ error: 'The draw is made, so seeds can’t change.', code: 'SEEDS_LOCKED' });
    }
    const update: Record<string, any> = {};
    if (status !== undefined) update.status = status;
    if (seed !== undefined) update.seed = seed;
    if (club !== undefined) update.club = typeof club === 'string' && club.trim() ? club.trim() : null;
    // Stored in capitals, as the draw reads it ("a" is group A).
    if (group_label !== undefined) update.group_label = typeof group_label === 'string' ? group_label.trim().toUpperCase() : group_label;
    // Gap 10 (organisers only: a request without a status needs an organiser, above).
    if (fee_paid !== undefined) {
      update.fee_paid_at = fee_paid ? new Date().toISOString() : null;
      update.fee_marked_by = fee_paid ? userId : null;
    }
    if (fee_note !== undefined) update.fee_note = typeof fee_note === 'string' && fee_note.trim() ? fee_note.trim() : null;

    const { data, error } = await supabase
      .from('tournament_entries')
      .update(update)
      .eq('id', entryId)
      .select('*')
      .single();
    if (error) return res.status(500).json({ error: sanitizeError(error) });

    // SC-316: an approval moves the team's roster into a new tournament → re-check
    // the Tournament Veteran badge for each member. Best-effort.
    if (status === 'approved') void awardTournamentBadges(entry.team_id);

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
    // Gap 10: the payment record stays with the organisers (a captain withdrawing gets the rest).
    if (!isCreator && data) { delete (data as Record<string, unknown>).fee_paid_at; delete (data as Record<string, unknown>).fee_marked_by; delete (data as Record<string, unknown>).fee_note; }
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
      .select('created_by, status, name, start_date, end_date, venue, format, fixtures_generated, sport_id, settings, tiebreaker_rules, sport_metadata, num_groups, group_size, qualifiers_per_group, max_teams, registration_deadline, parent_id, is_parent, event_label, entry_kind')
      .eq('id', id)
      .maybeSingle();
    if (!tournament) return res.status(404).json({ error: 'Tournament not found' });
    // Auth split: cancelling or force-completing a tournament is a CARVE-OUT
    // (creator OR admin, logged) — a co-organiser can't nuke the cup. Every other
    // edit (details/schedule/venue/window) is operational → any organiser
    // (creator or co-org). An admin editing a non-status field is NOT authorized
    // (narrow override set) and gets 403.
    // N3 (visual review): a finished tournament stays finished. There was no
    // transition rule, so any organiser could PATCH a completed or cancelled
    // tournament back to live — undoing the champion and the "locked in"
    // standings the Complete confirmation promised.
    if ((tournament.status === 'completed' || tournament.status === 'cancelled')
        && req.body?.status !== undefined && req.body.status !== tournament.status) {
      return res.status(409).json({
        error: tournament.status === 'completed'
          ? 'This tournament is finished and can’t be reopened.'
          : 'This tournament was cancelled and can’t be reopened.',
        code: 'TOURNAMENT_FINISHED',
      });
    }
    const isTerminalStatusChange = req.body?.status === 'cancelled' || req.body?.status === 'completed';
    let carveoutViaAdmin = false;
    if (isTerminalStatusChange) {
      const auth = await authorizeCarveout(tournament.created_by, userId);
      if (!auth.ok) {
        return res.status(403).json({ error: 'Only the tournament creator (or a platform admin) can cancel or complete a tournament.' });
      }
      carveoutViaAdmin = auth.viaAdmin;
    } else if (!(await isTournamentOrganiser(id, userId))) {
      return res.status(403).json({ error: 'Only the organiser can update' });
    }
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
    // BUILD 1.2: the draw is built for the format — a knockout's bracket links,
    // a league's legs, the groups. Changing the format after fixtures exist left
    // those matches in place while crowning, draws and walkovers switched to the
    // new format's rules. The app never offered it; the API allowed it.
    if (body.format !== undefined && body.format !== (tournament as { format?: string }).format
        && (tournament as { fixtures_generated?: boolean }).fixtures_generated) {
      return res.status(409).json({
        error: 'The fixtures are already drawn for this format, so it can’t change.',
        code: 'FORMAT_LOCKED',
      });
    }
    // BUILD 4.15: turning a tournament into a Swiss needs chess and its rounds.
    if (body.format === 'swiss' && (tournament as { format?: string }).format !== 'swiss') {
      const slug = normSportSlug((await getSport(String((tournament as { sport_id?: string }).sport_id)))?.slug);
      const merged = { ...settingsOf(tournament as { settings?: unknown }), ...((body.settings ?? {}) as object) };
      const swBad = swissCreateRefusal(slug, merged);
      if (swBad) return res.status(400).json(swBad);
    }
    if (body.format !== undefined && !isValidTournamentFormat(body.format)) {
      return res.status(400).json({
        error: `Invalid format. Must be one of: ${TOURNAMENT_FORMATS.join(', ')}`,
      });
    }
    // B08-F6: only the four statuses the column holds — 'registration' and
    // friends reached the CHECK constraint and came back as a 500.
    if (body.status !== undefined && !(TOURNAMENT_STATUSES as readonly unknown[]).includes(body.status)) {
      return res.status(400).json({
        error: `Invalid status. Must be one of: ${TOURNAMENT_STATUSES.join(', ')}`,
      });
    }
    // B08-F11/F12: an edit can't blank the name, end before it starts, charge a
    // negative fee or put text in a date/number column.
    const detailBad = ('name' in body ? tournamentNameRefusal(body.name) : null)
      ?? tournamentDetailsRefusal(body, { start_date: tournament.start_date, end_date: tournament.end_date, registration_deadline: (tournament as { registration_deadline?: string | null }).registration_deadline });
    if (detailBad) return res.status(400).json(detailBad);
    // B08-F8: max_teams can't go below the teams already approved.
    if (body.max_teams !== undefined) {
      const { count: approvedCount } = await supabase
        .from('tournament_entries')
        .select('id', { count: 'exact', head: true })
        .eq('tournament_id', id)
        .eq('status', 'approved');
      if ((approvedCount ?? 0) > Number(body.max_teams)) {
        return res.status(400).json({
          error: `${approvedCount} teams are already approved — max teams can’t be lower than that.`,
          code: 'MAX_BELOW_APPROVED',
        });
      }
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
      'match_rules', // BUILD 2.4
      'settings', // BUILD Stage 4
      'num_groups', // BUILD 4.3
      'group_size',
      'qualifiers_per_group', // BUILD 4.4
      'daily_start_time',
      'daily_end_time',
      'match_duration_minutes',
      'buffer_minutes',
      'ground_count',
      'ground_names',
      'event_label', // badminton gap 1
      'entry_kind', // badminton gap 2
    ];
    const update: Record<string, any> = {};
    for (const key of allowedKeys) {
      if (req.body && key in req.body) update[key] = req.body[key];
    }
    if (typeof update.name === 'string') update.name = update.name.trim();
    // Badminton gaps 1–2: what a tournament made of events, and an event, may change.
    const fam = tournament as { parent_id?: string | null; is_parent?: boolean | null; event_label?: string | null; entry_kind?: string | null };
    let parentRow: Record<string, unknown> | null = null;
    if (fam.is_parent) {
      // The events carry format, size, fee, category and rules — each its own.
      for (const k of EVENT_KEYS) delete update[k];
      // Badminton gap 3: the parent's own setting is the limit of events per player.
      if (req.body && 'event_limits' in req.body) {
        const elBad = eventLimitsRefusal(req.body.event_limits);
        if (elBad) return res.status(400).json(elBad);
        const limits = storedEventLimits(req.body.event_limits);
        const cur = ((tournament as { settings?: Record<string, unknown> | null }).settings ?? {}) as Record<string, unknown>;
        const next: Record<string, unknown> = { v: 1, ...cur };
        if (limits) next.eventLimits = limits; else delete next.eventLimits;
        update.settings = next;
      }
      delete update.event_label;
      delete update.entry_kind;
      if (update.status === 'completed' && tournament.status !== 'completed') {
        const { data: evs } = await supabase.from('tournaments').select('status').eq('parent_id', id);
        if (((evs ?? []) as Array<{ status: string }>).some((e) => e.status !== 'completed' && e.status !== 'cancelled')) {
          return res.status(409).json({ error: 'Finish or cancel every event first.', code: 'EVENTS_UNFINISHED' });
        }
      }
    } else if (fam.parent_id) {
      const { data: pr } = await supabase.from('tournaments').select(`name, ${SHARED_KEYS.join(', ')}`).eq('id', fam.parent_id).maybeSingle();
      parentRow = (pr ?? null) as Record<string, unknown> | null;
      // Shared things are set on the tournament for all its events; an older
      // app's edit form sends them back unchanged, which is fine.
      for (const k of SHARED_KEYS) {
        if (!(k in update)) continue;
        if (parentRow && !sameSharedValue(k, update[k], parentRow[k])) {
          return res.status(409).json({
            error: `Venue, dates, courts and schedule are set on ${String(parentRow.name ?? 'the tournament')} for all its events.`,
            code: 'SHARED_WITH_EVENTS', field: k,
          });
        }
        delete update[k];
      }
      if ('event_label' in update) {
        const lb = eventLabelRefusal(update.event_label);
        if (lb) return res.status(400).json(lb);
        const label = String(update.event_label).trim();
        const { data: sibs } = await supabase.from('tournaments').select('id, event_label').eq('parent_id', fam.parent_id);
        if (((sibs ?? []) as Array<{ id: string; event_label: string | null }>).some((x) => x.id !== id && (x.event_label ?? '').trim().toLowerCase() === label.toLowerCase())) {
          return res.status(400).json({ error: `There are two events called ${label}.`, code: 'DUPLICATE_EVENT' });
        }
        update.event_label = label;
        update.name = eventName(String(parentRow?.name ?? tournament.name ?? ''), label);
      }
    } else {
      delete update.event_label;
    }
    if ('entry_kind' in update) {
      if (update.entry_kind === fam.entry_kind) delete update.entry_kind;
      else {
        const slug = normSportSlug((await getSport(String((tournament as { sport_id?: string }).sport_id)))?.slug);
        const ek = entryKindRefusal(slug, update.entry_kind ?? 'team');
        if (ek) return res.status(400).json(ek);
        const { count: anyEntries } = await supabase.from('tournament_entries').select('id', { count: 'exact', head: true }).eq('tournament_id', id).in('status', ['pending', 'approved']);
        if ((anyEntries ?? 0) > 0) return res.status(409).json({ error: 'Entries are in, so who enters (team, singles or doubles) can’t change.', code: 'ENTRY_KIND_LOCKED' });
        update.entry_kind = update.entry_kind ?? 'team';
      }
    }
    // BUILD 2.4: stage rules are copied onto fixtures at the draw, so they're
    // fixed once it's made; before, they're checked like create's.
    if ('match_rules' in update) {
      if ((tournament as { fixtures_generated?: boolean }).fixtures_generated) {
        return res.status(409).json({ error: 'The fixtures are already drawn with these match rules, so they can’t change.', code: 'RULES_LOCKED' });
      }
      const slug = normSportSlug((await getSport(String((tournament as { sport_id?: string }).sport_id)))?.slug);
      const bad = tournamentRulesRefusal(slug, update.match_rules);
      if (bad) return res.status(400).json(bad);
      update.match_rules = storedStageRules(slug, update.match_rules);
    }
    // BUILD 4.3 / 4.4: the groups set-up, editable until the draw.
    {
      const gBad = groupsEditRefusal(update, tournament as Parameters<typeof groupsEditRefusal>[1]);
      if (gBad) return res.status(gBad.status).json(gBad.body);
    }
    // Stage 4 fault fix: sport_metadata was written raw, so an edit replaced the
    // whole object and wiped the tournament chat's link (_chat_id). It's merged
    // now, string values only like create's, and keys starting "_" belong to
    // the server — an edit can neither set nor clear them. null or "" clears one.
    if ('sport_metadata' in update) {
      const incoming = update.sport_metadata;
      if (incoming !== null && (typeof incoming !== 'object' || Array.isArray(incoming))) {
        return res.status(400).json({ error: 'sport_metadata must be an object.' });
      }
      const merged: Record<string, unknown> = { ...(((tournament as { sport_metadata?: Record<string, unknown> }).sport_metadata) ?? {}) };
      for (const [k, v] of Object.entries((incoming ?? {}) as Record<string, unknown>)) {
        if (k.startsWith('_')) continue;
        if (v === null || v === '' || v === '__custom__') delete merged[k];
        else if (typeof v === 'string') merged[k] = v;
      }
      update.sport_metadata = merged;
    }
    // BUILD 4.2: tie-breaks are checked like create's and fixed once any result
    // stands (re-ordering a table people have played to is re-deciding it).
    if ('tiebreaker_rules' in update) {
      const slug = normSportSlug((await getSport(String((tournament as { sport_id?: string }).sport_id)))?.slug);
      const bad = tiebreakRefusal(slug, update.tiebreaker_rules);
      if (bad) return res.status(400).json(bad);
      const next = storedTiebreaks(update.tiebreaker_rules ?? []);
      const current = storedTiebreaks(((tournament as { tiebreaker_rules?: unknown[] }).tiebreaker_rules ?? []) as unknown[]);
      if (JSON.stringify(next) !== JSON.stringify(current) && (await tournamentHasResult(id!))) {
        return res.status(409).json({ error: 'Results are already in, so the tie-breaks can’t change.', code: 'TIEBREAKS_LOCKED' });
      }
      update.tiebreaker_rules = next;
    }
    // BUILD Stage 4: settings are checked like create's and merged over the
    // stored ones (an edit sends only what changes). The points template is
    // fixed once any result stands — a table can't be re-scored under people.
    // (A parent's settings are only its event limits, set above.)
    if ('settings' in update && !fam.is_parent) {
      const slug = normSportSlug((await getSport(String((tournament as { sport_id?: string }).sport_id)))?.slug);
      const fmt = 'format' in update ? update.format : (tournament as { format?: string }).format;
      const bad = settingsRefusal(slug, fmt, update.settings);
      if (bad) return res.status(400).json(bad);
      const current = settingsOf(tournament as { settings?: unknown });
      const incoming = (update.settings ?? {}) as Record<string, unknown>;
      if ('points' in incoming && JSON.stringify(incoming.points ?? null) !== JSON.stringify(current.points ?? null)
          && (await tournamentHasResult(id!))) {
        return res.status(409).json({ error: 'Results are already in, so the points can’t change.', code: 'POINTS_LOCKED' });
      }
      // Badminton gap 6: so is what a withdrawal does to the table.
      if ('withdrawnResults' in incoming && (incoming.withdrawnResults === 'delete') !== (current.withdrawnResults === 'delete')
          && (await tournamentHasResult(id!))) {
        return res.status(409).json({ error: 'Results are already in, so what a withdrawal does to the table can’t change.', code: 'WITHDRAWN_RULE_LOCKED' });
      }
      // BUILD 4.8: so is a walkover's score (walkovers already recorded keep theirs).
      if (changedDrawKey(current, incoming, ['walkoverScore']) && (await tournamentHasResult(id!))) {
        return res.status(409).json({ error: 'Results are already in, so the walkover score can’t change.', code: 'WALKOVER_LOCKED' });
      }
      // BUILD 4.5 (and the draw settings after it): fixed once the draw is made.
      const drawKey = changedDrawKey(current, incoming);
      if (drawKey && (tournament as { fixtures_generated?: boolean }).fixtures_generated) {
        return res.status(409).json({ error: 'The draw is made, so that setting can’t change.', code: 'SETTINGS_LOCKED', field: drawKey });
      }
      update.settings = storedSettings(incoming, current);
    }
    // BUILD 1.11: home_away follows the format (a new one when it changes).
    {
      const fmt = 'format' in update ? update.format : (tournament as { format?: string }).format;
      const haBad = homeAwayRefusal(fmt, update.home_away);
      if (haBad) return res.status(400).json(haBad);
      if ('format' in update || 'home_away' in update) update.home_away = homeAwayFor(fmt);
    }
    // Empty strings in date/number/city columns mean "clear it", not a cast error.
    for (const k of ['start_date', 'end_date', 'registration_deadline', 'city_id', 'daily_start_time', 'daily_end_time', 'prize_pool']) {
      if (update[k] === '') update[k] = null; // BUILD 1.15: a cleared prize is no prize, not a cast error
    }
    // SC-86: don't let a tournament be marked completed while matches are still
    // scheduled/live — that crowns a champion with an unplayed bracket.
    if (update.status === 'completed' && (await hasUnplayedFixtures(id))) {
      return res.status(409).json({
        error: 'Cannot complete a tournament while matches are still unplayed.',
        code: 'TOURNAMENT_INCOMPLETE',
      });
    }
    // V104 (visual review): the manual Complete path only changed the status,
    // so a tournament finished that way had no champion to show. Crown it the
    // same way the automatic paths do.
    let crownedChampion: { id: string; name: string | null } | null = null;
    if (update.status === 'completed' && tournament.status !== 'completed') {
      crownedChampion = await championOf(id);
      if (crownedChampion) update.champion_team_id = crownedChampion.id;
    }
    update.updated_at = new Date().toISOString();
    const { data, error } = await supabase
      .from('tournaments')
      .update(update)
      .eq('id', id)
      .select('*')
      .single();
    if (error) return res.status(500).json({ error: sanitizeError(error) });
    if (crownedChampion) {
      void notifyTournamentChampion(id, crownedChampion.id, crownedChampion.name, tournament.name ?? null);
    }

    // Attribution: this cancel/complete was authorized ONLY by is_admin (not the
    // creator) → write the audit row. A creator/co-org doing it is NOT logged.
    if (carveoutViaAdmin) {
      void logAdminAction(userId, req.body?.status === 'cancelled' ? 'cancel_tournament' : 'force_complete_tournament',
        'tournament', id, `status → ${req.body?.status} on "${tournament.name ?? id}"`);
    }

    // Per-day window overrides (optional). An event plays in its tournament's.
    if (!fam.parent_id) await upsertDayWindows(id, req.body?.day_windows);

    // Badminton gap 1: the events follow their tournament's shared details and
    // name; cancelling the tournament cancels its unfinished events; an event's
    // status moves its tournament's.
    if (fam.is_parent) {
      try {
        const shared: Record<string, unknown> = {};
        for (const k of SHARED_KEYS) if (k in update) shared[k] = update[k];
        if (Object.keys(shared).length) await supabase.from('tournaments').update(shared).eq('parent_id', id);
        if (typeof update.name === 'string' && update.name !== tournament.name) {
          const { data: evs } = await supabase.from('tournaments').select('id, event_label').eq('parent_id', id);
          for (const ev of (evs ?? []) as Array<{ id: string; event_label: string | null }>) {
            await supabase.from('tournaments').update({ name: eventName(update.name, ev.event_label ?? '') }).eq('id', ev.id);
          }
        }
        if (update.status === 'cancelled' && tournament.status !== 'cancelled') {
          const { data: open } = await supabase.from('tournaments').select('id, name').eq('parent_id', id).in('status', ['upcoming', 'live']);
          for (const ev of (open ?? []) as Array<{ id: string; name: string | null }>) {
            await supabase.from('tournaments').update({ status: 'cancelled', updated_at: new Date().toISOString() }).eq('id', ev.id);
            try { await cancelTournamentSideEffects(ev.id, ev.name ?? null, userId); } catch { /* best-effort */ }
          }
        }
      } catch { /* best-effort */ }
    } else if (fam.parent_id && update.status !== undefined && update.status !== tournament.status) {
      await refreshParentOf(id);
    }

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
  // Badminton gap 1: a tournament made of events tells everyone in any event, once.
  const ids = await familyIds(tournamentId);
  const { data: entries } = await supabase
    .from('tournament_entries')
    .select('team_id')
    .in('tournament_id', ids)
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
      body: `${tournamentName ? possessive(tournamentName) : 'A tournament’s'} schedule or venue changed — check the new details.`,
      data: { tournamentId },
    },
    { actorId },
  );
}

// ─── CO-ORGANISERS ──────────────────────────────────────────────────────────
// A co-organiser does every OPERATIONAL action; managing co-orgs and cancelling/
// completing the tournament stay creator-only (or admin, logged). added/removed
// by the CREATOR only (or admin, logged) so the creator can't be locked out; a
// co-organiser may always remove THEMSELVES (self-leave / decline).

// GET /tournaments/:id/organisers — the creator + co-organisers.
export async function getTournamentOrganisers(req: Request, res: Response) {
  const userId = req.userId;
  if (!userId) return res.status(401).json({ error: 'Unauthorized' });
  try {
    const id = await rootTournamentId(String(req.params.id)); // badminton gap 1: kept on the tournament
    const { data: t } = await supabase
      .from('tournaments')
      .select('created_by, creator:users!created_by(id, name, username, profile_picture_url)')
      .eq('id', id).maybeSingle();
    if (!t) return res.status(404).json({ error: 'Tournament not found' });
    const { data: co } = await supabase
      .from('tournament_organisers')
      .select('user_id, role, created_at, user:users!user_id(id, name, username, profile_picture_url)')
      .eq('tournament_id', id)
      .order('created_at', { ascending: true });
    return res.json({
      creator: (t as any).creator ?? { id: t.created_by },
      co_organisers: (co ?? []).map((c: any) => ({ ...c.user, role: c.role, since: c.created_at })),
    });
  } catch {
    return res.status(500).json({ error: 'Internal server error' });
  }
}

// POST /tournaments/:id/organisers { user_id } — creator OR admin (logged).
export async function addTournamentOrganiser(req: Request, res: Response) {
  const userId = req.userId;
  if (!userId) return res.status(401).json({ error: 'Unauthorized' });
  try {
    // B02 (V022, D7): the chat follows the entries and organisers.
    syncAfterSuccess(res, () => syncTournamentChatMembers(String(req.params.id)));
    const id = await rootTournamentId(String(req.params.id)); // badminton gap 1: kept on the tournament
    const { user_id } = req.body || {};
    if (!user_id || !isUuid(user_id)) return res.status(400).json({ error: 'A valid user_id is required.' });
    const { data: t } = await supabase.from('tournaments').select('created_by, name').eq('id', id).maybeSingle();
    if (!t) return res.status(404).json({ error: 'Tournament not found' });
    // Managing co-organisers is a CARVE-OUT: creator or admin only (NOT a co-org).
    const auth = await authorizeCarveout(t.created_by, userId);
    if (!auth.ok) return res.status(403).json({ error: 'Only the tournament creator can manage co-organisers.' });
    if (user_id === t.created_by) return res.status(400).json({ error: 'That user is already the tournament creator.' });
    const { data: target } = await supabase.from('users').select('id, name').eq('id', user_id).maybeSingle();
    if (!target) return res.status(404).json({ error: 'User not found.' });

    const { error: insErr } = await supabase
      .from('tournament_organisers')
      .insert({ tournament_id: id, user_id, added_by: userId });
    if (insErr && (insErr as { code?: string }).code === '23505') {
      return res.status(409).json({ error: 'That user is already a co-organiser.' });
    }
    if (insErr) return res.status(500).json({ error: sanitizeError(insErr) });

    // Conflict-of-interest SOFT WARNING: a co-org who is also a captain of a team
    // entered in THIS tournament. Allowed (community tournaments have playing
    // organisers) — surfaced, not blocked.
    let warning: string | undefined;
    const { data: entries } = await supabase
      .from('tournament_entries').select('team_id').eq('tournament_id', id).in('status', ['approved', 'pending']);
    const teamIds = (entries ?? []).map((e) => e.team_id);
    if (teamIds.length > 0) {
      const { data: cap } = await supabase
        .from('team_members').select('team_id').eq('user_id', user_id).eq('role', 'captain').in('team_id', teamIds);
      if (cap && cap.length > 0) {
        warning = `${target.name ?? 'This user'} captains a team competing in this tournament — heads up on the conflict of interest.`;
      }
    }

    if (auth.viaAdmin) {
      void logAdminAction(userId, 'add_co_organiser', 'tournament', id, `added ${target.name ?? user_id} as co-organiser`);
    }
    // Notify the new co-organiser (ungated — a responsibility, like added_to_team).
    void notifyUsers([user_id], {
      type: 'added_as_co_organiser',
      title: 'You’re a co-organiser',
      body: `You were added as a co-organiser of "${t.name ?? 'a tournament'}".`,
      data: { tournamentId: id },
    }, { actorId: userId });

    return res.json({ success: true, warning });
  } catch {
    return res.status(500).json({ error: 'Internal server error' });
  }
}

// DELETE /tournaments/:id/organisers/:userId — creator OR admin (logged), OR self-leave.
export async function removeTournamentOrganiser(req: Request, res: Response) {
  const userId = req.userId;
  if (!userId) return res.status(401).json({ error: 'Unauthorized' });
  try {
    // B02 (V022, D7): the chat follows the entries and organisers.
    syncAfterSuccess(res, () => syncTournamentChatMembers(String(req.params.id)));
    const { userId: targetId } = req.params;
    const id = await rootTournamentId(String(req.params.id)); // badminton gap 1
    const { data: t } = await supabase.from('tournaments').select('created_by, name').eq('id', id).maybeSingle();
    if (!t) return res.status(404).json({ error: 'Tournament not found' });
    const isSelf = targetId === userId;
    let viaAdmin = false;
    if (!isSelf) {
      const auth = await authorizeCarveout(t.created_by, userId);
      if (!auth.ok) return res.status(403).json({ error: 'Only the tournament creator can remove a co-organiser.' });
      viaAdmin = auth.viaAdmin;
    }
    await supabase.from('tournament_organisers').delete().eq('tournament_id', id).eq('user_id', targetId);
    if (viaAdmin) void logAdminAction(userId, 'remove_co_organiser', 'tournament', id, `removed co-organiser ${targetId}`);
    return res.json({ success: true });
  } catch {
    return res.status(500).json({ error: 'Internal server error' });
  }
}

// POST /tournaments/:id/reassign-organiser { user_id } — hand the tournament to a
// new organiser. Creator OR admin (logged). The admin's ELEGANT escape hatch: a
// stranded tournament gets a real organiser with legitimate authority, rather
// than the admin running it.
export async function reassignTournamentOrganiser(req: Request, res: Response) {
  const userId = req.userId;
  if (!userId) return res.status(401).json({ error: 'Unauthorized' });
  try {
    // B02 (V022, D7): the chat follows the entries and organisers.
    syncAfterSuccess(res, () => syncTournamentChatMembers(String(req.params.id)));
    const id = await rootTournamentId(String(req.params.id)); // badminton gap 1: the whole tournament
    const { user_id } = req.body || {};
    if (!user_id || !isUuid(user_id)) return res.status(400).json({ error: 'A valid user_id is required.' });
    const { data: t } = await supabase.from('tournaments').select('created_by, name').eq('id', id).maybeSingle();
    if (!t) return res.status(404).json({ error: 'Tournament not found' });
    const auth = await authorizeCarveout(t.created_by, userId);
    if (!auth.ok) return res.status(403).json({ error: 'Only the tournament creator (or a platform admin) can reassign the organiser.' });
    const { data: target } = await supabase.from('users').select('id, name').eq('id', user_id).maybeSingle();
    if (!target) return res.status(404).json({ error: 'User not found.' });

    await supabase.from('tournaments').update({ created_by: user_id, updated_at: new Date().toISOString() }).eq('id', id);
    await supabase.from('tournaments').update({ created_by: user_id }).eq('parent_id', id); // its events
    // The new organiser can't also be a co-organiser (would be redundant).
    await supabase.from('tournament_organisers').delete().eq('tournament_id', id).eq('user_id', user_id);
    if (auth.viaAdmin) {
      void logAdminAction(userId, 'reassign_organiser', 'tournament', id, `organiser ${t.created_by} → ${target.name ?? user_id}`);
    }
    void notifyUsers([user_id], {
      type: 'added_as_co_organiser',
      title: 'You’re now the organiser',
      body: `You were made the organiser of "${t.name ?? 'a tournament'}".`,
      data: { tournamentId: id },
    }, { actorId: userId });
    return res.json({ success: true });
  } catch {
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
      // SC-428: voided_at travels so a voided fixture renders as Voided in the
      // fixtures list and the bracket, rather than as live or completed.
      // SC-433: next_match_id / next_slot say where each winner goes. The offline
      // hub needs them to show the next round locally — without them it would
      // have to guess a bracket shape the server would then disagree with.
      .select('id, team_a_name, team_b_name, team_a_id, team_b_id, score_summary, status, winner_team_id, scheduled_at, round, match_no, group_label, venue, ground_label, voided_at, next_match_id, next_slot, third_place')
      .eq('tournament_id', id)
      .order('round', { ascending: true })
      .order('match_no', { ascending: true })
      .order('scheduled_at', { ascending: true });
    if (error) return res.status(500).json({ error: sanitizeError(error) });

    // Group by the PERSISTED round (SC-23) — no more count-heuristic guessing.
    // round 0 = group stage (groups_knockout); 1..R = the bracket rounds.
    const byRound = new Map<number, any[]>();
    // BUILD 4.12: the third-place match shares the final's round; it's listed
    // as its own round after the Final. Older apps draw each listed round as a
    // bracket column joined to the next, so there the semis still lead to the
    // Final and the third-place match stands alone at the end (their champion
    // card still names the champion, from the entries).
    const thirdPlace = (matches ?? []).filter((m: any) => m.third_place);
    for (const m of matches ?? []) {
      if ((m as any).third_place) continue;
      const r = m.round ?? 1;
      if (!byRound.has(r)) byRound.set(r, []);
      byRound.get(r)!.push(m);
    }
    const roundKeys = Array.from(byRound.keys()).sort((a, b) => a - b);
    const count = roundKeys.length;
    // SC-373: the knockout names are only meaningful for a BRACKET. A round
    // robin or league puts its whole schedule in round 1, so the count-from-the-
    // end rule labelled every fixture list "Final" — a 6-fixture double round
    // robin displayed as a single round called "Final". Those formats have no
    // final; they have a fixture list.
    const fmtLc = ((tournament as any).format ?? 'knockout').toLowerCase();
    const isBracketFormat = fmtLc !== 'round_robin' && fmtLc !== 'league' && fmtLc !== 'swiss';
    const roundName = (r: number, idx: number): string => {
      if (r === 0) return 'Group Stage';
      if (fmtLc === 'swiss') return `Round ${r}`; // BUILD 4.15
      if (!isBracketFormat) return count > 1 ? `Matchday ${r}` : 'Fixtures';
      const fromEnd = count - 1 - idx; // 0 = last round = final
      if (fromEnd === 0) return 'Final';
      if (fromEnd === 1) return 'Semi-Finals';
      if (fromEnd === 2) return 'Quarter-Finals';
      return `Round ${r}`;
    };

    const listed: Array<{ name: string; ms: any[] }> = roundKeys.map((r, idx) => ({ name: roundName(r, idx), ms: byRound.get(r)! }));
    if (thirdPlace.length) listed.push({ name: 'Third place', ms: thirdPlace });
    const rounds = listed.map(({ name, ms }) => ({
      name,
      matches: ms.map((m) => {
        const ss: any = m.score_summary ?? {};
        return {
          id: m.id,
          team_a_id: m.team_a_id,
          team_b_id: m.team_b_id,
          team_a_name: m.team_a_name,
          team_b_name: m.team_b_name,
          // V109 (visual review): the final's card showed no score. Cricket keeps
          // runs, football goals — read the same shapes the result screen does.
          score_a: ss.team_a_score ?? ss?.A?.score ?? ss?.A?.runs ?? ss.goals_a ?? null,
          score_b: ss.team_b_score ?? ss?.B?.score ?? ss?.B?.runs ?? ss.goals_b ?? null,
          winner_team_id: m.winner_team_id,
          status: m.status,
          // V109/SC-428: fetched above but dropped here, so a voided final never
          // showed as VOID in the bracket.
          voided_at: (m as any).voided_at ?? null,
          scheduled_at: m.scheduled_at,
          // SC-264: forward the scheduled slot so the bracket / fixture list can
          // render "date · time · Ground N". The SELECT already fetched these; the
          // response mapping was dropping ground_label/venue → the ground never
          // reached the FE (invisible on every getBracket-backed surface).
          ground_label: (m as any).ground_label ?? null,
          venue: (m as any).venue ?? null,
          ...((m as any).third_place ? { third_place: true } : {}), // BUILD 4.12
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
    if (typeof entry_code !== 'string' || entry_code.trim().length > 20) {
      return res.status(400).json({ error: 'That doesn’t look like a join code.', code: 'INVALID_CODE' });
    }
    const { data: tournament } = await supabase
      .from('tournaments')
      .select('id')
      .eq('entry_code', entry_code.trim().toUpperCase())
      .maybeSingle();
    if (!tournament) return res.status(404).json({ error: 'No tournament uses that code. Check it and try again.', code: 'INVALID_CODE' });
    // B08-F2: the code only names the tournament — the entry itself is the same
    // routine as the entry form, with every rule and the organiser's notification.
    syncAfterSuccess(res, () => syncTournamentChatMembers(String(tournament.id)));
    const out = await enterTeam(String(tournament.id), team_id, userId);
    if (out.status !== 200) return res.status(out.status).json(out.body);
    return res.json({ ...out.body, tournament_id: tournament.id });
  } catch (e) {
    return res.status(500).json({ error: 'Internal server error' });
  }
}

const FIXTURE_STATUSES = ['scheduled', 'live', 'completed'];

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
    // Operational → any organiser (creator or co-organiser).
    if (!(await isTournamentOrganiser(id, userId))) {
      return res.status(403).json({ error: 'Only the organiser can update fixtures' });
    }

    const results: any[] = [];
    const blocked: string[] = [];
    const warnings: string[] = []; // SC-scheduling: soft team-double-book warnings (never block)
    // B08-F10: an item the server did not apply says why. It used to be dropped
    // silently — the modal closed as if it had saved.
    const skipped: Array<{ id: string | null; reason: string }> = [];
    // CHANGE NOTIF: collect affected participants across the whole call, then send
    // ONE batched notification per user (dragging 12 fixtures ≠ 12×N pings).
    const RESCHED_KEYS = ['scheduled_at', 'ground_label', 'venue', 'team_a_id', 'team_b_id'];
    const affectedByUser = new Map<string, Array<{ matchId: string; slot: string }>>();
    for (const upd of items) {
      // B08-F11: `[null]` and friends 500'd.
      if (!upd || typeof upd !== 'object') { skipped.push({ id: null, reason: 'Not a fixture update.' }); continue; }
      const fixtureId = upd.id ?? upd.fixture_id;
      if (!fixtureId) continue;
      const skip = (reason: string) => { skipped.push({ id: typeof fixtureId === 'string' ? fixtureId : null, reason }); };
      if (!isUuid(fixtureId)) { skip('That fixture isn’t in this tournament.'); continue; }
      if (upd.status !== undefined && !FIXTURE_STATUSES.includes(upd.status)) { skip('status must be scheduled, live or completed.'); continue; }
      if (upd.scheduled_at && !(typeof upd.scheduled_at === 'string' && Number.isFinite(Date.parse(upd.scheduled_at)))) {
        skip('scheduled_at must be a date and time.'); continue;
      }
      if (('team_a_id' in upd && upd.team_a_id !== null && !isUuid(upd.team_a_id))
          || ('team_b_id' in upd && upd.team_b_id !== null && !isUuid(upd.team_b_id))) {
        skip('That team isn’t in this tournament.'); continue;
      }
      const { data: cur } = await supabase
        .from('matches')
        .select('id, status, team_a_id, team_b_id, winner_team_id, next_match_id, next_slot')
        .eq('id', fixtureId)
        .eq('tournament_id', id)
        .maybeSingle();
      if (!cur) { skip('That fixture isn’t in this tournament.'); continue; }

      const patch: Record<string, any> = {};
      if (upd.scheduled_at) patch.scheduled_at = upd.scheduled_at;
      if (upd.venue) patch.venue = upd.venue;
      if (upd.ground_label !== undefined) patch.ground_label = upd.ground_label; // scheduling: move a match to another ground
      // B08-F5: a team moves with its name. The id changed on its own, so the
      // card kept showing the old team while the fixture pointed at another.
      let badTeam = false;
      for (const side of ['a', 'b'] as const) {
        const idKey = `team_${side}_id`;
        if (!(idKey in upd)) continue;
        patch[idKey] = upd[idKey];
        if (upd[idKey] === null) { patch[`team_${side}_name`] = null; continue; }
        const { data: team } = await supabase.from('teams').select('name').eq('id', upd[idKey]).maybeSingle();
        if (!team) { badTeam = true; break; }
        patch[`team_${side}_name`] = team.name;
      }
      if (badTeam) { skip('That team isn’t in this tournament.'); continue; }
      if (upd.team_a_name && !('team_a_id' in upd)) patch.team_a_name = upd.team_a_name;
      if (upd.team_b_name && !('team_b_id' in upd)) patch.team_b_name = upd.team_b_name;
      const sideA = 'team_a_id' in patch ? patch.team_a_id : cur.team_a_id;
      const sideB = 'team_b_id' in patch ? patch.team_b_id : cur.team_b_id;
      // B08-F10: the winner is one of the two teams in the match — a stranger was
      // accepted and advanced into the final. `null` clears a result: the match
      // goes back to scheduled and, below, its winner leaves the next round.
      let clearing = false;
      if ('winner_team_id' in upd) {
        if (upd.winner_team_id === null) {
          patch.winner_team_id = null;
          clearing = !!cur.winner_team_id;
          if (clearing && upd.status === undefined) patch.status = 'scheduled';
        } else if (!isUuid(upd.winner_team_id) || (upd.winner_team_id !== sideA && upd.winner_team_id !== sideB)) {
          skip('The winner must be one of the two teams in this match.'); continue;
        } else {
          patch.winner_team_id = upd.winner_team_id;
        }
      }
      if (upd.status) patch.status = upd.status;
      if (Object.keys(patch).length === 0) continue;

      const settingWinner = 'winner_team_id' in patch || patch.status === 'completed';

      // SC-23: once a winner has advanced into the next round and that match has
      // started, don't let the organizer rewrite this result out from under it.
      if (settingWinner && cur.next_match_id) {
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
      // a new status or a result (e.g. organizer marking 'completed' for an
      // offline match, or clearing one).
      let query = supabase
        .from('matches')
        .update(patch)
        .eq('id', fixtureId)
        .eq('tournament_id', id);
      if (!('status' in upd) && !('winner_team_id' in upd)) {
        query = query.eq('status', 'scheduled');
      }
      const { data, error } = await query.select('*').maybeSingle();
      if (error || !data) {
        // eslint-disable-next-line no-console
        if (error) console.error('[fixtures] update failed', fixtureId, error.message); // was silent (BUILD 2.1 harness)
        skip(error ? 'Couldn’t save this fixture. Try again.' : 'Only a fixture that hasn’t started can be moved.');
        continue;
      }
      results.push(data);
      // CHANGE NOTIF: collect who needs to know this fixture moved.
      if (touchesResched && oldResched) {
        const changed = RESCHED_KEYS.some((k) => String(oldResched[k] ?? '') !== String((data as any)[k] ?? ''));
        if (changed) {
          // SC-270: the ENTRANT TEAMS' members UNION any lineup already set,
          // deduped (matchAudienceIds). Participants-only reached NOBODY on a
          // pre-match reschedule (the normal case) — a bracket fixture has no
          // participants until scoring.
          const recipients = await matchAudienceIds(fixtureId, data.team_a_id, data.team_b_id);
          const slot = formatSlotIst(data.scheduled_at, data.ground_label);
          for (const uid of recipients) {
            const arr = affectedByUser.get(uid) ?? [];
            arr.push({ matchId: fixtureId, slot });
            affectedByUser.set(uid, arr);
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
      if (clearing) {
        // B08-F10: take the old winner back out of the next round while that
        // match hasn't started (SC-23 above refused it otherwise).
        if (cur.next_match_id) {
          try {
            const slotIdCol = cur.next_slot === 'A' ? 'team_a_id' : 'team_b_id';
            const slotNameCol = cur.next_slot === 'A' ? 'team_a_name' : 'team_b_name';
            await supabase
              .from('matches')
              .update({ [slotIdCol]: null, [slotNameCol]: null })
              .eq('id', cur.next_match_id)
              .eq(slotIdCol, cur.winner_team_id)
              .eq('status', 'scheduled');
          } catch { /* best effort */ }
        }
      } else if (settingWinner) {
        // Propagate the winner into the bracket (SC-23) / auto-complete (SC-24).
        try {
          await advanceTournamentWinner(fixtureId);
        } catch {
          /* best effort */
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

    // B08-F10: one fixture from the editor — say plainly why it didn't save.
    if (items.length === 1 && results.length === 0) {
      if (skipped.length === 1) return res.status(400).json({ error: skipped[0]!.reason, code: 'FIXTURE_NOT_SAVED' });
      if (blocked.length === 1) {
        return res.status(409).json({ error: 'The next round has already started, so this result can’t change.', code: 'NEXT_ROUND_STARTED' });
      }
    }
    return res.json({
      updated: results.length,
      fixtures: results,
      blocked: blocked.length ? blocked : undefined,
      warnings: warnings.length ? warnings : undefined,
      skipped: skipped.length ? skipped : undefined,
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

    // N2 (visual review): this used to add ANY caller as a member, so anyone
    // with a tournament id could read its chat. Only the organisers and the
    // players of approved teams may open it (decision D7). B08-F19: asked
    // BEFORE anything is written — a refused stranger used to create the chat
    // (and repoint _chat_id) on the way to the 403.
    if (!(await canOpenTournamentChat(id, userId))) {
      return res.status(403).json({
        error: 'Only this tournament’s organisers and players can open its chat.',
        code: 'NOT_IN_TOURNAMENT',
      });
    }

    // Check if a chat already exists via sport_metadata._chat_id
    const meta: Record<string, unknown> = (tournament.sport_metadata as Record<string, unknown>) ?? {};
    let chatId: string | null = (meta._chat_id as string) ?? null;

    if (chatId) {
      // Verify the chat still exists
      const { data: existing } = await supabase.from('chats').select('id').eq('id', chatId).is('deleted_at', null).maybeSingle();
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

    // For those allowed in, the sync makes sure they — and everyone else who
    // belongs — are in it.
    await syncTournamentChatMembers(id);

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
  /** BUILD 1.3: per-match settings every fixture carries (cricket: overs). */
  fixtureDefaults?: Record<string, unknown>;
  /** BUILD 2.4: per-stage fixture fields (the bracket's last round is the final). */
  stageDefaults?: (stage: Stage) => Record<string, unknown>;
}

function nextPow2(n: number): number {
  let p = 1;
  while (p < n) p *= 2;
  return p;
}

// (SC-378) The old index-order buildRound1 lived here. Direct knockout now uses
// seededRound1 below — the same standard bracket as the groups→KO path — so
// pairings and byes follow seed order instead of array position.

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
/** A fixture's rules at the draw: its stage's; a doubles event's are 2 a side (badminton gap 7). */
export function fixtureRulesFor(sport: string | null | undefined, tournamentRules: unknown, stage: Stage, entryKind: string | null | undefined) {
  const rules = stageRules(sport, tournamentRules, stage);
  if (entryKind === 'doubles' && doublesRulesSport(sport) && !(rules as { rubbers?: unknown }).rubbers) return { ...rules, players: 2 } as typeof rules;
  return rules;
}

/** Badminton gap 4: a knockout round's stage — the final, the quarter- and semi-finals ("from the quarter-finals"), or an earlier round. */
export function knockoutStage(round: number, roundsCount: number): Stage {
  if (round === roundsCount) return 'final';
  return roundsCount - round <= 2 ? 'qf' : 'knockout';
}

async function insertSingleElim(
  base: BracketBase,
  round1: Array<{ a: TeamSlot | null; b: TeamSlot | null }>,
  slotFor: (round: number, matchNo: number) => { scheduled_at: string; ground_label: string } | undefined,
  thirdPlace = false,
): Promise<{ byeMatchIds: string[] }> {
  const bracketSize = round1.length * 2;
  const roundsCount = Math.max(1, Math.round(Math.log2(bracketSize)));
  const withThird = hasThirdPlace(thirdPlace, roundsCount);
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
      // BUILD 4.12: the schedule has the final second in its round (bracketShape).
      const slot = slotFor(r, r === roundsCount && withThird ? 1 : m);
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
        ...(base.stageDefaults ? base.stageDefaults(knockoutStage(r, roundsCount)) : (base.fixtureDefaults ?? {})),
      });
    }
    const { data, error } = await supabase.from('matches').insert(rows).select('id, match_no');
    if (error) throw new Error(error.message);
    for (const d of data ?? []) created[`${r}:${d.match_no}`] = d.id as string;
    // BUILD 4.12: the third-place match sits in the final's round, flagged, with
    // no next match; the semi-final losers fill it (advanceTournamentWinner).
    if (r === roundsCount && withThird) {
      const slot = slotFor(r, 0);
      const { error: tpErr } = await supabase.from('matches').insert({
        sport_id: base.sport_id,
        tournament_id: base.tournament_id,
        team_a_id: null,
        team_b_id: null,
        team_a_name: 'TBD',
        team_b_name: 'TBD',
        scheduled_at: slot?.scheduled_at ?? base.fallbackStartIso,
        ground_label: slot?.ground_label ?? null,
        venue: base.venue,
        city_id: base.city_id,
        status: 'scheduled',
        score_summary: {},
        created_by: base.created_by,
        round: r,
        match_no: 1,
        next_match_id: null,
        next_slot: null,
        third_place: true,
        is_ranked: true,
        ...(base.stageDefaults ? base.stageDefaults('qf') : (base.fixtureDefaults ?? {})), // gap 4: played with the semi-finals
      });
      if (tpErr) throw new Error(tpErr.message);
    }
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
/** BUILD 4.8 · a tournament's settings (for a fixture's walkover), or null. */
export async function tournamentSettingsOf(tournamentId: string | null | undefined): Promise<unknown> {
  if (!tournamentId) return null;
  const { data } = await supabase.from('tournaments').select('settings').eq('id', tournamentId).maybeSingle();
  return (data as { settings?: unknown } | null)?.settings ?? null;
}

/** BUILD 4.1 · whether any fixture has a result (completed, abandoned or given a winner), voided ones aside. */
async function tournamentHasResult(tournamentId: string): Promise<boolean> {
  const { count } = await supabase
    .from('matches').select('id', { count: 'exact', head: true })
    .eq('tournament_id', tournamentId).is('voided_at', null)
    .or('status.in.(completed,abandoned),winner_team_id.not.is.null');
  return (count ?? 0) > 0;
}

async function hasUnplayedFixtures(tournamentId: string): Promise<boolean> {
  const { count } = await supabase
    .from('matches')
    .select('id', { count: 'exact', head: true })
    .eq('tournament_id', tournamentId)
    .in('status', ['scheduled', 'live'])
    // FORMATS (28 Sep): a voided fixture is not going to be played. Counting it
    // kept a round robin whose last fixture was voided "live" forever, with no
    // champion (found on live: P3 FMT Football RR 5).
    .is('voided_at', null);
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
/** BUILD 1.6: the points a result earns in this tournament's sport (chess 1 / ½ / 0); BUILD 4.1: its points template when it has one. */
async function tournamentPoints(t: { sport_id?: unknown; settings?: unknown } | null | undefined): Promise<PointsModel> {
  return pointsFor(normSportSlug((await getSport(t?.sport_id as string))?.slug), t?.settings);
}

/**
 * V104 · who won this tournament, by the same rules the automatic crowning
 * uses: the standings leader for round robin / league, otherwise the winner of
 * the final (the bracket match with no next match and no group). Null when
 * there is no decided, unvoided final.
 */
export async function championOf(tournamentId: string): Promise<{ id: string; name: string | null } | null> {
  const { data: t } = await supabase
    .from('tournaments').select('format, tiebreaker_rules, sport_id, settings').eq('id', tournamentId).maybeSingle();
  const fmt = (t as any)?.format;
  if (fmt === 'round_robin' || fmt === 'league' || fmt === 'swiss') { // BUILD 4.15: a Swiss is won on the table
    const { data: entries } = await supabase
      .from('tournament_entries').select('team_id, team:teams!team_id(id, name, short_name)')
      .eq('tournament_id', tournamentId).eq('status', 'approved');
    const teamIds = Array.from(new Set((entries ?? []).map((e) => e.team_id as string).filter(Boolean)));
    if (teamIds.length === 0) return null;
    const { data: matches } = await supabase
      .from('matches').select('team_a_id, team_b_id, winner_team_id, status, score_summary, overs')
      .eq('tournament_id', tournamentId).is('voided_at', null);
    // Badminton gap 6: a withdrawn player's results deleted (BWF GCR), when the tournament says so.
    const tin = tableInputs((t as any)?.settings, teamIds, (matches ?? []) as any[], await withdrawnTeamIds(tournamentId));
    const leader = rankTeams(
      tin.teamIds, tin.matches, ((t as any)?.tiebreaker_rules ?? []) as any[], await tournamentPoints(t as any),
    )[0];
    if (!leader) return null;
    const e = (entries ?? []).find((x) => x.team_id === leader);
    return { id: leader, name: ((e?.team as any)?.name as string) ?? null };
  }
  const { data: finals } = await supabase
    .from('matches')
    .select('winner_team_id, team_a_id, team_b_id, team_a_name, team_b_name, round, third_place')
    .eq('tournament_id', tournamentId)
    .is('next_match_id', null)
    .is('group_label', null)
    // BUILD 1.4: a final decided by a withdrawal walkover is abandoned WITH a
    // winner — it still crowns.
    .in('status', ['completed', 'abandoned'])
    .is('voided_at', null)
    .not('winner_team_id', 'is', null)
    .order('round', { ascending: false })
    .limit(3);
  // BUILD 4.12: the third-place match has no next match either — it never crowns.
  const f = (finals ?? []).find((r) => !(r as { third_place?: boolean }).third_place);
  if (!f?.winner_team_id) return null;
  const name = f.winner_team_id === f.team_a_id ? f.team_a_name : f.winner_team_id === f.team_b_id ? f.team_b_name : null;
  return { id: f.winner_team_id as string, name: (name as string) ?? null };
}

/**
 * Decision 27 Sep 2026: voiding a final clears the champion — the tournament
 * then reads "No champion · the final was voided"; restoring the final crowns
 * the winner again. Called after a match's voided_at changes. Only a completed
 * bracket tournament's final matters: championOf already ignores voided
 * matches, so re-deriving it gives the right answer both ways. League /
 * round-robin standings are out of scope here (no single final).
 */
export async function recrownAfterVoidChange(matchId: string): Promise<void> {
  try {
    const { data: m } = await supabase
      .from('matches').select('tournament_id, next_match_id, group_label').eq('id', matchId).maybeSingle();
    if (!m?.tournament_id) return;
    const { data: t } = await supabase
      .from('tournaments').select('status, format, champion_team_id').eq('id', m.tournament_id).maybeSingle();
    if (!t) return;
    // FORMATS (28 Sep): voiding the last fixture still to play finishes that
    // stage, but only a completed result used to move a competition on. So a
    // round robin or league whose remaining fixture was voided never crowned,
    // and a group stage never seeded its knockout. Both checks wait for every
    // unvoided fixture, so they're no-ops until the void really was the last.
    if (t.status === 'upcoming' || t.status === 'live') {
      if (m.group_label) await maybeSeedKnockout(m.tournament_id as string);
      else if (t.format === 'league' || t.format === 'round_robin') await crownLeagueChampion(m.tournament_id as string);
      else if (t.format === 'swiss') await swissAfterResult(m.tournament_id as string); // BUILD 4.15
      // BUILD 4.12: voiding the third-place match (or the final) can leave the
      // bracket finished — complete it then, as a completion would.
      else if (!m.next_match_id) await completeBracketIfDone(m.tournament_id as string);
      return;
    }
    if (m.next_match_id || m.group_label) return;
    if (t.status !== 'completed') return;
    if (t.format === 'league' || t.format === 'round_robin' || t.format === 'swiss') return;
    const champ = await championOf(m.tournament_id as string);
    const next = champ?.id ?? null;
    if (next === (t.champion_team_id ?? null)) return;
    await supabase.from('tournaments').update({ champion_team_id: next }).eq('id', m.tournament_id);
  } catch (e) {
    // eslint-disable-next-line no-console
    console.error('[tournaments] recrown after void failed', matchId, e instanceof Error ? e.message : e);
  }
}

/** Badminton gap 6: the teams withdrawn from this tournament (their results may be deleted from tables). */
async function withdrawnTeamIds(tournamentId: string): Promise<string[]> {
  const { data } = await supabase.from('tournament_entries').select('team_id').eq('tournament_id', tournamentId).eq('status', 'withdrawn');
  return ((data ?? []) as Array<{ team_id: string }>).map((e) => e.team_id);
}

async function crownLeagueChampion(tournamentId: string): Promise<void> {
  if (await hasUnplayedFixtures(tournamentId)) return;
  const { data: entries } = await supabase
    .from('tournament_entries')
    .select('team_id, team:teams!team_id(id, name, short_name)')
    .eq('tournament_id', tournamentId)
    .eq('status', 'approved');
  const teamIds = Array.from(new Set((entries ?? []).map((e) => e.team_id).filter(Boolean)));
  if (teamIds.length === 0) return;
  const nameOf: Record<string, string> = {};
  for (const e of entries ?? []) nameOf[e.team_id as string] = (e.team as any)?.name ?? 'Team';

  const { data: matches } = await supabase
    .from('matches')
    .select('team_a_id, team_b_id, winner_team_id, status, score_summary, overs')
    .eq('tournament_id', tournamentId)
    .is('voided_at', null); // SC-424: a voided fixture is not a played fixture
  const { data: trow } = await supabase
    .from('tournaments').select('tiebreaker_rules, sport_id, settings').eq('id', tournamentId).maybeSingle();
  const tiebreakerRules = ((trow as any)?.tiebreaker_rules ?? []) as any[];
  const pts = await tournamentPoints(trow as any);

  const tin = tableInputs((trow as any)?.settings, teamIds as string[], (matches ?? []) as any[], await withdrawnTeamIds(tournamentId)); // gap 6
  const ordered = rankTeams(tin.teamIds, tin.matches, tiebreakerRules, pts);
  const championId = ordered[0];
  if (!championId) return;

  const { data: crowned } = await supabase
    .from('tournaments')
    .update({ status: 'completed', champion_team_id: championId, updated_at: new Date().toISOString() })
    .eq('id', tournamentId)
    // B08-F7: a draw made before the start date leaves the tournament
    // `upcoming` (F-52); results recorded then must still crown it.
    .in('status', ['upcoming', 'live'])
    .select('id, name')
    .maybeSingle();
  if (crowned) {
    await notifyTournamentChampion(tournamentId, championId, nameOf[championId] ?? null, crowned.name ?? null);
    await refreshParentOf(tournamentId); // badminton gap 1
  }
}

/**
 * BUILD 4.15 · a Swiss round's match rows: white is side A. A bye is a
 * completed one-player match, marked `bye`, worth a win — the table counts it
 * (standings.ts), and older apps list it like a knockout bye.
 */
function swissRoundRows(
  round: SwissRound, roundNo: number, nameOf: Map<string, string>,
  base: { sport_id: unknown; tournament_id: string; venue: unknown; city_id: unknown; created_by: string; fixtureDefaults: Record<string, unknown> },
): any[] {
  const rows: any[] = round.pairs.map((p, i) => ({
    sport_id: base.sport_id, tournament_id: base.tournament_id,
    team_a_id: p.white, team_b_id: p.black,
    team_a_name: nameOf.get(p.white) ?? 'Player', team_b_name: nameOf.get(p.black) ?? 'Player',
    venue: base.venue, city_id: base.city_id, status: 'scheduled', score_summary: {}, created_by: base.created_by,
    round: roundNo, match_no: i, is_ranked: true, ...base.fixtureDefaults,
  }));
  if (round.bye) {
    rows.push({
      sport_id: base.sport_id, tournament_id: base.tournament_id,
      team_a_id: round.bye, team_b_id: null,
      team_a_name: nameOf.get(round.bye) ?? 'Player', team_b_name: 'BYE',
      venue: base.venue, city_id: base.city_id, status: 'completed', winner_team_id: round.bye,
      score_summary: { bye: true, A: { score: 1 }, B: { score: 0 }, result: `${nameOf.get(round.bye) ?? 'Player'} has a bye (a win)` },
      created_by: base.created_by, round: roundNo, match_no: round.pairs.length, is_ranked: false, ...base.fixtureDefaults,
    });
  }
  return rows;
}

/**
 * BUILD 4.15 · after a Swiss result: once the round is finished, pair the next
 * one (a CAS on settings.swiss.paired, so two results landing together pair it
 * once), or — after the last round — crown the standings leader.
 */
async function swissAfterResult(tournamentId: string): Promise<void> {
  if (await hasUnplayedFixtures(tournamentId)) return;
  const { data: t } = await supabase
    .from('tournaments').select('id, sport_id, venue, city_id, created_by, settings, tiebreaker_rules, match_rules, match_duration_minutes, buffer_minutes')
    .eq('id', tournamentId).maybeSingle();
  if (!t) return;
  const sw = settingsOf(t as { settings?: unknown }).swiss;
  if (!sw) return;
  const paired = sw.paired ?? 1;
  if (paired >= sw.rounds) { await crownLeagueChampion(tournamentId); return; }
  // Claim the next round.
  const { data: claim } = await supabase
    .from('tournaments')
    .update({ settings: { ...settingsOf(t as { settings?: unknown }), swiss: { rounds: sw.rounds, paired: paired + 1 } }, updated_at: new Date().toISOString() })
    .eq('id', tournamentId)
    .eq('settings->swiss->>paired', String(paired))
    .select('id');
  if (!claim || claim.length === 0) return;
  const { data: entries } = await supabase
    .from('tournament_entries').select('team_id, seed, entered_at, team:teams!team_id(id, name, short_name)')
    .eq('tournament_id', tournamentId).eq('status', 'approved');
  const seeded = drawOrder(((entries ?? []) as Array<{ team_id: string; seed?: number | null; entered_at?: string | null }>), settingsOf(t as { settings?: unknown }).seeding ?? null);
  const ids = seeded.map((e) => e.team_id);
  const nameOf = new Map(((entries ?? []) as Array<{ team_id: string; team?: { name?: string } | null }>).map((e) => [e.team_id, e.team?.name ?? 'Player']));
  const { data: matches } = await supabase
    .from('matches').select('team_a_id, team_b_id, winner_team_id, status, score_summary, scheduled_at, overs')
    .eq('tournament_id', tournamentId).is('voided_at', null);
  const ms = (matches ?? []) as Array<{ team_a_id: string | null; team_b_id: string | null; winner_team_id: string | null; status: string; score_summary: any; scheduled_at: string | null }>;
  const pts = await tournamentPoints(t as any);
  const ranked = rankTeams(ids, ms as any[], ((t as any).tiebreaker_rules ?? []) as any[], pts);
  const next = swissNextRound(ranked, ms.map((m) => ({ white: m.team_a_id, black: m.team_b_id, bye: m.score_summary?.bye === true })));
  const slug = normSportSlug((await getSport(t.sport_id as string))?.slug);
  const rules = stageRules(slug, (t as { match_rules?: unknown }).match_rules ?? null, 'group');
  const legacy = legacyFromRules(slug, rules);
  const rows = swissRoundRows(next, paired + 1, nameOf, {
    sport_id: t.sport_id, tournament_id: tournamentId, venue: t.venue ?? null, city_id: t.city_id ?? null,
    created_by: t.created_by as string, fixtureDefaults: { format: legacy.format, rules },
  });
  // Timed after the previous round's last game (its length plus the buffer).
  const lastAt = Math.max(...ms.map((m) => (m.scheduled_at ? Date.parse(m.scheduled_at) : 0)), Date.now());
  const gap = (Number((t as any).match_duration_minutes ?? 60) + Number((t as any).buffer_minutes ?? 10)) * 60000;
  for (const r of rows) r.scheduled_at = new Date(lastAt + gap).toISOString();
  await supabase.from('matches').insert(rows).select('id');
}

export async function advanceTournamentWinner(matchId: string): Promise<void> {
  await advanceTournamentWinnerInner(matchId);
  // Badminton gap 7: whoever moved on is in the next fixture's line-up.
  const { data: tm } = await supabase.from('matches').select('tournament_id').eq('id', matchId).maybeSingle();
  if ((tm as { tournament_id?: string } | null)?.tournament_id) await fillEntryLineups((tm as { tournament_id: string }).tournament_id);
}

async function advanceTournamentWinnerInner(matchId: string): Promise<void> {
  const { data: m } = await supabase
    .from('matches')
    .select('id, tournament_id, winner_team_id, next_match_id, next_slot, group_label, round, match_no, team_a_id, team_b_id, team_a_name, team_b_name, third_place')
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
  // BUILD 4.15: a Swiss pairs its next round, or crowns after the last.
  if (fmt === 'swiss') {
    await swissAfterResult(m.tournament_id);
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
    // The final — or (BUILD 4.12) the third-place match, which has no next
    // match either. Whichever is decided last completes the tournament; only
    // the final crowns.
    await completeBracketIfDone(m.tournament_id, (m as { third_place?: boolean }).third_place ? null : m);
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
  // BUILD 4.12: a semi-final's loser goes to the third-place match.
  await placeSemiLoser(m as SemiRow, winnerId);
}

type SemiRow = { tournament_id: string; next_match_id: string | null; match_no: number | null; team_a_id: string | null; team_b_id: string | null; team_a_name: string | null; team_b_name: string | null };

/**
 * BUILD 4.12 · when a semi-final (a match whose next match is the final) is
 * decided, its loser takes a slot in the tournament's third-place match — the
 * first semi's in A, the second's in B. Like the winner's slot (SC-87), a
 * re-decided semi overwrites it while that match is still scheduled. A loser
 * who has withdrawn gives its opponent a walkover once both are there.
 */
async function placeSemiLoser(m: SemiRow, winnerId: string): Promise<void> {
  if (!m.next_match_id) return;
  const { data: final } = await supabase
    .from('matches').select('id, next_match_id, third_place').eq('id', m.next_match_id).maybeSingle();
  if (!final || final.next_match_id || (final as { third_place?: boolean }).third_place) return;
  const { data: tps } = await supabase
    .from('matches').select('id, status, team_a_id, team_b_id, team_a_name, team_b_name, third_place')
    .eq('tournament_id', m.tournament_id).is('next_match_id', null).is('group_label', null);
  const tp = (tps ?? []).find((x) => (x as { third_place?: boolean }).third_place) as Record<string, any> | undefined;
  if (!tp) return;
  // A bye semi (one team) has no loser: its slot is a BYE.
  const loserId = winnerId === m.team_a_id ? m.team_b_id : winnerId === m.team_b_id ? m.team_a_id : null;
  const loserName = loserId ? (loserId === m.team_a_id ? m.team_a_name : m.team_b_name) : 'BYE';
  const slot = (m.match_no ?? 0) % 2 === 0 ? 'a' : 'b';
  const oth = slot === 'a' ? 'b' : 'a';
  const current = tp[`team_${slot}_id`] ?? null;
  if (current === loserId && (loserId || tp[`team_${slot}_name`] === 'BYE')) return;
  if (current && tp.status !== 'scheduled') return; // started: frozen, as SC-87
  await supabase.from('matches').update({ [`team_${slot}_id`]: loserId, [`team_${slot}_name`]: loserName ?? 'Loser' }).eq('id', tp.id);
  const otherId = (tp[`team_${oth}_id`] ?? null) as string | null;
  const otherBye = !otherId && tp[`team_${oth}_name`] === 'BYE';
  // One side a bye → the other takes third without playing.
  if (loserId && otherBye) { await resolveMatchWinner(tp.id, loserId); return; }
  if (!loserId && otherId) { await resolveMatchWinner(tp.id, otherId); return; }
  if (!loserId || !otherId) return;
  // A withdrawn team can't play for third: its opponent takes it by walkover.
  const { data: gone } = await supabase
    .from('tournament_entries').select('team_id').eq('tournament_id', m.tournament_id)
    .in('team_id', [loserId, otherId]).eq('status', 'withdrawn');
  const withdrawn = (gone ?? [])[0]?.team_id as string | undefined;
  if (withdrawn) await walkoverOnWithdraw(m.tournament_id, withdrawn);
}

/**
 * The final and (BUILD 4.12) any third-place match are both decided and the
 * rest of the bracket played → complete the tournament and crown the final's
 * winner. SC-24 / SC-86 / SC-253: only with the whole bracket played, once
 * (the status CAS), notifying on the real transition only.
 */
type FinalRow = { winner_team_id: string | null; team_a_id: string | null; team_b_id: string | null; team_a_name: string | null; team_b_name: string | null };
async function completeBracketIfDone(tournamentId: string, knownFinal: FinalRow | null = null): Promise<void> {
  if (await hasUnplayedFixtures(tournamentId)) return;
  // The final that was just decided, or — when the third-place match was — the final, looked up.
  let final: FinalRow | undefined = knownFinal ?? undefined;
  if (!final) {
    const { data: rows } = await supabase
      .from('matches')
      .select('winner_team_id, team_a_id, team_b_id, team_a_name, team_b_name, round, third_place')
      .eq('tournament_id', tournamentId)
      .is('next_match_id', null)
      .is('group_label', null)
      .is('voided_at', null)
      .order('round', { ascending: false });
    final = (Array.isArray(rows) ? rows : []).find((r) => !(r as { third_place?: boolean }).third_place) as FinalRow | undefined;
  }
  const winnerId = final?.winner_team_id as string | null | undefined;
  if (!final || !winnerId) return;
  const championName =
    winnerId === final.team_a_id ? final.team_a_name : winnerId === final.team_b_id ? final.team_b_name : null;
  const { data: crowned } = await supabase
    .from('tournaments')
    .update({ status: 'completed', champion_team_id: winnerId, updated_at: new Date().toISOString() })
    .eq('id', tournamentId)
    .in('status', ['upcoming', 'live']) // B08-F7, as in crownLeagueChampion
    .select('id, name')
    .maybeSingle();
  if (crowned) {
    await notifyTournamentChampion(tournamentId, winnerId, championName as string | null, crowned.name ?? null);
    await refreshParentOf(tournamentId); // badminton gap 1
  }
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
    .select('id, team_a_id, team_b_id, status, sport_id, format, overs, rules, score_summary')
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
    // Walkover: opponent wins the forfeited match and advances. BUILD 3.21: a
    // football walkover goes down as 3–0 / 5–0.
    const slug = normSportSlug((await getSport(mt.sport_id as string))?.slug);
    // BUILD 4.8: the tournament's walkover score, when it has one.
    const ss = withWalkoverScore(slug, rulesOf(slug, mt), { ...(mt.score_summary as object ?? {}), walkover: true }, opponentId === mt.team_a_id ? 'A' : 'B', await tournamentSettingsOf(tournamentId));
    await supabase
      .from('matches')
      .update({ status: 'abandoned', winner_team_id: opponentId, score_summary: ss, updated_at: now })
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
    .select('id, status, winner_team_id, team_a_id, team_b_id, score_summary, overs')
    .eq('tournament_id', tournamentId)
    .eq('round', 0)
    // SC-424: a voided group fixture neither blocks seeding nor seeds a team.
    .is('voided_at', null);
  if (!groupMatches || groupMatches.length === 0) return;
  // BUILD 1.4: an abandoned group match is finished too (a no-result or a
  // walkover). Waiting for it to complete held the knockout back forever.
  if (groupMatches.some((g) => g.status !== 'completed' && g.status !== 'abandoned')) return;

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
    .select('team_id, group_label, club, status, team:teams!team_id(id, name, short_name)')
    .eq('tournament_id', tournamentId)
    .not('group_label', 'is', null);

  // SC-58: deterministic standings (wins desc, then team id — NEVER DB row
  // order) + config-driven qualifiers per group + a properly SEEDED bracket so
  // byes fall on the strongest qualifiers instead of arbitrary array indices.
  const cfg = await getGroupsConfig(tournamentId);
  const qualsPerGroup = cfg.qualifiersPerGroup;
  const { data: trow } = await supabase
    .from('tournaments').select('tiebreaker_rules, sport_id, settings').eq('id', tournamentId).maybeSingle();
  const tiebreakerRules = ((trow as any)?.tiebreaker_rules ?? []) as any[];
  const pts = await tournamentPoints(trow as any);

  const nameOf: Record<string, string> = {};
  const groupTeams: Record<string, string[]> = {};
  // Badminton gap 6: with withdrawnResults 'delete', a withdrawn entry leaves its group and its results go.
  const goneIds = (trow as any)?.settings?.withdrawnResults === 'delete'
    ? new Set(((entries ?? []) as Array<{ team_id: string; status?: string }>).filter((e) => e.status === 'withdrawn').map((e) => e.team_id))
    : new Set<string>();
  for (const e of entries ?? []) {
    if (goneIds.has(e.team_id as string)) continue;
    const label = (e.group_label as string) ?? '?';
    const tid = e.team_id as string;
    nameOf[tid] = (e.team as any)?.name ?? 'Team';
    (groupTeams[label] ??= []).push(tid);
  }
  const labels = Object.keys(groupTeams).sort();
  const tableMatches = goneIds.size
    ? groupMatches.filter((m) => !goneIds.has((m as { team_a_id?: string }).team_a_id ?? '') && !goneIds.has((m as { team_b_id?: string }).team_b_id ?? ''))
    : groupMatches;

  // SC-89: rank each group with the full tiebreak ladder (points -> head-to-head
  // -> score-diff -> score-scored -> team_id), honouring the tournament's
  // configured tiebreaker_rules when set. team_id terminator = no strand.
  const globalStats = computeStats(Object.keys(nameOf), tableMatches, undefined, pts);
  const ptsOf = (id: string) => globalStats.get(id)?.points ?? 0;

  // ranks[r] = every team that finished position r (0-based) in its group.
  const ranks: Array<Array<{ id: string; name: string }>> = [];
  for (const label of labels) {
    const orderedIds = rankTeams(groupTeams[label], tableMatches, tiebreakerRules, pts);
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
  // BUILD 4.5: the best next-placed teams across the groups fill the byes —
  // the lowest seeds, so they meet the group winners.
  if (settingsOf(trow as { settings?: unknown }).bestThirds) {
    const open = ko1.length * 2 - seeds.length;
    const ranked = labels.map((label) => rankTeams(groupTeams[label], tableMatches, tiebreakerRules, pts));
    for (const id of bestPlacedAcrossGroups(ranked, qualsPerGroup, open, globalStats)) seeds.push({ id, name: nameOf[id] ?? 'Team' });
  }
  if (seeds.length < 2) return;
  // FORMATS (28 Sep): cross-pair, so group mates don't meet straight away.
  const groupOfTeam = new Map<string, string>();
  for (const label of labels) for (const id of groupTeams[label]) groupOfTeam.set(id, label);
  const crossed = crossGroupFirstRound(seededRound1(seeds, ko1.length * 2), (id) => groupOfTeam.get(id));
  // BUILD 4.13: and same-club qualifiers apart, without undoing the cross-pairing.
  const clubOfTeam = new Map((entries ?? []).map((e: { team_id: string; club?: string | null }) => [e.team_id, e.club ?? null]));
  const round1 = settingsOf(trow as { settings?: unknown }).separateClubs
    ? separateClubsInRound1(crossed, (tid) => clubOfTeam.get(tid) ?? null, (x, y) => groupOfTeam.get(x) === groupOfTeam.get(y))
    : crossed;

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
      restMin: settingsOf(t).restMinutes ?? 0, // BUILD 4.9
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
    restMin: settingsOf(t).restMinutes ?? 0, // BUILD 4.9
  };
}

// Load per-day window overrides (tournament_days) into a Map<'YYYY-MM-DD', {startMin,endMin}>.
// Read defensively so generation still runs if migration 063 hasn't been applied.
async function loadDayWindows(tournamentId: string): Promise<Map<string, { startMin: number; endMin: number }>> {
  const map = new Map<string, { startMin: number; endMin: number }>();
  try {
    // Badminton gap 1: an event plays in its tournament's day windows.
    const { data: own } = await supabase.from('tournaments').select('parent_id').eq('id', tournamentId).maybeSingle();
    const windowsOf = (own as { parent_id?: string | null } | null)?.parent_id || tournamentId;
    const { data } = await supabase
      .from('tournament_days')
      .select('day_date, start_time, end_time')
      .eq('tournament_id', windowsOf);
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
function bracketShape(round1: Array<{ a: TeamSlot | null; b: TeamSlot | null }>, thirdPlace = false): FixtureShape[] {
  const bracketSize = round1.length * 2;
  const roundsCount = Math.max(1, Math.round(Math.log2(bracketSize)));
  const shape: FixtureShape[] = [];
  for (let r = roundsCount; r >= 1; r--) {
    const matchesInRound = bracketSize / Math.pow(2, r);
    for (let m = 0; m < matchesInRound; m++) {
      const a = r === 1 ? round1[m].a : null;
      const b = r === 1 ? round1[m].b : null;
      // BUILD 4.12: with a third-place match the final is scheduled second in
      // its round (it's played last), the third-place match first — see
      // finalSlotKey / thirdPlaceSlotKey.
      shape.push({ round: r, match_no: r === roundsCount && hasThirdPlace(thirdPlace, roundsCount) ? 1 : m, team_a_id: a?.id ?? null, team_b_id: b?.id ?? null });
    }
  }
  if (hasThirdPlace(thirdPlace, roundsCount)) shape.push({ round: roundsCount, match_no: 0, team_a_id: null, team_b_id: null });
  return shape;
}

/** BUILD 4.12: a third-place match needs semi-finals (a bracket of 4 or more). */
function hasThirdPlace(on: boolean, roundsCount: number): boolean {
  return on && roundsCount >= 2;
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

/**
 * SC-48's claim, given back. B08-F3: a schedule that didn't fit answered 400
 * but kept the claim — fixtures_generated true, no fixtures — so the next try
 * said "already generated", entries were refused, and the app hid Generate and
 * Add team. Every early return after the claim releases it.
 */
async function releaseFixtureClaim(tournamentId: string): Promise<void> {
  await supabase.from('tournaments').update({ fixtures_generated: false }).eq('id', tournamentId);
}

export async function generateFixtures(req: Request, res: Response) {
  const userId = req.userId;
  if (!userId) return res.status(401).json({ error: 'Unauthorized' });
  try {
    const { id } = req.params;
    const { data: tournament } = await supabase
      .from('tournaments')
      .select('id, status, sport_id, format, city_id, venue, start_date, end_date, created_by, daily_start_time, daily_end_time, match_duration_minutes, buffer_minutes, ground_count, ground_names, match_rules, settings, is_parent, parent_id, entry_kind')
      .eq('id', id)
      .maybeSingle();
    if (!tournament) return res.status(404).json({ error: 'Tournament not found' });
    if (!(await isTournamentOrganiser(id, userId))) {
      return res.status(403).json({ error: 'Only the organiser can generate fixtures' });
    }
    // Badminton gap 1: each event is drawn on its own.
    if ((tournament as { is_parent?: boolean }).is_parent) {
      return res.status(409).json({ error: 'Make the draw for each event.', code: 'DRAW_PER_EVENT' });
    }
    // Badminton gap 7: a singles / doubles event's fixtures take their players as line-ups.
    syncAfterSuccess(res, () => fillEntryLineups(String(id)));
    // …and its tournament's status follows (the draw can make an event live).
    if ((tournament as { parent_id?: string | null }).parent_id) syncAfterSuccess(res, () => refreshParentOf(String(id)));
    // B08-F4: a draw on a cancelled (or finished) tournament wrote a fresh status
    // over it — "cancelled" came back as "upcoming" with a fixture scheduled.
    if (tournament.status === 'cancelled' || tournament.status === 'completed') {
      return res.status(409).json({
        error: tournament.status === 'cancelled' ? 'This tournament was cancelled.' : 'This tournament is finished.',
        code: 'TOURNAMENT_FINISHED',
      });
    }

    // SC-378: approved entries in a DETERMINISTIC order. There was no ORDER BY
    // at all, so the row order was whatever Postgres happened to return — the
    // same tournament could bracket differently on two generations, and byes
    // fell on arbitrary teams. Order: the organiser's explicit `seed` when set
    // (1 = strongest), then entry time, then team_id as the terminator so the
    // sequence is total and repeatable.
    const { data: fetched } = await supabase
      .from('tournament_entries')
      .select('id, team_id, seed, entered_at, group_label, club, team:teams!team_id(id, name, short_name)')
      .eq('tournament_id', id)
      .eq('status', 'approved')
      .order('seed', { ascending: true, nullsFirst: false })
      .order('entered_at', { ascending: true })
      .order('team_id', { ascending: true });
    // BUILD 4.6: the tournament's seeding — entry time, a random draw, or the
    // organiser's seeds (absent: seeds when set, then entry time, as above).
    const seeding = settingsOf(tournament as { settings?: unknown }).seeding ?? null;
    // BUILD 4.12: the semi-final losers play for third place.
    const thirdPlace = !!settingsOf(tournament as { settings?: unknown }).thirdPlace;
    // BUILD 4.13: keep same-club entries apart (their club label).
    const separateClubs = !!settingsOf(tournament as { settings?: unknown }).separateClubs;
    const clubOfTeam = new Map((fetched ?? []).map((e: { team_id: string; club?: string | null }) => [e.team_id, e.club ?? null]));
    const clubOf = (tid: string) => clubOfTeam.get(tid) ?? null;
    const entries = drawOrder((fetched ?? []) as Array<{ id: string; team_id: string; seed?: number | null; entered_at?: string | null; group_label?: string | null; team?: unknown }>, seeding);
    const teams = (entries ?? []).map((e: any) => ({
      id: e.team_id,
      name: (e.team as any)?.name ?? 'TBD',
    }));
    // BUILD 1.13: the group the organiser put each team in, if any.
    const groupEntries = (entries ?? []).map((e: any) => ({ id: e.team_id as string, label: (e.group_label as string | null) ?? null }));

    if (teams.length < 2) {
      return res.status(400).json({ error: 'At least 2 approved teams required' });
    }
    // BUILD 4.14: a team's roster can change after it entered — the draw checks
    // every team against the category again, naming who no longer fits.
    const drawCategory = settingsOf(tournament as { settings?: unknown }).category;
    if (drawCategory) {
      for (const t of teams) {
        const why = await categoryRefusalFor(drawCategory, t.id, (tournament as { sport_id?: string }).sport_id ?? null, (tournament as { start_date?: string | null }).start_date ?? null);
        if (why) return res.status(400).json({ error: `${t.name}: ${why}`, code: 'CATEGORY' });
      }
    }
    // BUILD 1.10: a group of one has no matches and the knockout never seeds.
    if (String(tournament.format ?? '').toLowerCase() === 'groups_knockout') {
      const why = groupsDrawRefusal(groupEntries, await getGroupsConfig(id));
      if (why) return res.status(400).json({ error: why, code: 'GROUPS_TOO_SMALL' });
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

    // BUILD 4.6: a random draw is written down as seeds 1…N, so the order it
    // made can be seen (and explained) after the draw.
    if (seeding === 'random') {
      for (let i = 0; i < entries.length; i++) {
        await supabase.from('tournament_entries').update({ seed: i + 1 }).eq('id', entries[i]!.id);
      }
    }

    const startDateYmd = (tournament.start_date ?? new Date().toISOString().slice(0, 10)) as string;
    const fallbackStartIso = new Date(`${startDateYmd}T00:00:00.000Z`).toISOString();
    const dayWindows = await loadDayWindows(id);
    const schedCfg = buildTournamentScheduleConfig(tournament, startDateYmd, dayWindows);
    // Badminton gap 3: an event shares its tournament's courts and players with
    // the other events — the slots they hold are taken, and a player's matches
    // across events are kept apart with the rest between them.
    const sharedSched = await sharedScheduleFor(tournament as { id: string; parent_id?: string | null }, entries.map((e) => String(e.team_id)), startDateYmd, schedCfg.durationMin);
    if (sharedSched) Object.assign(schedCfg, sharedSched);
    const format = (tournament.format ?? 'knockout').toLowerCase();
    // BUILD 1.3: tournament cricket fixtures had no overs, so they played the
    // 20-over default while NRR never knew the quota (the ICC all-out rule
    // charges a bowled-out side its full overs). They now carry it.
    const sportSlug = normSportSlug((await getSport(tournament.sport_id as string))?.slug);
    // BUILD 2.4: each fixture takes its stage's rules — the organiser's
    // tournaments.match_rules (group / knockout / final, falling back to
    // default), else the sport's standard — with format / overs in step for
    // older apps. (BUILD 1.3's T20 / 20 is cricket's standard.)
    const tournamentRules = (tournament as { match_rules?: unknown }).match_rules ?? null;
    const stageDefaults = (stage: Stage): Record<string, unknown> => {
      const rules = fixtureRulesFor(sportSlug, tournamentRules, stage, (tournament as { entry_kind?: string }).entry_kind);
      const legacy = legacyFromRules(sportSlug, rules);
      return { format: legacy.format, ...(sportSlug === 'cricket' ? { overs: legacy.overs } : {}), rules };
    };
    const fixtureDefaults: Record<string, unknown> = stageDefaults('group');
    const base: BracketBase = {
      stageDefaults,
      fixtureDefaults,
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
      //
      // SC-378: a DIRECT knockout is now seeded with the same standard bracket
      // the groups→KO path already used (seededRound1/SC-58): seed 1 opposite
      // the lowest seed, seeds 1 and 2 in opposite halves, top seeds meeting as
      // late as possible — and because a slot whose seed number exceeds the
      // field is a bye, the byes land on the TOP seeds, which is the standard
      // rule. It used to call buildRound1, which paired teams by raw array
      // index, so byes fell on whoever happened to sit at positions M..n.
      const seeded = seededRound1(teams, nextPow2(teams.length));
      const round1 = separateClubs ? separateClubsInRound1(seeded, clubOf) : seeded; // BUILD 4.13
      const shape = bracketShape(round1, thirdPlace);
      const sched = buildSchedule(shape, schedCfg);
      if (!sched.ok) { await releaseFixtureClaim(id); return res.status(400).json({ error: sched.error, code: 'SCHEDULE_CAPACITY' }); }
      const slotFor = (r: number, m: number): SlotAssign | undefined => sched.assignments.get(keyOf(r, m));
      const { byeMatchIds } = await insertSingleElim(base, round1, slotFor, thirdPlace);
      for (const byeId of byeMatchIds) {
        const { data: bm } = await supabase
          .from('matches')
          .select('team_a_id, team_b_id')
          .eq('id', byeId)
          .maybeSingle();
        const winnerId = bm?.team_a_id ?? bm?.team_b_id;
        if (winnerId) await resolveMatchWinner(byeId, winnerId);
      }
      // F-52: drawing the fixtures is preparation, not a start whistle. This goes
      // live only if the start date has arrived; otherwise the hourly sweep
      // (sweepTournamentsDue) flips it on the day.
      await supabase.from('tournaments')
        .update({ status: statusAfterFixtures(tournament.start_date as string | null) })
        .eq('id', id);
      const { count } = await supabase
        .from('matches')
        .select('id', { count: 'exact', head: true })
        .eq('tournament_id', id);
      return res.json({ success: true, matchesCreated: count ?? 0, format });
    }

    const matchRows: any[] = [];

    if (format === 'swiss') {
      // BUILD 4.15: round 1 now (top half v bottom half); each later round is
      // paired when the one before it is finished (swissAfterResult).
      const rounds = settingsOf(tournament as { settings?: unknown }).swiss?.rounds ?? 0;
      if (rounds < 2 || rounds > teams.length - 1) {
        await releaseFixtureClaim(id);
        return res.status(400).json({ error: `${teams.length} players can play at most ${teams.length - 1} Swiss rounds without meeting twice; this one has ${rounds}.`, code: 'SWISS_ROUNDS' });
      }
      const r1 = swissFirstRound(teams.map((t) => t.id));
      const nameOfId = new Map(teams.map((t) => [t.id, t.name]));
      const rows = swissRoundRows(r1, 1, nameOfId, { sport_id: tournament.sport_id, tournament_id: id, venue: tournament.venue ?? null, city_id: tournament.city_id ?? null, created_by: userId, fixtureDefaults });
      const sched = applyScheduleToRows(rows.filter((r) => !r.score_summary?.bye), schedCfg, fallbackStartIso);
      if (!sched.ok) { await releaseFixtureClaim(id); return res.status(400).json({ error: sched.error, code: 'SCHEDULE_CAPACITY' }); }
      for (const r of rows) if (r.score_summary?.bye) r.scheduled_at = rows.find((x) => !x.score_summary?.bye)?.scheduled_at ?? fallbackStartIso;
      const { error } = await supabase.from('matches').insert(rows).select('id');
      if (error) throw new Error('fixture insert failed');
      await supabase.from('tournaments')
        .update({ status: statusAfterFixtures(tournament.start_date as string | null), settings: { ...settingsOf(tournament as { settings?: unknown }), swiss: { rounds, paired: 1 } } })
        .eq('id', id);
      return res.json({ success: true, matchesCreated: rows.length, format });
    }

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
              ...fixtureDefaults,
            });
            mno++;
          }
        }
      }
      // Schedule: team-conflict matters here (everyone plays everyone) — no team
      // may sit in two matches in the same time-slot.
      const schedRR = applyScheduleToRows(matchRows, schedCfg, fallbackStartIso);
      if (!schedRR.ok) { await releaseFixtureClaim(id); return res.status(400).json({ error: schedRR.error, code: 'SCHEDULE_CAPACITY' }); }
      if (matchRows.length > 0) {
        const { error } = await supabase.from('matches').insert(matchRows).select('id');
        if (error) throw new Error('fixture insert failed');
      }
      // F-52: drawing the fixtures is preparation, not a start whistle. This goes
      // live only if the start date has arrived; otherwise the hourly sweep
      // (sweepTournamentsDue) flips it on the day.
      await supabase.from('tournaments')
        .update({ status: statusAfterFixtures(tournament.start_date as string | null) })
        .eq('id', id);
      return res.json({ success: true, matchesCreated: matchRows.length, format });
    }

    if (format === 'groups_knockout') {
      // Round-robin groups (round 0), then an empty KO bracket seeded from the
      // group standings once the group stage completes (maybeSeedKnockout).
      // SC-58: group count + qualifiers-per-group are organizer-configurable
      // (migration 038); fall back to the historical 4-per-group / top-2.
      const gcfg = await getGroupsConfig(id);
      // BUILD 1.13: groupsPlan keeps a group the organiser set and fills the
      // rest smallest-first (the old round-robin deal when nothing is set).
      const plan = planGroups(groupEntries, gcfg);
      if (!plan.ok) { await releaseFixtureClaim(id); return res.status(400).json({ error: plan.refusal, code: 'GROUPS_TOO_SMALL' }); }
      const numGroups = plan.groups.length;
      const qualsPerGroup = gcfg.qualifiersPerGroup;
      const slotOf = new Map(teams.map((t) => [t.id, t]));
      // BUILD 4.13: spread same-club entries across the groups (a team the
      // organiser put in a group stays there).
      const placed = new Set(groupEntries.filter((e) => e.label).map((e) => e.id));
      const groupIds = separateClubs ? separateClubsInGroups(plan.groups.map((g) => g.ids), clubOf, placed) : plan.groups.map((g) => g.ids);
      const groups: TeamSlot[][] = groupIds.map((ids) => ids.map((tid) => slotOf.get(tid)!));

      let mno = 0;
      for (let g = 0; g < groups.length; g++) {
        const label = plan.groups[g]!.label;
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
              ...fixtureDefaults,
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
        ...bracketShape(koRound1, thirdPlace),
      ];
      const schedGK = buildSchedule(gkShape, schedCfg);
      if (!schedGK.ok) { await releaseFixtureClaim(id); return res.status(400).json({ error: schedGK.error, code: 'SCHEDULE_CAPACITY' }); }
      for (const r of matchRows) {
        const slot = schedGK.assignments.get(keyOf(r.round, r.match_no));
        r.scheduled_at = slot?.scheduled_at ?? fallbackStartIso;
        r.ground_label = slot?.ground_label ?? null;
      }
      if (matchRows.length > 0) {
        const { error } = await supabase.from('matches').insert(matchRows);
        if (error) throw new Error('fixture insert failed');
      }
      await insertSingleElim(base, koRound1, (r, m) => schedGK.assignments.get(keyOf(r, m)), thirdPlace);

      // F-52: drawing the fixtures is preparation, not a start whistle. This goes
      // live only if the start date has arrived; otherwise the hourly sweep
      // (sweepTournamentsDue) flips it on the day.
      await supabase.from('tournaments')
        .update({ status: statusAfterFixtures(tournament.start_date as string | null) })
        .eq('id', id);
      const { count } = await supabase
        .from('matches')
        .select('id', { count: 'exact', head: true })
        .eq('tournament_id', id);
      return res.json({ success: true, matchesCreated: count ?? 0, format });
    }

    // Unsupported format after claiming — release the flag so it isn't stuck.
    await releaseFixtureClaim(id);
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
