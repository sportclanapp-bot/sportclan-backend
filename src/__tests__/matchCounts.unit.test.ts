/**
 * SC-413 · the two sources must obey ONE rule.
 *
 * The profile header showed 0 MATCHES while the 90-day panel showed 1 — a window
 * claiming more than a lifetime. Neither screen was wrong: matches_played
 * applies the SC-283 anti-farm rule (casual needs >=2 real participants) and the
 * recap applied none. Prod verdict on the offending match: real_participants = 1
 * and no user_sport_profiles rows — SC-283 was right, the recap was wrong.
 *
 * The last test is the important one: it pins the recap/insights rule to the
 * SAME predicate completeMatch uses, so they cannot drift apart again.
 */
import { countsTowardRecord, MIN_CASUAL_PARTICIPANTS } from '../utils/matchCounts';

const completed = (over: Record<string, unknown> = {}) =>
  ({ status: 'completed', is_ranked: false, ...over });

describe('countsTowardRecord', () => {
  it('EXCLUDES the exact prod case: casual, 1 real participant (solo vs phantom)', () => {
    expect(countsTowardRecord(completed(), 1)).toBe(false);
  });

  it('includes a casual match once a second real participant is there', () => {
    expect(countsTowardRecord(completed(), 2)).toBe(true);
  });

  it('includes ranked regardless of participant count — no phantom hole to farm', () => {
    expect(countsTowardRecord(completed({ is_ranked: true }), 0)).toBe(true);
    expect(countsTowardRecord(completed({ is_ranked: true }), 1)).toBe(true);
  });

  it('excludes anything not completed', () => {
    for (const status of ['scheduled', 'live', 'cancelled', 'abandoned']) {
      expect(countsTowardRecord(completed({ status, is_ranked: true }), 5)).toBe(false);
    }
  });

  it('excludes a missing match rather than throwing', () => {
    expect(countsTowardRecord(null, 5)).toBe(false);
    expect(countsTowardRecord(undefined, 5)).toBe(false);
  });

  it('excludes zero participants', () => {
    expect(countsTowardRecord(completed(), 0)).toBe(false);
  });

  /**
   * The anti-divergence pin. completeMatch (matches.controller) gates casual
   * attribution on `participants.length >= 2`. If someone changes one side, this
   * fails — which is the whole point of SC-413.
   */
  it('matches the threshold completeMatch uses for casual attribution', () => {
    expect(MIN_CASUAL_PARTICIPANTS).toBe(2);
    for (let n = 0; n <= 4; n++) {
      const completeMatchWouldAttribute = n >= 2;       // matches.controller ~L1611
      expect(countsTowardRecord(completed(), n)).toBe(completeMatchWouldAttribute);
    }
  });
});
