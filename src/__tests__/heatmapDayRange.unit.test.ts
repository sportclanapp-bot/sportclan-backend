/**
 * SC-415 · the heatmap grid must be anchored to IST days.
 *
 * The bug: match keys are IST days (SC-392) but the grid walked server (UTC)
 * midnights, so the last cell was today's UTC date. A match completed at
 * 19:35 UTC keys to the NEXT IST day (01:05 IST) — outside the grid — and
 * disappeared. Proven live with match 9069effe: total_matches, sport profile
 * and the 90-day recap all had it; only the heatmap lost it.
 *
 * That is a ~5.5 hour window (00:00-05:30 IST) losing matches EVERY day.
 */
import { istDay } from '../utils/appTime';

/** The grid builder, extracted exactly as the controller now computes it. */
function gridKeys(nowMs: number): string[] {
  const out: string[] = [];
  for (let i = 0; i < 84; i++) out.push(istDay(new Date(nowMs - (83 - i) * 86400000)));
  return out;
}

/** How a match is keyed. */
const matchKey = (iso: string) => istDay(new Date(iso));

describe('heatmap grid ↔ match key alignment', () => {
  it('contains the day of a match completed at 19:35 UTC — the exact live failure', () => {
    const completedAt = '2026-08-03T19:35:55.462Z';        // 01:05 IST on 04 Aug
    const now = Date.parse('2026-08-03T20:00:00Z');         // still 03 Aug in UTC
    expect(matchKey(completedAt)).toBe('2026-08-04');       // keys to tomorrow-in-UTC-terms
    expect(gridKeys(now)).toContain(matchKey(completedAt)); // ...and the grid must have it
  });

  it('ends on TODAY in IST, not today in UTC', () => {
    const now = Date.parse('2026-08-03T20:00:00Z');
    expect(gridKeys(now).at(-1)).toBe('2026-08-04');
  });

  it('covers the whole 00:00-05:30 IST window that used to be dropped', () => {
    const now = Date.parse('2026-08-03T23:59:00Z');
    const keys = gridKeys(now);
    for (const h of ['18:30', '20:00', '22:15', '23:58']) {
      expect(keys).toContain(matchKey(`2026-08-03T${h}:00Z`));
    }
  });

  it('emits 84 contiguous, unique days', () => {
    const keys = gridKeys(Date.parse('2026-08-03T20:00:00Z'));
    expect(keys).toHaveLength(84);
    expect(new Set(keys).size).toBe(84);
    for (let i = 1; i < keys.length; i++) {
      const prev = Date.parse(keys[i - 1] + 'T00:00:00Z');
      const cur = Date.parse(keys[i] + 'T00:00:00Z');
      expect(cur - prev).toBe(86400000);
    }
  });

  it('still contains a normal midday match', () => {
    const now = Date.parse('2026-08-03T20:00:00Z');
    expect(gridKeys(now)).toContain(matchKey('2026-08-01T09:00:00Z'));
  });
});

describe('SC-415 · completion day beats scheduled day', () => {
  /** ts precedence as the controller now resolves it. */
  const ts = (m: { completed_at?: string; updated_at?: string; scheduled_at?: string }) =>
    m.completed_at ?? m.updated_at ?? m.scheduled_at;

  it('buckets on the day it was COMPLETED, not the day it was scheduled', () => {
    const m = { scheduled_at: '2026-08-04T12:00:00Z', completed_at: '2026-08-03T10:00:00Z' };
    expect(matchKey(ts(m)!)).toBe('2026-08-03');
  });

  it('a later edit cannot move the day once completed_at is set', () => {
    const m = {
      scheduled_at: '2026-08-04T12:00:00Z',
      completed_at: '2026-08-03T10:00:00Z',
      updated_at: '2026-08-09T10:00:00Z',   // row touched days later
    };
    expect(matchKey(ts(m)!)).toBe('2026-08-03');
  });

  it('falls back to updated_at for rows predating migration 085', () => {
    const m = { scheduled_at: '2026-08-04T12:00:00Z', updated_at: '2026-08-03T10:00:00Z' };
    expect(matchKey(ts(m)!)).toBe('2026-08-03');
  });
});
