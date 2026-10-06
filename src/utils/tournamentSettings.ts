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
  | 'buchholz' | 'sonneborn_berger' | 'points_diff';

const ALIASES: Record<string, TiebreakToken> = {
  head_to_head: 'head_to_head', h2h: 'head_to_head', head2head: 'head_to_head', headtohead: 'head_to_head',
  wins: 'wins', won: 'wins',
  nrr: 'nrr', run_rate: 'nrr', net_run_rate: 'nrr', netrunrate: 'nrr',
  score_diff: 'score_diff', score_difference: 'score_diff', goal_difference: 'score_diff', goal_diff: 'score_diff', gd: 'score_diff',
  score_scored: 'score_scored', score_for: 'score_scored', goals_for: 'score_scored', gf: 'score_scored', runs_scored: 'score_scored', points_scored: 'score_scored',
  score_ratio: 'score_ratio', set_ratio: 'score_ratio', game_ratio: 'score_ratio', goal_ratio: 'score_ratio',
  buchholz: 'buchholz',
  sonneborn_berger: 'sonneborn_berger', sb: 'sonneborn_berger', 'sonneborn-berger': 'sonneborn_berger',
  // Badminton gap 10: rally points won minus lost (BWF's last tie-break).
  points_diff: 'points_diff', point_difference: 'points_diff', points_difference: 'points_diff', rally_points_diff: 'points_diff',
};

/** A stored or typed name as its canonical token, or null for one the table doesn't know. */
export function tiebreakToken(x: unknown): TiebreakToken | null {
  return typeof x === 'string' ? ALIASES[x.toLowerCase().trim()] ?? null : null;
}

/** The tie-breaks this sport can use (run rate is cricket's; Buchholz and Sonneborn-Berger chess's). */
export function tiebreaksFor(sport: string | null | undefined): TiebreakToken[] {
  const key = sportKeyOf(sport);
  const all: TiebreakToken[] = ['head_to_head', 'wins', 'nrr', 'score_diff', 'score_scored', 'score_ratio', 'points_diff', 'buchholz', 'sonneborn_berger'];
  const rally = key === 'badminton' || key === 'tabletennis' || key === 'volleyball' || key === 'pickleball';
  return all.filter((t) => (t === 'nrr' ? key === 'cricket' : t === 'buchholz' || t === 'sonneborn_berger' ? key === 'chess' : t === 'points_diff' ? rally : true));
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
    case 'points_diff': return 'Points difference';
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
    // Badminton gap 10: BWF GCR — matches won (the points), head-to-head, games difference, points difference.
    case 'badminton': out.push({ key: 'bwf', label: 'BWF (head-to-head, games, points)', order: ['head_to_head', 'score_diff', 'points_diff'] }); break;
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
  /** 4.13 · keep entries from the same club / state apart in the draw (the entry's club label). */
  separateClubs?: boolean;
  /** 4.14 · who may play: gender, an age limit on the start date, a rating band in the sport. Absent = open. */
  category?: Category;
  /** 4.15 · a Swiss (chess): how many rounds; `paired` is the last round the server paired (it writes that, not the app). */
  swiss?: { rounds: number; paired?: number };
  /** Cricket gap 6 (5 Oct 2026) · the walkover rule, shown to teams: a team not ready this many minutes after its start time loses by walkover (5–60). */
  graceMinutes?: number;
  /** …or one that can't field this many players (2–15). */
  minPlayers?: number;
  /** Cricket gap 9 · a tied knockout with no (more) super over possible goes to the higher seed / group finisher ('seed', the default when absent), more boundaries, or a toss. */
  tieFallback?: 'seed' | 'boundaries' | 'toss';
  /**
   * Badminton gap 6 · BWF GCR: when a player withdraws or retires during the
   * group stage, all their group results are deleted ('delete'). Absent or
   * 'keep' = the results they played stand for their opponents (as before).
   */
  withdrawnResults?: 'delete' | 'keep';
};

export const GRACE_MINUTES: [number, number] = [5, 60];
export const MIN_PLAYERS: [number, number] = [2, 15];

export const SWISS_ROUNDS: [number, number] = [2, 11];

/** Why a new Swiss can't be created (chess only, with its rounds), or null. */
export function swissCreateRefusal(sport: string | null | undefined, settings: unknown): Refusal | null {
  if (sportKeyOf(sport) !== 'chess') return refuse('Swiss is for chess.');
  const sw = settings && typeof settings === 'object' ? (settings as { swiss?: unknown }).swiss : null;
  if (!sw) return refuse('A Swiss needs its number of rounds.');
  return null;
}
/** A sensible number of rounds for a field: enough to separate a winner (log₂ N, rounded up), plus one. */
export const swissRoundsFor = (teams: number): number => Math.min(SWISS_ROUNDS[1], Math.max(SWISS_ROUNDS[0], Math.ceil(Math.log2(Math.max(2, teams))) + 1));

// ── 4.14 · categories ────────────────────────────────────────────────────────

export type Category = {
  /** men / women: every player; mixed: at least one man and one woman. */
  gender?: 'men' | 'women' | 'mixed' | null;
  /** Under this age on the start date (U-14 → 14). */
  underAge?: number | null;
  /** At least this age on the start date (veterans 40+ → 40). */
  minAge?: number | null;
  /** Rating in the sport at most / at least this. */
  maxRating?: number | null;
  minRating?: number | null;
};

const isInt = (x: unknown, lo: number, hi: number) => typeof x === 'number' && Number.isInteger(x) && x >= lo && x <= hi;

export function categoryRefusal(c: unknown): Refusal | null {
  if (c === undefined || c === null) return null;
  if (typeof c !== 'object' || Array.isArray(c)) return refuse('A category must be an object.');
  const o = c as Record<string, unknown>;
  const unknown = Object.keys(o).find((k) => !['gender', 'underAge', 'minAge', 'maxRating', 'minRating'].includes(k));
  if (unknown) return refuse(`“${unknown}” isn’t part of a category.`);
  if (o.gender != null && !['men', 'women', 'mixed'].includes(o.gender as string)) return refuse('A category is men’s, women’s, mixed or open.');
  if (o.underAge != null && !isInt(o.underAge, 6, 25)) return refuse('An under-age limit is 6 to 25.');
  if (o.minAge != null && !isInt(o.minAge, 30, 80)) return refuse('A minimum age is 30 to 80.');
  if (o.underAge != null && o.minAge != null) return refuse('A category is an under-age limit or a minimum age, not both.');
  if (o.maxRating != null && !isInt(o.maxRating, 100, 3000)) return refuse('A rating limit is 100 to 3000.');
  if (o.minRating != null && !isInt(o.minRating, 100, 3000)) return refuse('A rating limit is 100 to 3000.');
  if (o.maxRating != null && o.minRating != null && (o.minRating as number) > (o.maxRating as number)) return refuse('The lowest rating can’t be above the highest.');
  return null;
}

/** The category kept, without empty parts; null when nothing's set (open). */
export function storedCategory(c: Record<string, any> | null | undefined): Category | null {
  if (!c) return null;
  const out: Category = {};
  for (const k of ['gender', 'underAge', 'minAge', 'maxRating', 'minRating'] as const) if (c[k] != null) (out as Record<string, unknown>)[k] = c[k];
  return Object.keys(out).length ? out : null;
}

/** "Women’s · Under 19 · Rated up to 1600", or null for open. */
export function categoryLabel(c: Category | null | undefined): string | null {
  if (!c) return null;
  const parts: string[] = [];
  if (c.gender) parts.push(c.gender === 'men' ? 'Men’s' : c.gender === 'women' ? 'Women’s' : 'Mixed');
  if (c.underAge != null) parts.push(`Under ${c.underAge}`);
  if (c.minAge != null) parts.push(`${c.minAge} and over`);
  if (c.minRating != null && c.maxRating != null) parts.push(`Rated ${c.minRating}–${c.maxRating}`);
  else if (c.maxRating != null) parts.push(`Rated up to ${c.maxRating}`);
  else if (c.minRating != null) parts.push(`Rated ${c.minRating} and up`);
  return parts.length ? parts.join(' · ') : null;
}

export type CategoryPlayer = { name: string; gender?: string | null; dob?: string | null; rating?: number | null };

/** Full years on `on` (a date), from a 'YYYY-MM-DD' birth date. */
export function ageOn(dob: string, on: Date): number | null {
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(dob);
  if (!m) return null;
  let age = on.getUTCFullYear() - Number(m[1]);
  const md = (on.getUTCMonth() + 1) * 100 + on.getUTCDate();
  if (md < Number(m[2]) * 100 + Number(m[3])) age -= 1;
  return age;
}

/** "Tara’s", "Kings’" — as the app's possessive(); this file takes no imports. */
const poss = (n: string) => n + (/s$/i.test(n.trim()) ? '’' : '’s');

/** Why this team's players don't fit the category (naming one), or null. */
export function categoryProblem(c: Category | null | undefined, players: CategoryPlayer[], on: Date): string | null {
  if (!c) return null;
  for (const p of players) {
    if (c.gender === 'men' || c.gender === 'women') {
      const want = c.gender === 'men' ? 'male' : 'female';
      // 1 Oct 2026: no pronouns — the profile hasn't said, so neither do we.
      if (p.gender !== 'male' && p.gender !== 'female') return `${poss(p.name)} profile doesn’t list their gender as ${c.gender === 'men' ? 'man' : 'woman'}. Add it to the profile first.`;
      if (p.gender !== want) return `This is a ${c.gender === 'men' ? 'men’s' : 'women’s'} event, and ${p.name} can’t play in it.`;
    }
    if (c.underAge != null || c.minAge != null) {
      const age = p.dob ? ageOn(p.dob, on) : null;
      if (age == null) return `${poss(p.name)} profile doesn’t list their date of birth, and this event has an age limit. Add it to the profile first.`;
      if (c.underAge != null && age >= c.underAge) return `This is an under-${c.underAge} event, and ${p.name} is ${age} on the start date.`;
      if (c.minAge != null && age < c.minAge) return `This event is for ${c.minAge} and over, and ${p.name} is ${age} on the start date.`;
    }
    if (c.maxRating != null && p.rating != null && p.rating > c.maxRating) return `This event is for players rated up to ${c.maxRating}, and ${p.name} is rated ${Math.round(p.rating)}.`;
    if (c.minRating != null && (p.rating == null || p.rating < c.minRating)) {
      return p.rating == null ? `${p.name} has no rating in this sport yet (this event is for ${c.minRating} and up).` : `This event is for players rated ${c.minRating} and up, and ${p.name} is rated ${Math.round(p.rating)}.`;
    }
  }
  if (c.gender === 'mixed' && players.length > 1) {
    const g = new Set(players.map((p) => p.gender));
    if (!g.has('male') || !g.has('female')) return 'A mixed event needs at least one man and one woman on the team.';
  }
  return null;
}

export const CLUB_MAX = 60;

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
export const DRAW_KEYS = ['bestThirds', 'seeding', 'restMinutes', 'thirdPlace', 'separateClubs', 'category', 'swiss'] as const;

/** Which draw setting an edit changes, if any (to refuse it once the draw is made). */
export function changedDrawKey(current: TournamentSettings, incoming: Record<string, unknown>, keys: readonly string[] = DRAW_KEYS): string | null {
  for (const k of keys) {
    if (!(k in incoming)) continue;
    // A Swiss's settings change only in their rounds (`paired` is the server's).
    const pick = (v: unknown) => (k === 'swiss' && v && typeof v === 'object' ? (v as { rounds?: unknown }).rounds ?? null : v);
    const was = pick((current as Record<string, unknown>)[k] ?? null);
    const now = pick(incoming[k] ?? null);
    if (JSON.stringify(was) !== JSON.stringify(now)) return k;
  }
  return null;
}

/** A tournament row's settings, or an empty v1 object. Never throws. */
export function settingsOf(t: { settings?: unknown } | null | undefined): TournamentSettings {
  const s = t?.settings;
  return (s && typeof s === 'object' && !Array.isArray(s) ? s : { v: 1 }) as TournamentSettings;
}

const KNOWN_KEYS = new Set(['v', 'points', 'bestThirds', 'seeding', 'walkoverScore', 'restMinutes', 'entry', 'thirdPlace', 'separateClubs', 'category', 'swiss', 'graceMinutes', 'minPlayers', 'tieFallback', 'withdrawnResults']);

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
  const whole = (v: unknown, [lo, hi]: [number, number]) => typeof v === 'number' && Number.isInteger(v) && v >= lo && v <= hi;
  // 0 clears a rule (an edit), like the rest.
  if (o.graceMinutes != null && o.graceMinutes !== 0 && !whole(o.graceMinutes, GRACE_MINUTES)) return refuse(`The grace time must be ${GRACE_MINUTES[0]} to ${GRACE_MINUTES[1]} minutes.`);
  if (o.tieFallback != null && o.tieFallback !== 'seed' && o.tieFallback !== 'boundaries' && o.tieFallback !== 'toss') return refuse('A tied knockout goes to the higher seed, more boundaries or a toss.');
  if (o.withdrawnResults != null && o.withdrawnResults !== 'delete' && o.withdrawnResults !== 'keep') return refuse('A withdrawn player’s group results are deleted or kept.');
  if (o.minPlayers != null && o.minPlayers !== 0 && !whole(o.minPlayers, MIN_PLAYERS)) return refuse(`The fewest players a team can play with must be ${MIN_PLAYERS[0]} to ${MIN_PLAYERS[1]}.`);
  if (o.swiss != null) {
    if (format !== 'swiss') return refuse('Swiss rounds are for a Swiss tournament.');
    const r = (o.swiss as { rounds?: unknown }).rounds;
    if (!(typeof r === 'number' && Number.isInteger(r) && r >= SWISS_ROUNDS[0] && r <= SWISS_ROUNDS[1])) return refuse(`A Swiss has ${SWISS_ROUNDS[0]} to ${SWISS_ROUNDS[1]} rounds.`);
  }
  const catBad = categoryRefusal(o.category);
  if (catBad) return catBad;
  if (o.separateClubs != null) {
    if (typeof o.separateClubs !== 'boolean') return refuse('Keeping clubs apart is on or off.');
    if (o.separateClubs && format !== 'knockout' && format !== 'groups_knockout') return refuse('Keeping clubs apart is for a draw — a knockout or groups.');
  }
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
  if ('swiss' in s) {
    // The app sets the rounds; `paired` is the server's own bookkeeping.
    if (s.swiss) out.swiss = { rounds: Number(s.swiss.rounds), ...(current?.swiss?.paired != null ? { paired: current.swiss.paired } : {}) };
    else delete out.swiss;
  }
  if ('category' in s) {
    const c = storedCategory(s.category);
    if (c) out.category = c;
    else delete out.category;
  }
  if ('separateClubs' in s) {
    if (s.separateClubs) out.separateClubs = true;
    else delete out.separateClubs;
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
  // Gap 9: the tie fallback ('seed' is the default, so it isn't stored).
  if ('withdrawnResults' in s) {
    if (s.withdrawnResults === 'delete') out.withdrawnResults = 'delete';
    else delete out.withdrawnResults;
  }
  if ('tieFallback' in s) {
    if (s.tieFallback && s.tieFallback !== 'seed') out.tieFallback = s.tieFallback;
    else delete out.tieFallback;
  }
  // Gap 6: the walkover rule (null or 0 clears it).
  for (const k of ['graceMinutes', 'minPlayers'] as const) {
    if (!(k in s)) continue;
    if (s[k]) out[k] = Number(s[k]);
    else delete out[k];
  }
  return out;
}

/**
 * Badminton gap 6 · what a group table is built from. With `withdrawnResults:
 * 'delete'` (BWF GCR), a withdrawn (or retired-and-withdrawn) entry leaves the
 * table and every match it played is dropped; otherwise nothing changes.
 */
export function tableInputs<M extends { team_a_id?: string | null; team_b_id?: string | null }>(
  settings: unknown, teamIds: string[], matches: M[], withdrawn: Iterable<string>,
): { teamIds: string[]; matches: M[] } {
  if ((settings as { withdrawnResults?: string } | null)?.withdrawnResults !== 'delete') return { teamIds, matches };
  const gone = new Set(withdrawn);
  if (gone.size === 0) return { teamIds, matches };
  return {
    teamIds: teamIds.filter((t) => !gone.has(t)),
    matches: matches.filter((m) => !gone.has(m.team_a_id ?? '') && !gone.has(m.team_b_id ?? '')),
  };
}
