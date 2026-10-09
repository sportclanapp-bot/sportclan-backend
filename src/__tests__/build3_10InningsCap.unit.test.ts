/**
 * BUILD 3.10 · innings time cap: off, or 10–240 minutes. Display and warning
 * only — the server stores and checks the number, and scores as before.
 */
import { inningsClock, INNINGS_MINUTES_MIN, INNINGS_MINUTES_MAX } from '../utils/cricketRules';
import { rulesRefusal, standardRules, rulesOf } from '../utils/matchRules';

test('off, or whole 1 or more (Stage 13 · CR3: no top)', () => {
  const r = (inningsMinutes: unknown) => rulesRefusal('cricket', { ...standardRules('cricket'), inningsMinutes });
  expect([INNINGS_MINUTES_MIN, INNINGS_MINUTES_MAX]).toEqual([1, Number.MAX_SAFE_INTEGER]);
  expect(standardRules('cricket').inningsMinutes).toBeNull();
  expect(rulesOf('cricket', { format: 'T20', overs: 20 }).inningsMinutes).toBeNull();
  for (const ok of [null, 1, 9, 10, 45, 240, 241, 600]) expect(r(ok)).toBeNull();
  for (const bad of [0, -1, 30.5, '45']) expect(r(bad)?.error).toBe('An innings time cap must be off, or a whole number of minutes.');
});
test('the clock: from the side’s first delivery; warns 5 minutes out; over at the cap', () => {
  const t0 = Date.parse('2026-09-29T10:00:00Z');
  const ev = (side: string, min: number, event_type = 'ball') => ({ event_type, payload: { team_side: side }, created_at: new Date(t0 + min * 60000).toISOString() });
  const log = [ev('A', 0), ev('A', 20), ev('B', 50)];
  expect(inningsClock(log, 'A', null, t0 + 60 * 60000)).toBeNull();
  expect(inningsClock([], 'A', 45, t0)).toBeNull();
  expect(inningsClock(log, 'A', 45, t0 + 39 * 60000)).toEqual({ elapsed: 39, cap: 45, warn: false, over: false });
  expect(inningsClock(log, 'A', 45, t0 + 40 * 60000)).toMatchObject({ warn: true, over: false });
  expect(inningsClock(log, 'A', 45, t0 + 45 * 60000)).toMatchObject({ warn: true, over: true });
  expect(inningsClock(log, 'B', 45, t0 + 60 * 60000)).toMatchObject({ elapsed: 10, over: false });
  expect(inningsClock([{ event_type: 'toss', payload: { team_side: 'A' }, created_at: new Date(t0).toISOString() }], 'A', 45, t0)).toBeNull();
});
