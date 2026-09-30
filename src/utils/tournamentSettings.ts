/**
 * BUILD Stage 4 · a tournament's tournament-wide settings (migration 116,
 * `tournaments.settings`): one versioned JSON object, `{ v: 1, ... }`.
 *
 * Every option is optional, and an absent one (or a NULL column) means exactly
 * what the tournament did before Stage 4 — so older apps, which never send it,
 * create the same tournaments they always did.
 *
 * Byte-identical in both repos:
 *   sportclan-v2/src/tournament/tournamentSettings.ts
 *   sportclan-backend/src/utils/tournamentSettings.ts
 * `tournamentSettingsParity` tests fail if they differ. No imports: it is a pure
 * description of the options, their sport presets and their limits.
 */

export type Refusal = { error: string; code: string };
const refuse = (error: string, code = 'INVALID_TOURNAMENT_SETTINGS'): Refusal => ({ error, code });

/** Sport slug as the server normalises it: lower case, no spaces, dashes or underscores. */
export const sportKeyOf = (s: string | null | undefined): string => String(s ?? '').toLowerCase().replace(/[-_\s]/g, '');

// ── 4.1 · points template ────────────────────────────────────────────────────

/**
 * Points for a result in a league table. `noResult` null = a no-result isn't
 * counted at all (as before 4.1); a number = each side gets that many and it
 * counts as played. `walkoverWin` / `walkoverLoss` null = a walkover scores like
 * any win / loss. `sets` (volleyball) scores a win by how it was won: a
 * straight win (the loser more than one set short) or one that went the
 * distance, `[winner, loser]` each.
 */
export type PointsTemplate = {
  win: number;
  draw: number;
  loss: number;
  noResult: number | null;
  walkoverWin: number | null;
  walkoverLoss: number | null;
  sets: { straight: [number, number]; decider: [number, number] } | null;
};

const tpl = (win: number, draw: number, loss: number, extra: Partial<PointsTemplate> = {}): PointsTemplate => ({
  win, draw, loss, noResult: null, walkoverWin: null, walkoverLoss: null, sets: null, ...extra,
});

/** Sports where a match can end level. The others hide the draw field. */
export const DRAW_SPORTS = new Set(['cricket', 'football', 'hockey', 'chess']);

/**
 * Each sport's usual template, offered on the form for a new tournament.
 * - cricket: 2 a win, 1 a tie or no result (the local leagues and the IPL);
 * - football / hockey: 3 / 1 / 0;
 * - basketball: FIBA 2 a win, 1 a loss, 0 a forfeit;
 * - volleyball: FIVB 3–0 or 3–1 → 3 / 0, 3–2 → 2 / 1;
 * - table tennis: ITTF 2 a win, 1 a loss, 0 a walkover;
 * - badminton / tennis / pickleball / carrom: ranked on matches won, 1 / 0;
 * - chess: 1 / ½ / 0, a forfeit 0.
 * Sports with no draws carry a draw halfway between win and loss; it is only
 * used if an organiser records one.
 */
export function pointsPresetFor(sport: string | null | undefined): PointsTemplate {
  switch (sportKeyOf(sport)) {
    case 'cricket': return tpl(2, 1, 0, { noResult: 1 });
    case 'basketball': return tpl(2, 1.5, 1, { walkoverLoss: 0 });
    case 'volleyball': return tpl(3, 1.5, 0, { sets: { straight: [3, 0], decider: [2, 1] } });
    case 'tabletennis': return tpl(2, 1.5, 1, { walkoverLoss: 0 });
    case 'badminton': case 'tennis': case 'pickleball': case 'carrom': return tpl(1, 0.5, 0);
    case 'chess': return tpl(1, 0.5, 0, { walkoverLoss: 0 });
    default: return tpl(3, 1, 0);
  }
}

const POINT_MAX = 10;
const isPoint = (x: unknown): x is number =>
  typeof x === 'number' && Number.isFinite(x) && x >= 0 && x <= POINT_MAX && Number.isInteger(x * 2);

export function pointsRefusal(sport: string | null | undefined, p: unknown): Refusal | null {
  if (p === undefined || p === null) return null;
  if (typeof p !== 'object' || Array.isArray(p)) return refuse('The points template must be an object.');
  const t = p as Record<string, unknown>;
  for (const k of ['win', 'draw', 'loss'] as const) {
    if (!isPoint(t[k])) return refuse(`Points for a ${k} must be 0 to ${POINT_MAX}, in halves.`);
  }
  const win = t.win as number, draw = t.draw as number, loss = t.loss as number;
  if (!(win > loss)) return refuse('A win has to be worth more than a loss.');
  if (draw < loss || draw > win) return refuse('A draw has to be worth between a loss and a win.');
  for (const k of ['noResult', 'walkoverWin', 'walkoverLoss'] as const) {
    if (t[k] != null && !isPoint(t[k])) return refuse(`Points for a ${k === 'noResult' ? 'no result' : k === 'walkoverWin' ? 'walkover win' : 'walkover loss'} must be 0 to ${POINT_MAX}, in halves.`);
  }
  if (t.noResult != null && (t.noResult as number) > win) return refuse('A no result can’t be worth more than a win.');
  if (t.walkoverLoss != null && (t.walkoverLoss as number) > loss) return refuse('A walkover loss can’t be worth more than a loss.');
  if (t.walkoverWin != null && (t.walkoverWin as number) > win) return refuse('A walkover win can’t be worth more than a win.');
  if (t.sets != null) {
    if (sportKeyOf(sport) !== 'volleyball') return refuse('Points by set score are for volleyball.');
    const s = t.sets as Record<string, unknown>;
    const pair = (x: unknown): x is [number, number] => Array.isArray(x) && x.length === 2 && isPoint(x[0]) && isPoint(x[1]) && x[0] > x[1];
    if (typeof s !== 'object' || !pair(s.straight) || !pair(s.decider)) {
      return refuse('Set-score points need a winner and loser value for a straight win and for one that goes the distance, the winner’s higher.');
    }
    if (s.decider[0] > s.straight[0]) return refuse('A win that goes the distance can’t be worth more than a straight win.');
  }
  return null;
}

/** The stored template: only the known fields, nulls where not set. */
export function storedPoints(p: Record<string, any>): PointsTemplate {
  return {
    win: p.win, draw: p.draw, loss: p.loss,
    noResult: p.noResult ?? null,
    walkoverWin: p.walkoverWin ?? null,
    walkoverLoss: p.walkoverLoss ?? null,
    sets: p.sets ? { straight: [p.sets.straight[0], p.sets.straight[1]], decider: [p.sets.decider[0], p.sets.decider[1]] } : null,
  };
}

// ── 4.2 · tie-break order ────────────────────────────────────────────────────
// Stored in tournaments.tiebreaker_rules (a list of these names), read by the
// standings ladder after points. Points always come first; the team id is the
// last word when everything else is level.

export type TiebreakToken =
  | 'head_to_head' | 'wins' | 'nrr' | 'score_diff' | 'score_scored' | 'score_ratio'
  | 'buchholz' | 'sonneborn_berger';

const ALIASES: Record<string, TiebreakToken> = {
  head_to_head: 'head_to_head', h2h: 'head_to_head', head2head: 'head_to_head', headtohead: 'head_to_head',
  wins: 'wins', won: 'wins',
  nrr: 'nrr', run_rate: 'nrr', net_run_rate: 'nrr', netrunrate: 'nrr',
  score_diff: 'score_diff', score_difference: 'score_diff', goal_difference: 'score_diff', goal_diff: 'score_diff', gd: 'score_diff',
  score_scored: 'score_scored', score_for: 'score_scored', goals_for: 'score_scored', gf: 'score_scored', runs_scored: 'score_scored', points_scored: 'score_scored',
  score_ratio: 'score_ratio', set_ratio: 'score_ratio', game_ratio: 'score_ratio', goal_ratio: 'score_ratio',
  buchholz: 'buchholz',
  sonneborn_berger: 'sonneborn_berger', sb: 'sonneborn_berger', 'sonneborn-berger': 'sonneborn_berger',
};

/** A stored or typed name as its canonical token, or null for one the table doesn't know. */
export function tiebreakToken(x: unknown): TiebreakToken | null {
  return typeof x === 'string' ? ALIASES[x.toLowerCase().trim()] ?? null : null;
}

/** The tie-breaks this sport can use (run rate is cricket's; Buchholz and Sonneborn-Berger chess's). */
export function tiebreaksFor(sport: string | null | undefined): TiebreakToken[] {
  const key = sportKeyOf(sport);
  const all: TiebreakToken[] = ['head_to_head', 'wins', 'nrr', 'score_diff', 'score_scored', 'score_ratio', 'buchholz', 'sonneborn_berger'];
  return all.filter((t) => (t === 'nrr' ? key === 'cricket' : t === 'buchholz' || t === 'sonneborn_berger' ? key === 'chess' : true));
}

/** How a tie-break reads for this sport ("Goal difference", "Set ratio"). */
export function tiebreakLabel(sport: string | null | undefined, t: TiebreakToken): string {
  const key = sportKeyOf(sport);
  const unit = key === 'football' || key === 'hockey' ? 'Goal'
    : key === 'cricket' ? 'Run'
      : key === 'basketball' ? 'Point'
        : key === 'volleyball' || key === 'tennis' ? 'Set'
          : key === 'chess' ? 'Score' : 'Game';
  switch (t) {
    case 'head_to_head': return 'Head-to-head';
    case 'wins': return 'Wins';
    case 'nrr': return 'Net run rate';
    case 'score_diff': return `${unit} difference`;
    case 'score_scored': return unit === 'Score' ? 'Score' : `${unit}s ${unit === 'Set' || unit === 'Game' ? 'won' : 'scored'}`;
    case 'score_ratio': return `${unit} ratio`;
    case 'buchholz': return 'Buchholz';
    case 'sonneborn_berger': return 'Sonneborn-Berger';
  }
}

/** The order a table uses when the organiser sets none (the standings ladder's default), for this sport. */
export function defaultTiebreaks(sport: string | null | undefined): TiebreakToken[] {
  const key = sportKeyOf(sport);
  return (['head_to_head', 'nrr', 'score_diff', 'score_scored'] as TiebreakToken[]).filter((t) => t !== 'nrr' || key === 'cricket');
}

/** The sport's recognised orders, offered as presets on the form. The first is the default. */
export function tiebreakPresetsFor(sport: string | null | undefined): Array<{ key: string; label: string; order: TiebreakToken[] }> {
  // The standard is also a recognised order for some sports; the chip says so.
  const standardName = ({ football: 'Head-to-head first (AIFF)', basketball: 'Standard (FIBA)' } as Record<string, string>)[sportKeyOf(sport)] ?? 'Standard';
  const out = [{ key: 'default', label: standardName, order: defaultTiebreaks(sport) }];
  switch (sportKeyOf(sport)) {
    case 'cricket': out.push({ key: 'cricket', label: 'Run rate, then wins', order: ['nrr', 'wins', 'head_to_head'] }); break;
    case 'football':
      out.push({ key: 'local', label: 'Goal difference first', order: ['score_diff', 'score_scored', 'head_to_head'] });
      break;
    case 'hockey': out.push({ key: 'fih', label: 'FIH (wins first)', order: ['wins', 'score_diff', 'score_scored', 'head_to_head'] }); break;
    case 'volleyball': out.push({ key: 'fivb', label: 'FIVB (wins, set ratio)', order: ['wins', 'score_ratio', 'head_to_head'] }); break;
    case 'tabletennis': out.push({ key: 'ittf', label: 'ITTF (head-to-head, game ratio)', order: ['head_to_head', 'score_ratio'] }); break;
    case 'chess':
      out.push({ key: 'fide_rr', label: 'Sonneborn-Berger', order: ['sonneborn_berger', 'head_to_head', 'wins'] });
      out.push({ key: 'fide_swiss', label: 'Buchholz', order: ['buchholz', 'sonneborn_berger', 'wins'] });
      break;
    default: break;
  }
  // An order the same as the standard isn't offered twice.
  return out.filter((p, i) => i === 0 || JSON.stringify(p.order) !== JSON.stringify(out[0]!.order));
}

export const TIEBREAK_MAX = 6;

/** Why a tie-break list can't be stored (null = fine). Points is implied first, so it's dropped, not refused. */
export function tiebreakRefusal(sport: string | null | undefined, list: unknown): Refusal | null {
  if (list === undefined || list === null) return null;
  const bad = (error: string) => refuse(error, 'INVALID_TIEBREAKS');
  if (!Array.isArray(list)) return bad('Tie-breaks must be a list.');
  const allowed = new Set(tiebreaksFor(sport));
  const seen = new Set<TiebreakToken>();
  for (const x of list) {
    if (typeof x === 'string' && ['points', 'pts'].includes(x.toLowerCase().trim())) continue;
    const t = tiebreakToken(x);
    if (!t) return bad(`“${String(x).slice(0, 40)}” isn’t a tie-break.`);
    if (!allowed.has(t)) return bad(`${tiebreakLabel(sport, t)} isn’t a tie-break for this sport.`);
    if (seen.has(t)) return bad(`${tiebreakLabel(sport, t)} is in the list twice.`);
    seen.add(t);
  }
  if (seen.size > TIEBREAK_MAX) return bad(`Up to ${TIEBREAK_MAX} tie-breaks.`);
  return null;
}

/** The list to store: canonical names, points dropped (it always comes first). */
export function storedTiebreaks(list: unknown[]): TiebreakToken[] {
  return list.map(tiebreakToken).filter((t): t is TiebreakToken => !!t);
}

// ── the settings object ──────────────────────────────────────────────────────

export type TournamentSettings = {
  v: 1;
  points?: PointsTemplate;
  /** 4.5 · groups → knockout: the best next-placed teams fill the knockout's byes. */
  bestThirds?: boolean;
  /** 4.6 · the draw's order: entry time, a random draw, or the organiser's seeds. Absent = seeds if set, then entry time (as before). */
  seeding?: SeedingMode;
  /** 4.8 · a walkover's score: goals / points for the winner (football, hockey, basketball), or a straight win in the fixture's length ("straight": 3–0 in a best of 5, 1–0 in chess). Absent = as before (football by its rules, others no score). */
  walkoverScore?: number | 'straight';
  /** 4.9 · minimum minutes between a team's matches when fixtures are timed (0–240). */
  restMinutes?: number;
  /** 4.11 · how a captain's entry lands: 'approval' (the organiser approves it — as before) or 'open' (in at once, up to max teams). */
  entry?: EntryMode;
  /** 4.12 · a knockout's semi-final losers play for third place. */
  thirdPlace?: boolean;
};

export type EntryMode = 'approval' | 'open';

export const REST_MAX = 240;

// ── 4.8 · walkover score ─────────────────────────────────────────────────────

/** Sports whose walkover is a number of goals / points; the others (bar cricket) score a straight win. */
export const WALKOVER_NUMBER_SPORTS = new Set(['football', 'hockey', 'basketball']);
/** Cricket has no walkover score — the win's points are the result. */
export const walkoverScoreOffered = (sport: string | null | undefined): boolean => sportKeyOf(sport) !== 'cricket';
export const WALKOVER_MAX = 99;

/** The usual walkover for a new tournament: basketball 20–0 (FIBA), table tennis / volleyball / chess a straight win (ITTF 3–0, FIVB 3–0, a forfeit 1–0). Football keeps its match rules (3–0 / 5–0). */
export function walkoverPresetFor(sport: string | null | undefined): number | 'straight' | null {
  switch (sportKeyOf(sport)) {
    case 'basketball': return 20;
    case 'tabletennis': case 'volleyball': case 'chess': return 'straight';
    default: return null;
  }
}

export function walkoverRefusal(sport: string | null | undefined, w: unknown): Refusal | null {
  if (w === undefined || w === null) return null;
  const key = sportKeyOf(sport);
  if (!walkoverScoreOffered(key)) return refuse('A cricket walkover has no score — the win’s points are the result.');
  if (WALKOVER_NUMBER_SPORTS.has(key)) {
    if (!(typeof w === 'number' && Number.isInteger(w) && w >= 1 && w <= WALKOVER_MAX)) return refuse(`A walkover’s score must be 1 to ${WALKOVER_MAX}.`);
    return null;
  }
  if (w !== 'straight') return refuse('A walkover here is a straight win or no score.');
  return null;
}

/** Settings fixed once any result stands (a table can't be re-scored under people). */
export const RESULT_KEYS = ['points', 'walkoverScore'] as const;

export type SeedingMode = 'registration' | 'random' | 'manual';
export const SEEDING_MODES: readonly SeedingMode[] = ['registration', 'random', 'manual'];

/**
 * Settings the draw is made from. They're fixed once it's made (the fixtures
 * already reflect them); the points and tie-breaks are fixed once a result is in.
 */
export const DRAW_KEYS = ['bestThirds', 'seeding', 'restMinutes', 'thirdPlace'] as const;

/** Which draw setting an edit changes, if any (to refuse it once the draw is made). */
export function changedDrawKey(current: TournamentSettings, incoming: Record<string, unknown>, keys: readonly string[] = DRAW_KEYS): string | null {
  for (const k of keys) {
    if (!(k in incoming)) continue;
    const was = (current as Record<string, unknown>)[k] ?? null;
    const now = incoming[k] ?? null;
    if (JSON.stringify(was) !== JSON.stringify(now)) return k;
  }
  return null;
}

/** A tournament row's settings, or an empty v1 object. Never throws. */
export function settingsOf(t: { settings?: unknown } | null | undefined): TournamentSettings {
  const s = t?.settings;
  return (s && typeof s === 'object' && !Array.isArray(s) ? s : { v: 1 }) as TournamentSettings;
}

const KNOWN_KEYS = new Set(['v', 'points', 'bestThirds', 'seeding', 'walkoverScore', 'restMinutes', 'entry', 'thirdPlace']);

/** Why a settings object (whole, or a partial edit of one) can't be stored. */
export function settingsRefusal(sport: string | null | undefined, format: string | null | undefined, s: unknown): Refusal | null {
  if (s === undefined || s === null) return null;
  if (typeof s !== 'object' || Array.isArray(s)) return refuse('Tournament settings must be an object.');
  const o = s as Record<string, unknown>;
  const unknown = Object.keys(o).find((k) => !KNOWN_KEYS.has(k));
  if (unknown) return refuse(`“${unknown}” isn’t a tournament setting.`);
  if (o.v !== undefined && o.v !== 1) return refuse('Tournament settings version must be 1.');
  if (o.bestThirds != null) {
    if (typeof o.bestThirds !== 'boolean') return refuse('Best third places is on or off.');
    if (o.bestThirds && format !== 'groups_knockout') return refuse('Best third places are for groups → knockout.');
  }
  if (o.seeding != null && !SEEDING_MODES.includes(o.seeding as SeedingMode)) return refuse('Seeding is registration order, a random draw or manual seeds.');
  if (o.restMinutes != null && !(typeof o.restMinutes === 'number' && Number.isInteger(o.restMinutes) && o.restMinutes >= 0 && o.restMinutes <= REST_MAX)) {
    return refuse(`Rest between a team’s matches must be 0 to ${REST_MAX} minutes.`);
  }
  if (o.entry != null && o.entry !== 'approval' && o.entry !== 'open') return refuse('Entry is open or by approval.');
  if (o.thirdPlace != null) {
    if (typeof o.thirdPlace !== 'boolean') return refuse('A third-place match is on or off.');
    if (o.thirdPlace && format !== 'knockout' && format !== 'groups_knockout') return refuse('A third-place match is for a knockout.');
  }
  const woBad = walkoverRefusal(sport, o.walkoverScore);
  if (woBad) return woBad;
  return pointsRefusal(sport, o.points);
}

/** The settings to store: known keys only, merged over `current` (an edit sends only what changes). */
export function storedSettings(s: Record<string, any> | null | undefined, current?: TournamentSettings | null): TournamentSettings {
  const out: TournamentSettings = { ...(current ?? {}), v: 1 };
  if (!s) return out;
  if ('points' in s) {
    if (s.points == null) delete out.points;
    else out.points = storedPoints(s.points);
  }
  if ('bestThirds' in s) {
    if (s.bestThirds) out.bestThirds = true;
    else delete out.bestThirds;
  }
  if ('seeding' in s) {
    if (s.seeding) out.seeding = s.seeding;
    else delete out.seeding;
  }
  if ('thirdPlace' in s) {
    if (s.thirdPlace) out.thirdPlace = true;
    else delete out.thirdPlace;
  }
  if ('entry' in s) {
    if (s.entry === 'open') out.entry = 'open';
    else delete out.entry;
  }
  if ('restMinutes' in s) {
    if (s.restMinutes) out.restMinutes = s.restMinutes;
    else delete out.restMinutes;
  }
  if ('walkoverScore' in s) {
    if (s.walkoverScore != null) out.walkoverScore = s.walkoverScore;
    else delete out.walkoverScore;
  }
  return out;
}
