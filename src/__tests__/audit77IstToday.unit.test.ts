/**
 * Audit #77 (11 Oct 2026): "today" was the UTC date, so a tournament went live
 * at 05:30 IST, a box league's "tomorrow" was a day out before 05:30 IST, and a
 * Swiss's next round could be timed at night.
 */
import { ymd, ymdIn, statusAfterFixtures } from '../utils/tournamentStatus';
import { withinPlayingHours } from '../controllers/tournaments.controller';

describe('audit #77', () => {
  it('India’s date: 00:10 IST on 12 Oct is already the 12th (UTC still says the 11th)', () => {
    const t = new Date('2026-10-11T18:40:00Z'); // 00:10 IST, 12 Oct
    expect(ymd(t)).toBe('2026-10-12');
    expect(ymdIn(1, t)).toBe('2026-10-13');
    expect(statusAfterFixtures('2026-10-12', t)).toBe('live');
  });
  it('…and at 23:50 IST on the 11th it’s still the 11th', () => {
    expect(ymd(new Date('2026-10-11T18:20:00Z'))).toBe('2026-10-11');
  });
  it('a Swiss round past the day’s hours moves to the next morning; before them, to that morning', () => {
    const cfg = { dailyStartMin: 9 * 60, dailyEndMin: 21 * 60, durationMin: 60 };
    expect(new Date(withinPlayingHours(Date.parse('2026-10-11T16:00:00Z'), cfg)).toISOString()).toBe('2026-10-12T03:30:00.000Z'); // 21:30 IST → 09:00 IST next day
    expect(new Date(withinPlayingHours(Date.parse('2026-10-11T00:30:00Z'), cfg)).toISOString()).toBe('2026-10-11T03:30:00.000Z'); // 06:00 IST → 09:00 IST
    expect(new Date(withinPlayingHours(Date.parse('2026-10-11T08:30:00Z'), cfg)).toISOString()).toBe('2026-10-11T08:30:00.000Z'); // 14:00 IST stays
  });
});
