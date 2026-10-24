/**
 * N-R7-S15 (Step 2, Batch 6, SPP1-TTN-138): a match went LIVE on its warm-up note, or on a
 * warning given before the first point, so spectators saw 'LIVE · 0 · 0' through the warm-up
 * (the V-3 case, which held back only a serve swap). Pre-play notes — the warm-up, a
 * misconduct, a receiver swap — don't start play; the first point (or any other event) does.
 */
import { startsPlayEvent } from '../controllers/scoring.controller';

test('pre-play events leave a scheduled match scheduled', () => {
  expect(startsPlayEvent('serve_swap', { kind: 'serve_swap' })).toBe(false);
  expect(startsPlayEvent('note', { kind: 'warmup' })).toBe(false);
  expect(startsPlayEvent('note', { kind: 'violation', team_side: 'A', penalty: 'warning', n: 1 })).toBe(false);
  expect(startsPlayEvent('note', { kind: 'receiver_swap', team_side: 'A' })).toBe(false);
});
test('play starts it: a point (a penalty point too), a kick-off, a ball', () => {
  expect(startsPlayEvent('score', { kind: 'point', team_side: 'A' })).toBe(true);
  expect(startsPlayEvent('score', { kind: 'penalty', team_side: 'B' })).toBe(true);
  expect(startsPlayEvent('note', { kind: 'kickoff' })).toBe(true);
  expect(startsPlayEvent('ball', { runs: 1 })).toBe(true);
});
