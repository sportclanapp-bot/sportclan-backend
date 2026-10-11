/**
 * Stage 8 · F14 / F11 (Oct 2026) · one terminology map per sport: what its
 * playing areas are called, what its match official is called, the assistant
 * officials it has, and the placeholders the forms suggest. No cricket words
 * on other sports.
 *
 * Byte-for-byte the same file in the app (src/sport/sportTerms.ts) and the
 * backend (src/utils/sportTerms.ts) — a test checks it. No imports.
 */

/** An assistant official a sport has (stored as `key` on match_officials.role). */
export type AssistantRole = { key: string; label: string };

export type SportTerms = {
  /** A playing area: "Pitch", "Court", "Table", "Board", "Ground". */
  area: string;
  areas: string;
  /** The match official in charge: "Referee", "Umpire", "Arbiter". */
  official: string;
  officials: string;
  /** Assistant officials the sport has (none for some). */
  assistants: AssistantRole[];
  /** Placeholders. */
  venue: string;
  name: string;
  areaNames: string;
  /**
   * Stage 10 · TT12 · the tournament's official above the match officials (who
   * decides defaults, walkovers and disputes) and their deputy, in the sport's
   * words — "Referee" / "Deputy referee" (ITTF, BWF, ITF), "Chief arbiter"
   * (FIDE), "Match referee" (cricket)… — and the generic assistant's word.
   */
  referee: string;
  deputyReferee: string | null;
  assistant: string;
  /**
   * Stage 12 · CH11 · the tournament's other officials, by function, where the
   * sport has them (chess: Pairings, Sector and Anti-cheating arbiters). Empty
   * elsewhere — every other sport's equivalents are its match assistants and
   * its referee / deputy.
   */
  deskRoles: Partial<Record<'pairings' | 'sector' | 'fair_play', string>>;
  /**
   * Audit batch 4 (#121–#130, 11 Oct 2026) · the rest of a sport's own words, so
   * no screen or server message borrows another sport's:
   *  icon      its emoji (🏸 on a badminton line, 🏓 on a table-tennis one);
   *  start     how play begins: "Kick-off", "Push-back", "Tip-off" — else "Start";
   *  shootout  how a level knockout is settled after play: "Penalties",
   *            "Shoot-out", "Super over" — null where there is none;
   *  level     a level result: "Draw", or "Tied" for cricket (and any sport
   *            whose level result is not a draw);
   *  draws     whether a match can end level (the standings' D column, a
   *            team's DREW);
   *  credited  what a player scores: "runs", "goals", "points" — null for chess.
   */
  icon: string;
  start: string;
  shootout: string | null;
  level: 'Draw' | 'Tied';
  draws: boolean;
  credited: 'runs' | 'goals' | 'points' | null;
};

/** The words above that differ by sport (the rest default as for most sports). */
type More = Partial<Pick<SportTerms, 'start' | 'shootout' | 'level' | 'draws' | 'credited' | 'deskRoles'>> & { icon: string };

const key = (s: string | null | undefined): string => String(s ?? '').toLowerCase().replace(/[-_\s]/g, '');

/** "Pitch" → "Pitches", "Court" → "Courts". */
const plural = (w: string): string => (/(ch|sh|s|x)$/i.test(w) ? `${w}es` : `${w}s`);

const t = (more: More, area: string, official: string, assistants: AssistantRole[], venue: string, name: string, areaNames: string, referee = 'Referee', deputyReferee: string | null = 'Deputy referee'): SportTerms => ({
  area, areas: plural(area), official, officials: plural(official), assistants, venue, name, areaNames,
  referee, deputyReferee, assistant: `Assistant ${official.toLowerCase()}`, deskRoles: {},
  start: 'Start', shootout: null, level: 'Tied', draws: false, credited: 'points', ...more,
});

/** Cricket's words: every screen's words before Stage 8, and the default. */
// Stage 14 · VB10: each sport's scorers and reserve officials too (ICC's fourth umpire; FIFA's reserve assistant;
// FIH's judge and reserve umpire; FIBA's table; FIVB's assistant scorer, challenge and reserve referees; BWF's reserve umpire —
// the match's scorer is every fixture's own, beside the referee).
const CRICKET = t({ icon: '🏏', shootout: 'Super over', draws: true, credited: 'runs' }, 'Ground', 'Umpire', [{ key: 'umpire_2', label: 'Second umpire' }, { key: 'third_umpire', label: 'Third umpire' }, { key: 'fourth_umpire', label: 'Fourth umpire' }],
  'e.g. MCA Ground', 'e.g. Mumbai T20 Cup 2026', 'e.g. MCA Pitch 1, Turf A', 'Match referee', null);

const TERMS: Record<string, SportTerms> = {
  cricket: CRICKET,
  football: t({ icon: '⚽', start: 'Kick-off', shootout: 'Penalties', level: 'Draw', draws: true, credited: 'goals' }, 'Pitch', 'Referee', [
    { key: 'assistant_referee_1', label: 'Assistant referee 1' },
    { key: 'assistant_referee_2', label: 'Assistant referee 2' },
    { key: 'fourth_official', label: 'Fourth official' },
    { key: 'reserve_assistant_referee', label: 'Reserve assistant referee' },
  ], 'e.g. Hindu Gymkhana Turf', 'e.g. Bandra Sunday League 2026', 'e.g. Turf A, Turf B', 'Match commissioner', null),
  hockey: t({ icon: '🏑', start: 'Push-back', shootout: 'Shoot-out', level: 'Draw', draws: true, credited: 'goals' }, 'Pitch', 'Umpire', [{ key: 'umpire_2', label: 'Second umpire' }, { key: 'technical_officer', label: 'Technical officer' }, { key: 'judge', label: 'Judge (timekeeper)' }, { key: 'reserve_umpire', label: 'Reserve umpire' }],
    'e.g. Municipal Hockey Stadium', 'e.g. Pune Hockey Cup 2026', 'e.g. Pitch 1, Pitch 2', 'Technical delegate', null),
  basketball: t({ icon: '🏀', start: 'Tip-off' }, 'Court', 'Referee', [{ key: 'umpire_1', label: 'Umpire 1' }, { key: 'umpire_2', label: 'Umpire 2' }, { key: 'table_official', label: 'Table official' }, { key: 'assistant_scorer', label: 'Assistant scorer' }, { key: 'timer', label: 'Timer' }, { key: 'shot_clock_operator', label: 'Shot clock operator' }],
    'e.g. City Indoor Stadium', 'e.g. Delhi 3x3 Cup 2026', 'e.g. Court 1, Court 2', 'Commissioner', null),
  volleyball: t({ icon: '🏐' }, 'Court', 'Referee', [{ key: 'second_referee', label: 'Second referee' }, { key: 'line_judge', label: 'Line judge' }, { key: 'assistant_scorer', label: 'Assistant scorer' }, { key: 'challenge_referee', label: 'Challenge referee' }, { key: 'reserve_referee', label: 'Reserve referee' }],
    'e.g. City Indoor Stadium', 'e.g. Goa Beach Volleyball Cup 2026', 'e.g. Court 1, Court 2', 'Referee delegate', null),
  badminton: t({ icon: '🏸' }, 'Court', 'Umpire', [{ key: 'service_judge', label: 'Service judge' }, { key: 'line_judge', label: 'Line judge' }, { key: 'reserve_umpire', label: 'Reserve umpire' }],
    'e.g. City Indoor Stadium', 'e.g. Pune Badminton Open 2026', 'e.g. Court 1, Court 2'),
  tennis: t({ icon: '🎾' }, 'Court', 'Umpire', [{ key: 'line_judge', label: 'Line judge' }],
    'e.g. PYC Tennis Courts', 'e.g. Pune Tennis Open 2026', 'e.g. Centre court, Court 2'),
  tabletennis: t({ icon: '🏓' }, 'Table', 'Umpire', [{ key: 'assistant_umpire', label: 'Assistant umpire' }],
    'e.g. Community Hall', 'e.g. Thane TT Championship 2026', 'e.g. Table 1, Table 2'),
  pickleball: t({ icon: '🥒' }, 'Court', 'Referee', [{ key: 'line_judge', label: 'Line judge' }],
    'e.g. City Indoor Stadium', 'e.g. Bengaluru Pickleball Open 2026', 'e.g. Court 1, Court 2', 'Head referee', 'Deputy head referee'),
  chess: t({ icon: '♟️', level: 'Draw', draws: true, credited: null, deskRoles: { pairings: 'Pairings arbiter', sector: 'Sector arbiter', fair_play: 'Anti-cheating arbiter' } }, // Stage 12 · CH11 (FIDE)
    'Board', 'Arbiter', [{ key: 'deputy_arbiter', label: 'Deputy arbiter' }],
    'e.g. Community Hall', 'e.g. Thane Rapid Open 2026', 'e.g. Board 1, Board 2', 'Chief arbiter', 'Deputy chief arbiter'),
  carrom: t({ icon: '⚪' }, 'Board', 'Umpire', [],
    'e.g. Dadar Club Hall', 'e.g. Dadar Carrom Championship 2026', 'e.g. Board 1, Board 2', 'Chief referee', 'Deputy chief referee'),
  kabaddi: t({ icon: '🤼' }, 'Court', 'Referee', [{ key: 'umpire_1', label: 'Umpire 1' }, { key: 'umpire_2', label: 'Umpire 2' }],
    'e.g. Shahu Stadium', 'e.g. Kolhapur Kabaddi Cup 2026', 'e.g. Court 1, Court 2', 'Technical delegate', null),
};

/** A sport's words. An unknown or missing sport gets cricket's (as before Stage 8). */
export function sportTerms(sport: string | null | undefined): SportTerms {
  return TERMS[key(sport)] ?? CRICKET;
}

/** A playing area's default name when the organiser named none: "Pitch 2". */
export function areaLabel(sport: string | null | undefined, index: number): string {
  return `${sportTerms(sport).area} ${index + 1}`;
}

/** Is `role` one of this sport's assistant officials? */
export function isAssistantRole(sport: string | null | undefined, role: string): boolean {
  return sportTerms(sport).assistants.some((a) => a.key === role);
}

/** Audit #121: "Kick-off time" for football, "Push-back time" for hockey, "Start time" for the rest. */
export function startTimeLabel(sport: string | null | undefined): string {
  return `${sportTerms(sport).start} time`;
}
