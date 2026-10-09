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
 * `tournamentSettingsParity` tests fail if they differ. A pure description of
 * the options, their sport presets and their limits; its one import is the
 * shared ladder / box rules (Stage 9 · T16), byte-identical beside it.
 */

import { boxSettingsProblem, ladderSettingsProblem, LADDER_SPORTS, type BoxSettings, type LadderSettings } from './ladderBox';

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
  | 'buchholz' | 'sonneborn_berger' | 'points_diff' | 'games_diff' | 'fair_play'
  // Stage 9 · T4: the next level down won, and its share (tennis: games; the rally
  // sports: points), and — the ATP Finals' second step — matches played.
  | 'points_won' | 'points_pct' | 'played'
  // Stage 10 · TT4: counted only in the matches between the tied teams (ITTF's
  // games and points ratios among the tied, UEFA's head-to-head goals); after
  // a team is separated the rest are ranked again among themselves, then lots.
  | 'h2h_score_diff' | 'h2h_score_scored' | 'h2h_score_ratio' | 'h2h_points_diff' | 'h2h_points_ratio';

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
  // Badminton 7.16: games won minus lost over every rubber of a team tie.
  games_diff: 'games_diff', games_difference: 'games_diff', game_difference: 'games_diff',
  // Stage 8 · F8: FIFA fair-play points from the cards (football, hockey).
  fair_play: 'fair_play', fairplay: 'fair_play', fair_play_points: 'fair_play', discipline: 'fair_play',
  // Stage 9 · T4.
  points_won: 'points_won', games_won: 'points_won', total_games: 'points_won', rally_points_won: 'points_won',
  points_pct: 'points_pct', games_pct: 'points_pct', game_percentage: 'points_pct', points_percentage: 'points_pct',
  played: 'played', matches_played: 'played',
  // Stage 10 · TT4.
  h2h_score_diff: 'h2h_score_diff', h2h_goal_difference: 'h2h_score_diff', h2h_score_scored: 'h2h_score_scored', h2h_goals_for: 'h2h_score_scored',
  h2h_score_ratio: 'h2h_score_ratio', h2h_game_ratio: 'h2h_score_ratio', h2h_set_ratio: 'h2h_score_ratio',
  h2h_points_diff: 'h2h_points_diff', h2h_points_ratio: 'h2h_points_ratio',
};

/** A stored or typed name as its canonical token, or null for one the table doesn't know. */
export function tiebreakToken(x: unknown): TiebreakToken | null {
  return typeof x === 'string' ? ALIASES[x.toLowerCase().trim()] ?? null : null;
}

/** The tie-breaks this sport can use (run rate is cricket's; Buchholz and Sonneborn-Berger chess's). */
export function tiebreaksFor(sport: string | null | undefined): TiebreakToken[] {
  const key = sportKeyOf(sport);
  const all: TiebreakToken[] = ['head_to_head', 'h2h_score_diff', 'h2h_score_scored', 'h2h_score_ratio', 'h2h_points_diff', 'h2h_points_ratio', 'wins', 'played', 'nrr', 'score_diff', 'score_scored', 'score_ratio', 'games_diff', 'points_diff', 'points_won', 'points_pct', 'fair_play', 'buchholz', 'sonneborn_berger'];
  const rally = key === 'badminton' || key === 'tabletennis' || key === 'volleyball' || key === 'pickleball';
  // Stage 9 · T4: every sport scored in sets of games or points — tennis's games, the rally sports' points.
  const inSets = rally || key === 'tennis';
  return all.filter((t) => (t === 'nrr' ? key === 'cricket' : t === 'buchholz' || t === 'sonneborn_berger' ? key === 'chess'
    : t === 'points_diff' || t === 'points_won' || t === 'points_pct' || t === 'h2h_points_diff' || t === 'h2h_points_ratio' ? inSets
      : t === 'h2h_score_diff' || t === 'h2h_score_scored' || t === 'h2h_score_ratio' ? key !== 'chess'
      : t === 'played' ? key === 'tennis'
        : t === 'games_diff' ? key === 'badminton' || key === 'tabletennis' : t === 'fair_play' ? key === 'football' || key === 'hockey' : true));
}

/** How a tie-break reads for this sport ("Goal difference", "Set ratio"). */
/** 7.16: `tie` — the tournament plays team ties, so its score is rubbers. */
export function tiebreakLabel(sport: string | null | undefined, t: TiebreakToken, tie = false): string {
  const key = sportKeyOf(sport);
  const unit = tie ? 'Rubber' : key === 'football' || key === 'hockey' ? 'Goal'
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
    case 'score_ratio': return key === 'tennis' && !tie ? 'Sets won %' : `${unit} ratio`; // Stage 9 · T4: the ATP's words
    case 'buchholz': return 'Buchholz';
    case 'sonneborn_berger': return 'Sonneborn-Berger';
    // Stage 9 · T4: tennis's next level down is games; the rally sports', points.
    case 'points_diff': return key === 'tennis' ? 'Game difference' : 'Points difference';
    case 'points_won': return key === 'tennis' ? 'Games won' : 'Points won';
    case 'points_pct': return key === 'tennis' ? 'Games won %' : 'Points won %';
    case 'played': return 'Matches played (more first)';
    case 'games_diff': return 'Games difference';
    case 'fair_play': return 'Fair play (cards)';
    // Stage 10 · TT4: only the matches between the tied teams.
    case 'h2h_score_diff': return `${unit} difference between them`;
    case 'h2h_score_scored': return `${unit}s ${unit === 'Set' || unit === 'Game' || unit === 'Rubber' ? 'won' : 'scored'} between them`;
    case 'h2h_score_ratio': return `${unit} ratio between them`;
    case 'h2h_points_diff': return key === 'tennis' ? 'Game difference between them' : 'Points difference between them';
    case 'h2h_points_ratio': return key === 'tennis' ? 'Game ratio between them' : 'Points ratio between them';
  }
}

/** The order a table uses when the organiser sets none (the standings ladder's default), for this sport. */
export function defaultTiebreaks(sport: string | null | undefined): TiebreakToken[] {
  const key = sportKeyOf(sport);
  return (['head_to_head', 'nrr', 'score_diff', 'score_scored'] as TiebreakToken[]).filter((t) => t !== 'nrr' || key === 'cricket');
}

/** The sport's recognised orders, offered as presets on the form. The first is the default. */
export function tiebreakPresetsFor(sport: string | null | undefined, tie = false): Array<{ key: string; label: string; order: TiebreakToken[] }> {
  // The standard is also a recognised order for some sports; the chip says so.
  const standardName = ({ football: 'Head-to-head first (AIFF)', basketball: 'Standard (FIBA)' } as Record<string, string>)[sportKeyOf(sport)] ?? 'Standard';
  const out = [{ key: 'default', label: standardName, order: defaultTiebreaks(sport) }];
  switch (sportKeyOf(sport)) {
    case 'cricket': out.push({ key: 'cricket', label: 'Run rate, then wins', order: ['nrr', 'wins', 'head_to_head'] }); break;
    case 'football':
      out.push({ key: 'local', label: 'Goal difference first', order: ['score_diff', 'score_scored', 'head_to_head'] });
      // Stage 8 · F8: FIFA World Cup 2026 — head-to-head, then goal difference and goals, then fair play.
      out.push({ key: 'fifa', label: 'FIFA (head-to-head, goals, fair play)', order: ['head_to_head', 'score_diff', 'score_scored', 'fair_play'] });
      // Stage 10 · TT4: UEFA — points, goal difference and goals in the matches between them, then overall.
      out.push({ key: 'uefa', label: 'UEFA (goals between them first)', order: ['head_to_head', 'h2h_score_diff', 'h2h_score_scored', 'score_diff', 'score_scored'] });
      break;
    case 'hockey': out.push({ key: 'fih', label: 'FIH (wins first)', order: ['wins', 'score_diff', 'score_scored', 'head_to_head'] }); break;
    case 'volleyball': out.push({ key: 'fivb', label: 'FIVB (wins, set ratio)', order: ['wins', 'score_ratio', 'head_to_head'] }); break;
    // Stage 10 · TT4: ITTF — among the tied only: matches, games ratio, points ratio, then lots.
    case 'tabletennis': out.push({ key: 'ittf', label: 'ITTF (among the tied: matches, games, points)', order: ['head_to_head', 'h2h_score_ratio', 'h2h_points_ratio'] }); break;
    // Badminton gap 10: BWF GCR — matches won (the points), head-to-head, games difference, points difference.
    case 'badminton':
      out.push({ key: 'bwf', label: 'BWF (head-to-head, games, points)', order: ['head_to_head', 'score_diff', 'points_diff'] });
      // Stage 10 · TT4: the same steps counted only between the tied players.
      out.push({ key: 'between', label: 'Among the tied only (games, points)', order: ['head_to_head', 'h2h_score_diff', 'h2h_points_diff'] });
      // 7.16: a team event — ties won (the points), head-to-head, rubbers, games, points.
      if (tie) out.push({ key: 'bwf_team', label: 'BWF team (rubbers, games, points)', order: ['head_to_head', 'score_diff', 'games_diff', 'points_diff'] });
      break;
    // Stage 9 · T4: ATP Finals — wins, then matches played, head-to-head, sets %, games %;
    // and the Maharashtra inter-club way — total games won.
    case 'tennis':
      out.push({ key: 'atp', label: 'ATP Finals (played, head-to-head, sets %, games %)', order: ['wins', 'played', 'head_to_head', 'score_ratio', 'points_pct'] });
      out.push({ key: 'games', label: 'Total games won', order: ['points_won', 'head_to_head'] });
      break;
    // Stage 11 · PB7: USA Pickleball 15.B.4 — head-to-head, point difference over
    // every game, point difference between them, then points scored.
    case 'pickleball': out.push({ key: 'usap', label: 'USA Pickleball (head-to-head, points)', order: ['head_to_head', 'points_diff', 'h2h_points_diff', 'points_won'] }); break;
    case 'chess':
      out.push({ key: 'fide_rr', label: 'Sonneborn-Berger', order: ['sonneborn_berger', 'head_to_head', 'wins'] });
      out.push({ key: 'fide_swiss', label: 'Buchholz', order: ['buchholz', 'sonneborn_berger', 'wins'] });
      break;
    default: break;
  }
  // An order the same as the standard isn't offered twice.
  return out.filter((p, i) => i === 0 || JSON.stringify(p.order) !== JSON.stringify(out[0]!.order));
}


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
  // Oct 2026: no cap on the list — each tie-break once (above).
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
  /** Stage 8 · F7: awards the organiser gives (any number): best player, best keeper… */
  awards?: PickedAward[];
  /** Stage 8 · F8: teams still level after every tie-break, in the order a draw of lots put them (by group label, '' for one table). */
  lots?: Record<string, string[]>;
  /** Stage 8: groups → knockout — how many best next-placed teams go through besides the top `qualifiers_per_group` (null: as many as fill the byes). */
  bestNext?: number;
  /**
   * Stage 10 · TT2 · groups → knockout: the top seeds go straight into the
   * knockout and skip the groups (TTFI / MSTTA: 8 seeds, 16 above 60 entries).
   * Blank or 0: everyone plays the groups. No top.
   */
  directSeeds?: number;
  /** Stage 8 · F5: bans from cards (team sports with cards). */
  discipline?: DisciplineRules;
  /** Stage 8 · F3: squads — an optional most players a squad (no app top), and when squads lock for captains. */
  squad?: SquadRules;
  /**
   * Stage 9 · T13: a full event puts new entries on a waitlist, in order (the
   * default); false = it refuses them, as before. A withdrawal or a bigger draw
   * moves the first one up.
   */
  waitlist?: boolean;
  /**
   * Stage 9 · T7 · this event is a qualifying draw for a main event of the same
   * tournament: its draw stops after `rounds` rounds, and each last-round winner
   * goes into the main draw as a qualifier ("Q"). Any knockout sport.
   */
  qualifying?: { into: string; rounds: number };
  /**
   * Stage 9 · T8 · this event is a consolation draw of a main event of the same
   * tournament, filled with its first-round losers ('first_round') or each
   * player's first-match losers ('first_match' — a bye's winner who loses next).
   */
  consolation?: { from: string; kind: 'first_round' | 'first_match' };
  /** Stage 9 · T16 · a ladder: how far up a challenge reaches (null: anyone), and how a win moves. */
  ladder?: LadderSettings;
  /** Stage 9 · T16 · a box league: box size, who goes up and down; `round` is the server's own count. */
  box?: BoxSettings;
};

/** Stage 9 · T13: does a full event take entries onto its waitlist (on unless the organiser turned it off)? */
export function waitlistOn(t: { settings?: unknown } | null | undefined): boolean {
  return settingsOf(t).waitlist !== false;
}

/** Stage 8 · F3: 'draw' (the default) locks squads when the fixtures are made; 'deadline' at the entries deadline; 'manual' when the organiser says (lockedAt); 'never'. The organiser can always change a squad. */
export type SquadRules = { size?: number | null; lock?: 'draw' | 'deadline' | 'manual' | 'never'; lockedAt?: string | null };

/** Stage 8 · F7: one award the organiser gives — to a person (account or name) and/or a team. */
export type PickedAward = { title: string; user_id?: string | null; name?: string | null; team_id?: string | null };
/** Stage 8 · F5: N yellows across the tournament = a ban of M matches; a red = R matches; yellows wiped after the group stage if set. */
export type DisciplineRules = { yellowsForBan?: number | null; banMatches?: number; redBanMatches?: number; resetAfterGroups?: boolean };
export const AWARD_TITLE_MAX = 60;

export const GRACE_MINUTES: [number, number] = [5, 60];
export const MIN_PLAYERS: [number, number] = [2, 15];

/** Oct 2026 (Dipak): a Swiss has at least 2 rounds and at most one fewer than its players (no fixed top). */
export const SWISS_MIN_ROUNDS = 2;

/** Why these rounds don't suit a Swiss of `players` (unknown: only the minimum), or null. */
export function swissRoundsProblem(rounds: unknown, players?: number | null): string | null {
  if (!(typeof rounds === 'number' && Number.isInteger(rounds) && rounds >= SWISS_MIN_ROUNDS)) return `A Swiss has at least ${SWISS_MIN_ROUNDS} rounds.`;
  if (players != null && Number.isFinite(players) && players >= 3 && rounds > players - 1) return `${players} players can play at most ${players - 1} Swiss rounds without meeting twice.`;
  return null;
}

/** Why a new Swiss can't be created (chess only, with its rounds), or null. */
/** Stage 9 · T16: ladders and box leagues are for the one-on-one and pair sports. */
export function ladderCreateRefusal(sport: string | null | undefined, format: string | null | undefined): Refusal | null {
  if (format !== 'ladder' && format !== 'box') return null;
  if (!(LADDER_SPORTS as readonly string[]).includes(sportKeyOf(sport))) return refuse(`${format === 'ladder' ? 'Ladders' : 'Box leagues'} are for badminton, tennis, table tennis, pickleball, chess and carrom.`);
  return null;
}

export function swissCreateRefusal(sport: string | null | undefined, settings: unknown): Refusal | null {
  if (sportKeyOf(sport) !== 'chess') return refuse('Swiss is for chess.');
  const sw = settings && typeof settings === 'object' ? (settings as { swiss?: unknown }).swiss : null;
  if (!sw) return refuse('A Swiss needs its number of rounds.');
  return null;
}
/** A sensible number of rounds for a field: enough to separate a winner (log₂ N, rounded up), plus one. */
export const swissRoundsFor = (teams: number): number => Math.min(Math.max(SWISS_MIN_ROUNDS, teams - 1), Math.max(SWISS_MIN_ROUNDS, Math.ceil(Math.log2(Math.max(2, teams))) + 1));

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
  /**
   * Badminton 7.11 · how age is counted: 'year' = the age a player turns in the
   * tournament's year (age on 31 Dec — BAI's birth-year cut-off: U-15 is "born
   * on or after 1 Jan of year − 14"). Absent = the age on the start date (as before).
   */
  ageBasis?: 'year' | null;
  /**
   * Stage 9 · T12 · a doubles pair's ages add up to at least this (club doubles
   * "90+", "100+", "110+"), counted the same way as the ages above. Any doubles
   * or pair sport; checked when the pair forms.
   */
  pairAgeMin?: number | null;
  /**
   * Stage 9 · T12 · amateurs only: whoever enters declares nobody in the entry is
   * a coach, an ex-professional or a marker (the organiser can still refuse an entry).
   */
  amateurOnly?: boolean | null;
};

/** Stage 9 · T12: a pair's combined age, 40 to 200. */
export const PAIR_AGE_MIN: [number, number] = [40, 200];

const isInt = (x: unknown, lo: number, hi: number) => typeof x === 'number' && Number.isInteger(x) && x >= lo && x <= hi;

export function categoryRefusal(c: unknown): Refusal | null {
  if (c === undefined || c === null) return null;
  if (typeof c !== 'object' || Array.isArray(c)) return refuse('A category must be an object.');
  const o = c as Record<string, unknown>;
  const unknown = Object.keys(o).find((k) => !['gender', 'underAge', 'minAge', 'maxRating', 'minRating', 'ageBasis', 'pairAgeMin', 'amateurOnly'].includes(k));
  if (unknown) return refuse(`“${unknown}” isn’t part of a category.`);
  if (o.ageBasis != null && o.ageBasis !== 'year') return refuse('Ages are on the start date, or by birth year.');
  if (o.gender != null && !['men', 'women', 'mixed'].includes(o.gender as string)) return refuse('A category is men’s, women’s, mixed or open.');
  if (o.underAge != null && !isInt(o.underAge, 6, 25)) return refuse('An under-age limit is 6 to 25.');
  if (o.minAge != null && !isInt(o.minAge, 30, 80)) return refuse('A minimum age is 30 to 80.');
  if (o.underAge != null && o.minAge != null) return refuse('A category is an under-age limit or a minimum age, not both.');
  if (o.maxRating != null && !isInt(o.maxRating, 100, 3000)) return refuse('A rating limit is 100 to 3000.');
  if (o.minRating != null && !isInt(o.minRating, 100, 3000)) return refuse('A rating limit is 100 to 3000.');
  if (o.maxRating != null && o.minRating != null && (o.minRating as number) > (o.maxRating as number)) return refuse('The lowest rating can’t be above the highest.');
  if (o.pairAgeMin != null && !isInt(o.pairAgeMin, PAIR_AGE_MIN[0], PAIR_AGE_MIN[1])) return refuse(`A pair’s combined age is ${PAIR_AGE_MIN[0]} to ${PAIR_AGE_MIN[1]}.`); // Stage 9 · T12
  if (o.amateurOnly != null && typeof o.amateurOnly !== 'boolean') return refuse('Amateurs only is on or off.');
  return null;
}

/** The category kept, without empty parts; null when nothing's set (open). */
export function storedCategory(c: Record<string, any> | null | undefined): Category | null {
  if (!c) return null;
  const out: Category = {};
  for (const k of ['gender', 'underAge', 'minAge', 'maxRating', 'minRating', 'pairAgeMin'] as const) if (c[k] != null) (out as Record<string, unknown>)[k] = c[k];
  if (c.amateurOnly === true) out.amateurOnly = true; // Stage 9 · T12
  // 7.11: by birth year — only meaningful with an age limit (Stage 9 · T12: or a pair's combined age).
  if (c.ageBasis === 'year' && (out.underAge != null || out.minAge != null || out.pairAgeMin != null)) out.ageBasis = 'year';
  return Object.keys(out).length ? out : null;
}

/** "Women’s · Under 19 · Rated up to 1600", or null for open. */
export function categoryLabel(c: Category | null | undefined): string | null {
  if (!c) return null;
  const parts: string[] = [];
  if (c.gender) parts.push(c.gender === 'men' ? 'Men’s' : c.gender === 'women' ? 'Women’s' : 'Mixed');
  if (c.underAge != null) parts.push(`Under ${c.underAge}${c.ageBasis === 'year' ? ' (by birth year)' : ''}`);
  if (c.minAge != null) parts.push(`${c.minAge} and over${c.ageBasis === 'year' ? ' (by birth year)' : ''}`);
  if (c.minRating != null && c.maxRating != null) parts.push(`Rated ${c.minRating}–${c.maxRating}`);
  else if (c.maxRating != null) parts.push(`Rated up to ${c.maxRating}`);
  else if (c.minRating != null) parts.push(`Rated ${c.minRating} and up`);
  // Stage 9 · T12.
  if (c.pairAgeMin != null) parts.push(`Pairs ${c.pairAgeMin}+ combined${c.ageBasis === 'year' && c.underAge == null && c.minAge == null ? ' (by birth year)' : ''}`);
  if (c.amateurOnly) parts.push('Amateurs only');
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

/** 7.11 · the age a player turns in `on`'s year (their age on 31 December): BAI's birth-year cut-off. */
export function ageInYear(dob: string, on: Date): number | null {
  const m = /^(\d{4})-/.exec(dob);
  return m ? on.getUTCFullYear() - Number(m[1]) : null;
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
      // 7.11: by birth year, the age a player turns in the start date's year.
      const byYear = c.ageBasis === 'year';
      const age = p.dob ? (byYear ? ageInYear(p.dob, on) : ageOn(p.dob, on)) : null;
      if (age == null) return `${poss(p.name)} profile doesn’t list their date of birth, and this event has an age limit. Add it to the profile first.`;
      const year = on.getUTCFullYear();
      if (c.underAge != null && age >= c.underAge) {
        return byYear ? `This is an under-${c.underAge} event by birth year (born ${year - c.underAge + 1} or later), and ${p.name} turns ${age} in ${year}.`
          : `This is an under-${c.underAge} event, and ${p.name} is ${age} on the start date.`;
      }
      if (c.minAge != null && age < c.minAge) {
        return byYear ? `This event is for ${c.minAge} and over by birth year (born ${year - c.minAge} or earlier), and ${p.name} turns ${age} in ${year}.`
          : `This event is for ${c.minAge} and over, and ${p.name} is ${age} on the start date.`;
      }
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
  // Stage 9 · T12: a pair's combined age (two players; a bigger team is checked per rubber).
  if (c.pairAgeMin != null && players.length === 2) {
    const byYear = c.ageBasis === 'year';
    const ages = players.map((p) => (p.dob ? (byYear ? ageInYear(p.dob, on) : ageOn(p.dob, on)) : null));
    const missing = players.find((_, i) => ages[i] == null);
    if (missing) return `${poss(missing.name)} profile doesn’t list their date of birth, and this event is for pairs ${c.pairAgeMin}+ combined. Add it to the profile first.`;
    const sum = (ages[0] as number) + (ages[1] as number);
    if (sum < c.pairAgeMin) return `This event is for pairs ${c.pairAgeMin}+ combined${byYear ? ' (by birth year)' : ''}, and ${players[0]!.name} and ${players[1]!.name} add up to ${sum}.`;
  }
  return null;
}

/**
 * Stage 9 · T12 · an "amateurs only" event: why this entry can't be made
 * without the declaration (null when it's made, or not asked for).
 */
export function amateurDeclarationRefusal(c: Category | null | undefined, declared: unknown): Refusal | null {
  if (!c?.amateurOnly || declared === true) return null;
  return { error: 'This event is for amateurs: confirm nobody in your entry is a coach, an ex-professional or a marker.', code: 'DECLARATION' };
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
export const DRAW_KEYS = ['bestThirds', 'seeding', 'restMinutes', 'thirdPlace', 'separateClubs', 'category', 'swiss', 'directSeeds'] as const;

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

const KNOWN_KEYS = new Set(['v', 'points', 'bestThirds', 'seeding', 'walkoverScore', 'restMinutes', 'entry', 'thirdPlace', 'separateClubs', 'category', 'swiss', 'graceMinutes', 'minPlayers', 'tieFallback', 'withdrawnResults', 'awards', 'lots', 'bestNext', 'discipline', 'squad', 'waitlist', 'qualifying', 'consolation', 'ladder', 'box', 'directSeeds']);

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
  // Stage 8 · F7 / F8 / F5 and best runners-up: validated here, no app-imposed counts.
  const stage8 = stage8Refusal(format, o);
  if (stage8) return stage8;
  if (o.minPlayers != null && o.minPlayers !== 0 && !whole(o.minPlayers, MIN_PLAYERS)) return refuse(`The fewest players a team can play with must be ${MIN_PLAYERS[0]} to ${MIN_PLAYERS[1]}.`);
  if (o.swiss != null) {
    if (format !== 'swiss') return refuse('Swiss rounds are for a Swiss tournament.');
    const r = (o.swiss as { rounds?: unknown }).rounds;
    // Oct 2026: no fixed top — against the field's size where the caller knows it.
    const bad = swissRoundsProblem(r);
    if (bad) return refuse(bad);
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
  // Stage 9 · T16: a ladder's settings; a box league's (its round is the server's).
  if ('ladder' in s) {
    if (s.ladder) out.ladder = { ...('reach' in s.ladder ? { reach: s.ladder.reach ?? null } : {}), ...(s.ladder.move ? { move: s.ladder.move } : {}) };
    else delete out.ladder;
  }
  if ('box' in s) {
    if (s.box) out.box = { size: Number(s.box.size), up: Number(s.box.up), down: Number(s.box.down), ...(current?.box?.round != null ? { round: current.box.round } : {}) };
    else delete out.box;
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
  // Stage 8: awards (F7), lots (F8), best next-placed (groups), discipline (F5). Null / empty clears.
  if ('awards' in s) {
    const list = Array.isArray(s.awards) ? (s.awards as PickedAward[]).map((a) => ({
      title: String(a.title).trim(),
      ...(a.user_id ? { user_id: a.user_id } : {}),
      ...(a.name && String(a.name).trim() ? { name: String(a.name).trim() } : {}),
      ...(a.team_id ? { team_id: a.team_id } : {}),
    })) : [];
    if (list.length) out.awards = list; else delete out.awards;
  }
  if ('lots' in s) {
    if (s.lots && Object.keys(s.lots).length) out.lots = s.lots; else delete out.lots;
  }
  if ('directSeeds' in s) { // Stage 10 · TT2
    if (s.directSeeds) out.directSeeds = Number(s.directSeeds); else delete out.directSeeds;
  }
  if ('bestNext' in s) {
    if (s.bestNext != null) out.bestNext = Number(s.bestNext); else delete out.bestNext;
  }
  if ('discipline' in s) {
    if (s.discipline) out.discipline = s.discipline; else delete out.discipline;
  }
  if ('squad' in s) {
    if (s.squad) out.squad = s.squad; else delete out.squad;
  }
  // Stage 9 · T7 / T8: a draw's link (null removes it).
  for (const k of ['qualifying', 'consolation'] as const) {
    if (k in s) { if (s[k]) (out as Record<string, unknown>)[k] = s[k]; else delete (out as Record<string, unknown>)[k]; }
  }
  // Stage 9 · T13: kept only when turned off (on is the default).
  if ('waitlist' in s) {
    if (s.waitlist === false) out.waitlist = false; else delete out.waitlist;
  }
  return out;
}

const whole = (n: unknown): n is number => typeof n === 'number' && Number.isInteger(n);

/** Stage 8 · the new settings' checks (shapes only; the organiser chooses the numbers). */
function stage8Refusal(format: string | null | undefined, o: Record<string, any>): Refusal | null {
  if (o.awards != null) {
    if (!Array.isArray(o.awards)) return refuse('Awards are a list.');
    for (const a of o.awards) {
      if (!a || typeof a !== 'object') return refuse('Each award is a title and who it goes to.');
      const title = typeof a.title === 'string' ? a.title.trim() : '';
      if (!title || title.length > AWARD_TITLE_MAX) return refuse(`An award’s title is 1 to ${AWARD_TITLE_MAX} characters.`);
      const name = typeof a.name === 'string' ? a.name.trim() : '';
      if (name.length > AWARD_TITLE_MAX) return refuse(`A name is up to ${AWARD_TITLE_MAX} characters.`);
      if (a.user_id != null && typeof a.user_id !== 'string') return refuse('An award goes to a person on SportClan, a name or a team.');
      if (a.team_id != null && typeof a.team_id !== 'string') return refuse('An award goes to a person on SportClan, a name or a team.');
      if (!a.user_id && !name && !a.team_id) return refuse(`Say who “${title}” goes to.`);
    }
  }
  if (o.lots != null) {
    if (typeof o.lots !== 'object' || Array.isArray(o.lots)) return refuse('A draw of lots is an order of teams.');
    for (const v of Object.values(o.lots)) {
      if (!Array.isArray(v) || v.some((x) => typeof x !== 'string') || new Set(v).size !== v.length) return refuse('A draw of lots lists each team once.');
    }
  }
  if (o.waitlist != null && typeof o.waitlist !== 'boolean') return refuse('A waitlist is on or off.'); // Stage 9 · T13
  // Stage 9 · T7 / T8: a qualifying or consolation draw of another event (the server checks it's a sibling).
  const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
  if (o.qualifying != null) {
    const q = o.qualifying;
    if (typeof q !== 'object' || typeof q.into !== 'string' || !UUID.test(q.into)) return refuse('A qualifying draw needs its main draw.');
    if (!whole(q.rounds) || q.rounds < 1) return refuse('A qualifying draw plays 1 round or more.');
    if (format && format !== 'knockout') return refuse('A qualifying draw is a knockout.');
  }
  if (o.consolation != null) {
    const c = o.consolation;
    if (typeof c !== 'object' || typeof c.from !== 'string' || !UUID.test(c.from)) return refuse('A consolation draw needs its main draw.');
    if (c.kind !== 'first_round' && c.kind !== 'first_match') return refuse('A consolation draw takes first-round losers or first-match losers.');
  }
  if (o.qualifying != null && o.consolation != null) return refuse('A draw is a qualifying draw or a consolation draw, not both.');
  // Stage 9 · T16: a ladder's and a box league's own settings.
  const lBad = ladderSettingsProblem(o.ladder) ?? boxSettingsProblem(o.box);
  if (lBad) return refuse(lBad);
  if (o.ladder != null && format && format !== 'ladder') return refuse('Ladder settings are for a ladder.');
  if (o.box != null && format && format !== 'box') return refuse('Box settings are for a box league.');
  // Stage 10 · TT2: seeds straight into the knockout — a whole number, groups → knockout only.
  if (o.directSeeds != null) {
    if (!whole(o.directSeeds) || o.directSeeds < 0) return refuse('The seeds going straight to the knockout is a whole number.');
    if (o.directSeeds > 0 && format && format !== 'groups_knockout') return refuse('Seeds go straight to the knockout in groups → knockout.');
  }
  if (o.bestNext != null) {
    if (!whole(o.bestNext) || o.bestNext < 0) return refuse('The best next-placed teams going through is a whole number.');
    if (format !== 'groups_knockout') return refuse('Best next-placed teams are for groups → knockout.');
  }
  if (o.squad != null) {
    const q = o.squad;
    if (typeof q !== 'object' || Array.isArray(q)) return refuse('Squads are a size and when they lock.');
    if (q.size != null && (!whole(q.size) || q.size < 1)) return refuse('A squad size must be 1 or more, or none.');
    if (q.lock != null && !['draw', 'deadline', 'manual', 'never'].includes(q.lock)) return refuse('Squads lock at the draw, at the entries deadline, when you say, or never.');
    if (q.lockedAt != null && (typeof q.lockedAt !== 'string' || !Number.isFinite(Date.parse(q.lockedAt)))) return refuse('When the squads locked is a date.');
  }
  if (o.discipline != null) {
    const d = o.discipline;
    if (typeof d !== 'object' || Array.isArray(d)) return refuse('Discipline is the yellows for a ban and the matches it lasts.');
    if (d.yellowsForBan != null && (!whole(d.yellowsForBan) || d.yellowsForBan < 1)) return refuse('Yellows for a ban must be 1 or more, or none.');
    if (d.banMatches != null && (!whole(d.banMatches) || d.banMatches < 1)) return refuse('A ban is 1 match or more.');
    if (d.redBanMatches != null && (!whole(d.redBanMatches) || d.redBanMatches < 0)) return refuse('A red card’s ban is 0 matches or more.');
    if (d.resetAfterGroups != null && typeof d.resetAfterGroups !== 'boolean') return refuse('Yellows are wiped after the groups, or not.');
  }
  return null;
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
