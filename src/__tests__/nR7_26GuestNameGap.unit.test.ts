/** N-R7-26 (Step 2, Batch 2) · a guest name pasted with a tab or a newline between words is one space, not glued together. */
jest.mock('../utils/supabase', () => ({ supabase: {} }));
// eslint-disable-next-line import/first
import { sanitizePlayerName } from '../controllers/scoring.controller';

test('control characters become a space and spaces collapse', () => {
  expect(sanitizePlayerName('Ravi\tKumar\n   ')).toBe('Ravi Kumar');
  expect(sanitizePlayerName('  Ravi \u0007 Kumar  ')).toBe('Ravi Kumar');
});
test('cut to 40 and an all-space name is dropped', () => {
  expect(sanitizePlayerName('L'.repeat(60))).toBe('L'.repeat(40));
  expect(sanitizePlayerName('     ')).toBeUndefined();
});
