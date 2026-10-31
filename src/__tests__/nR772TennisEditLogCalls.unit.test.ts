/**
 * N-R7-72 (Step 2 Batch 5, SP-TEN-127 / SP-TEN-C05): a tennis undo read 'Rahul point, 3–1 → 2–1' —
 * the raw point count, not the score the pad shows. Tennis lines now use the calls: '40–15 → 30–15'
 * (a tiebreak keeps its numbers; games are named when any were played).
 */
import { scoreText } from '../utils/editLog';
const ctx = { teamA: 'Rahul', teamB: 'Vikram' } as never;
const t = (a: object, b: object, extra: object = {}) => scoreText({ A: { sets: [], score: 0, games: 0, points: 0, ...a }, B: { sets: [], score: 0, games: 0, points: 0, ...b }, ...extra } as never, ctx);
test('points read as tennis calls', () => {
  expect(t({ points: 3 }, { points: 1 })).toBe('40–15');
  expect(t({ points: 2 }, { points: 1 })).toBe('30–15');
  expect(t({ points: 3 }, { points: 3 })).toBe('40–40');
  expect(t({ points: 4 }, { points: 3 })).toBe('Ad–40');
  expect(t({ points: 0 }, { points: 0 })).toBe('0–0');
});
test('games are named once played; a tiebreak keeps numbers', () => {
  expect(t({ games: 1, points: 1 }, { points: 0 })).toBe('games 1–0 · 15–0');
  expect(t({ games: 6, points: 5 }, { games: 6, points: 3 }, { tiebreak: true })).toBe('games 6–6 · 5–3');
});
