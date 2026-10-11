/**
 * Audit batch 4 · #115–#120 (11 Oct 2026) · one display name for every stored
 * code a person might see: a sport, a tournament format, an entry kind, a
 * status, a match format. Screens and server messages print these, never the
 * raw value ("bo3", "box", "groups knockout", "tabletennis · completed").
 *
 * Byte-for-byte the same file in the app (src/utils/displayNames.ts) and the
 * backend (src/utils/displayNames.ts) — a test checks it. No imports.
 */

const key = (s: string | null | undefined): string => String(s ?? '').trim().toLowerCase().replace(/[-_\s]/g, '');

/** "receiver_swap" → "Receiver swap": the last resort for a code nobody named. */
export function plainName(code: string | null | undefined): string {
  const w = String(code ?? '').replace(/[_-]+/g, ' ').replace(/\s+/g, ' ').trim().toLowerCase();
  return w ? w.charAt(0).toUpperCase() + w.slice(1) : '';
}

const SPORT_NAMES: Record<string, string> = {
  cricket: 'Cricket', badminton: 'Badminton', football: 'Football', tennis: 'Tennis', tabletennis: 'Table Tennis',
  pickleball: 'Pickleball', chess: 'Chess', carrom: 'Carrom', volleyball: 'Volleyball', basketball: 'Basketball', hockey: 'Hockey',
  kabaddi: 'Kabaddi',
};

/** "tabletennis" / "table-tennis" → "Table Tennis". */
export function sportName(slug: string | null | undefined): string {
  return SPORT_NAMES[key(slug)] ?? plainName(slug);
}

/** Is this stored value just a sport's own name (old matches stored their sport as the format)? */
export function isSportSlug(value: string | null | undefined): boolean {
  return key(value) in SPORT_NAMES;
}

/**
 * A tournament format by name. Chess's "league" is a double round robin (FIDE
 * Berger tables); a knockout with double elimination says so.
 */
export function tournamentFormatName(format: string | null | undefined, sport?: string | null, opts?: { double?: boolean }): string {
  switch (key(format)) {
    case 'knockout': return opts?.double ? 'Double elimination' : 'Knockout';
    case 'league': return key(sport) === 'chess' ? 'Double round robin' : 'League';
    case 'roundrobin': return 'Round robin';
    case 'groupsknockout': return 'Groups → knockout';
    case 'swiss': return 'Swiss';
    case 'ladder': return 'Ladder';
    case 'box': return 'Box league';
    case '': return '';
    default: return plainName(format);
  }
}

/** "Singles", "Doubles"; nothing for teams (the usual case says nothing). */
export function entryKindName(kind: string | null | undefined): string | null {
  switch (key(kind)) {
    case 'singles': return 'Singles';
    case 'doubles': return 'Doubles';
    case 'team': case '': return null;
    default: return plainName(kind);
  }
}

/**
 * A tournament or match status, the same on every screen: the server's four,
 * and the older names still read ("registration" and "draft" were upcoming).
 */
export function statusName(status: string | null | undefined): string {
  switch (key(status)) {
    case 'live': return 'Live';
    case 'upcoming': case 'registration': case 'draft': case 'scheduled': return 'Upcoming';
    case 'completed': return 'Completed';
    case 'cancelled': return 'Cancelled';
    case 'abandoned': return 'Abandoned';
    default: return plainName(status);
  }
}

/**
 * A match's stored `format` in words, or null when it says nothing worth
 * showing (an old match stored its sport's name). "bo3" → "Best of 3",
 * "bo1" → "1 game"; cricket's "box" / "pair" by name; "T20" and chess's
 * "Blitz · 5+0" as stored.
 */
export function matchFormatName(format: string | null | undefined, opts?: { unit?: string }): string | null {
  const f = String(format ?? '').trim();
  if (!f || isSportSlug(f)) return null;
  const bo = /^bo(\d+)$/i.exec(f);
  if (bo) {
    const n = Number(bo[1]);
    const unit = opts?.unit ?? 'game';
    return n === 1 ? `1 ${unit}` : unit === 'set' ? `Best of ${n} sets` : `Best of ${n}`;
  }
  switch (key(f)) {
    case 'box': return 'Box cricket';
    case 'pair': return 'Pair cricket';
    case 'limited': return 'Limited overs';
    default: return /^[a-z]+(_[a-z]+)+$/.test(f) ? plainName(f) : f;
  }
}
