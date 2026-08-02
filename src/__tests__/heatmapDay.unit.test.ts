/**
 * SC-392 · the activity heatmap must bucket by the IST calendar day.
 *
 * It used `toISOString().slice(0,10)` — a UTC date — on both the match key and
 * the grid key. They agreed with each other, so nothing looked broken, but both
 * were the wrong day: a match at 00:15 IST is 18:45Z the PREVIOUS day, so every
 * match played between 00:00 and 05:30 IST was drawn on yesterday's cell.
 */
import { istDay } from '../utils/appTime';

describe('SC-392 · heatmap day bucketing', () => {
  it('00:15 IST belongs to that IST day, not the previous UTC one', () => {
    // 2026-08-02 00:15 IST === 2026-08-01T18:45:00Z
    const d = new Date('2026-08-01T18:45:00Z');
    expect(d.toISOString().slice(0, 10)).toBe('2026-08-01'); // the old, wrong key
    expect(istDay(d)).toBe('2026-08-02');                    // the correct one
  });

  it('the whole 00:00-05:29 IST window lands on the right day', () => {
    for (const [utc, expected] of [
      ['2026-08-01T18:30:00Z', '2026-08-02'], // 00:00 IST exactly
      ['2026-08-01T18:45:00Z', '2026-08-02'], // 00:15 IST
      ['2026-08-01T23:59:00Z', '2026-08-02'], // 05:29 IST
      ['2026-08-02T00:00:00Z', '2026-08-02'], // 05:30 IST
    ] as const) {
      expect(istDay(new Date(utc))).toBe(expected);
    }
  });

  it('an evening match is unaffected (why this hid)', () => {
    const d = new Date('2026-08-02T15:30:00Z'); // 21:00 IST
    expect(d.toISOString().slice(0, 10)).toBe('2026-08-02');
    expect(istDay(d)).toBe('2026-08-02');       // old and new agree here
  });

  it('the last IST minute of a day does not spill into the next', () => {
    const d = new Date('2026-08-02T18:29:00Z'); // 23:59 IST on 2 Aug
    expect(istDay(d)).toBe('2026-08-02');
  });

  it('grid keys built from a UTC-midnight walk still name the right IST day', () => {
    // The grid walks days from `since`; istDay of each UTC midnight is 05:30 IST
    // that same date, so the calendar date is preserved.
    expect(istDay(new Date('2026-08-02T00:00:00Z'))).toBe('2026-08-02');
  });
});
