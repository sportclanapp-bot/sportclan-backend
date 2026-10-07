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
};

const key = (s: string | null | undefined): string => String(s ?? '').toLowerCase().replace(/[-_\s]/g, '');

/** "Pitch" → "Pitches", "Court" → "Courts". */
const plural = (w: string): string => (/(ch|sh|s|x)$/i.test(w) ? `${w}es` : `${w}s`);

const t = (area: string, official: string, assistants: AssistantRole[], venue: string, name: string, areaNames: string): SportTerms => ({
  area, areas: plural(area), official, officials: plural(official), assistants, venue, name, areaNames,
});

/** Cricket's words: every screen's words before Stage 8, and the default. */
const CRICKET = t('Ground', 'Umpire', [{ key: 'umpire_2', label: 'Second umpire' }, { key: 'third_umpire', label: 'Third umpire' }],
  'e.g. MCA Ground', 'e.g. Mumbai T20 Cup 2026', 'e.g. MCA Pitch 1, Turf A');

const TERMS: Record<string, SportTerms> = {
  cricket: CRICKET,
  football: t('Pitch', 'Referee', [
    { key: 'assistant_referee_1', label: 'Assistant referee 1' },
    { key: 'assistant_referee_2', label: 'Assistant referee 2' },
    { key: 'fourth_official', label: 'Fourth official' },
  ], 'e.g. Hindu Gymkhana Turf', 'e.g. Bandra Sunday League 2026', 'e.g. Turf A, Turf B'),
  hockey: t('Pitch', 'Umpire', [{ key: 'umpire_2', label: 'Second umpire' }, { key: 'technical_officer', label: 'Technical officer' }],
    'e.g. Municipal Hockey Stadium', 'e.g. Pune Hockey Cup 2026', 'e.g. Pitch 1, Pitch 2'),
  basketball: t('Court', 'Referee', [{ key: 'umpire_1', label: 'Umpire 1' }, { key: 'umpire_2', label: 'Umpire 2' }, { key: 'table_official', label: 'Table official' }],
    'e.g. City Indoor Stadium', 'e.g. Delhi 3x3 Cup 2026', 'e.g. Court 1, Court 2'),
  volleyball: t('Court', 'Referee', [{ key: 'second_referee', label: 'Second referee' }, { key: 'line_judge', label: 'Line judge' }],
    'e.g. City Indoor Stadium', 'e.g. Goa Beach Volleyball Cup 2026', 'e.g. Court 1, Court 2'),
  badminton: t('Court', 'Umpire', [{ key: 'service_judge', label: 'Service judge' }, { key: 'line_judge', label: 'Line judge' }],
    'e.g. City Indoor Stadium', 'e.g. Pune Badminton Open 2026', 'e.g. Court 1, Court 2'),
  tennis: t('Court', 'Umpire', [{ key: 'line_judge', label: 'Line judge' }],
    'e.g. PYC Tennis Courts', 'e.g. Pune Tennis Open 2026', 'e.g. Centre court, Court 2'),
  tabletennis: t('Table', 'Umpire', [{ key: 'assistant_umpire', label: 'Assistant umpire' }],
    'e.g. Community Hall', 'e.g. Thane TT Championship 2026', 'e.g. Table 1, Table 2'),
  pickleball: t('Court', 'Referee', [{ key: 'line_judge', label: 'Line judge' }],
    'e.g. City Indoor Stadium', 'e.g. Bengaluru Pickleball Open 2026', 'e.g. Court 1, Court 2'),
  chess: t('Board', 'Arbiter', [{ key: 'deputy_arbiter', label: 'Deputy arbiter' }],
    'e.g. Community Hall', 'e.g. Thane Rapid Open 2026', 'e.g. Board 1, Board 2'),
  carrom: t('Board', 'Umpire', [],
    'e.g. Dadar Club Hall', 'e.g. Dadar Carrom Championship 2026', 'e.g. Board 1, Board 2'),
  kabaddi: t('Court', 'Referee', [{ key: 'umpire_1', label: 'Umpire 1' }, { key: 'umpire_2', label: 'Umpire 2' }],
    'e.g. Shahu Stadium', 'e.g. Kolhapur Kabaddi Cup 2026', 'e.g. Court 1, Court 2'),
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
