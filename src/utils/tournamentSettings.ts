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

// ── the settings object ──────────────────────────────────────────────────────

export type TournamentSettings = {
  v: 1;
  points?: PointsTemplate;
};

/** A tournament row's settings, or an empty v1 object. Never throws. */
export function settingsOf(t: { settings?: unknown } | null | undefined): TournamentSettings {
  const s = t?.settings;
  return (s && typeof s === 'object' && !Array.isArray(s) ? s : { v: 1 }) as TournamentSettings;
}

const KNOWN_KEYS = new Set(['v', 'points']);

/** Why a settings object (whole, or a partial edit of one) can't be stored. */
export function settingsRefusal(sport: string | null | undefined, format: string | null | undefined, s: unknown): Refusal | null {
  if (s === undefined || s === null) return null;
  if (typeof s !== 'object' || Array.isArray(s)) return refuse('Tournament settings must be an object.');
  const o = s as Record<string, unknown>;
  const unknown = Object.keys(o).find((k) => !KNOWN_KEYS.has(k));
  if (unknown) return refuse(`“${unknown}” isn’t a tournament setting.`);
  if (o.v !== undefined && o.v !== 1) return refuse('Tournament settings version must be 1.');
  void format;
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
  return out;
}
