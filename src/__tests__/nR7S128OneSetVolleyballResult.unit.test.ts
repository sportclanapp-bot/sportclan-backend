/**
 * N-R7-S128 (Step 2 B10, SIDE-C5-ONESET, from SP-VBL-096): a best-of-1 volleyball match's headline
 * is the set (14 – 12), but the stored sentence said 'Lions won 1–0' (result screen 'won 1–0', Match
 * detail 'Lions won 1–0'). A one-set volleyball match now reads by its set: 'Lions won 14–12'.
 * Matches of more sets, and every other sport, keep their sets-won sentence.
 */
import { deriveResultText } from '../utils/matchResult';

const r = (sport: string, a: number, b: number, sets?: { A: number[]; B: number[] }) =>
  deriveResultText({ sport, teamAName: 'Lions', teamBName: 'Tigers', aScore: a, bScore: b, setScores: sets ?? null }).text;

test('a one-set volleyball match gives the set', () => {
  expect(r('volleyball', 1, 0, { A: [14], B: [12] })).toBe('Lions won 14–12');
  expect(r('volleyball', 0, 1, { A: [20], B: [22] })).toBe('Tigers won 22–20');
});

test('more sets, no set scores, or another sport: sets won as before', () => {
  expect(r('volleyball', 3, 1, { A: [25, 21, 25, 25], B: [21, 25, 19, 22] })).toBe('Lions won 3–1');
  expect(r('volleyball', 1, 0)).toBe('Lions won 1–0');
  expect(r('badminton', 1, 0, { A: [21], B: [15] })).toBe('Lions won 1–0');
  expect(r('pickleball', 1, 0, { A: [11, 6], B: [8, 6] })).toBe('Lions won 1–0');
});
