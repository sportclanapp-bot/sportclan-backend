/**
 * N-R7-S13 (Step 2, Batch 5, SP-TEN-016): a tennis pro set to 8 is given 90 × 8 / 14.4 = 50 minutes —
 * the slot came out 55, because 2.4 × 6 in floating point is 14.399999999999999 and 50.000000001
 * rounded up to the next 5. Slots round up to 5 minutes from the value as written.
 */
import { slotMinutes } from '../utils/matchRules';

test('tennis slots: best of 3 90, pro set to 8 50, Fast4 50, timed 60 → 70', () => {
  expect(slotMinutes('tennis', {})).toBe(90);
  expect(slotMinutes('tennis', { bestOf: 1, gamesPerSet: 8 })).toBe(50);
  expect(slotMinutes('tennis', { gamesPerSet: 4, tiebreakAt: 3, matchTiebreak: true, adScoring: 'noad' })).toBe(50);
  expect(slotMinutes('tennis', { timeLimitMinutes: 60 })).toBe(70);
});
