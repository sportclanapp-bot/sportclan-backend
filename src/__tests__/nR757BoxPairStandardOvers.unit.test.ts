/**
 * N-R7-57 (Step 2 · Batch 2 R5): a tournament made with CRICKET RULES Match type 'Box' (or 'Pair')
 * and the stage overs left 'Std' stored 20 overs, so every fixture read 'Box cricket · 20 overs'
 * instead of the format's standard (Box 6, Pair 8 — the same standard the New match form uses).
 */
import { normalizeRules } from '../utils/matchRules';

test('box and pair without overs take their standard overs', () => {
  expect(normalizeRules('cricket', { v: 1, style: 'box' }).overs).toBe(6);
  expect(normalizeRules('cricket', { v: 1, style: 'pair' }).overs).toBe(8);
  expect(normalizeRules('cricket', { v: 1, style: 'pair', overs: null }).overs).toBe(8);
});
test('given overs and limited overs are kept', () => {
  expect(normalizeRules('cricket', { v: 1, style: 'box', overs: 4 }).overs).toBe(4);
  expect(normalizeRules('cricket', { v: 1, style: 'limited' }).overs).toBe(20);
  expect(normalizeRules('cricket', { v: 1 }).overs).toBe(20);
});
