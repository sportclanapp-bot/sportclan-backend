/**
 * N-R7-S141 (Step 2 B12, SCR-M-F05): a hockey ground day, offline, 1–1 then Tigers win the
 * shoot-out 3–0. The carrier's 2-code hand-off (12 events + the result) was refused 409
 * RESULT_DISPUTED, derived_side 'draw': the result check read only the summary's goals, never
 * the kicks. A shoot-out (hockey) / penalties (football) now settles a level game for its
 * winner; kicks before a back-out (shootout_cancel) don't count.
 */
let mockNotes: Array<{ event_type: string; payload: Record<string, unknown> }> = [];
jest.mock('../utils/matchEventsAll', () => ({ matchEventsAll: jest.fn(async () => mockNotes) }));
jest.mock('../utils/supabase', () => ({ supabase: { from: jest.fn() } }));
jest.mock('../utils/notify', () => ({ notifyUsers: jest.fn(async () => undefined) }));

// eslint-disable-next-line import/first
import { resultWouldContradictPlay, checkResultAgainstPlay, withShootout } from '../utils/resultCheck';
// eslint-disable-next-line import/first
import { shootoutSideOf } from '../utils/discrepancy';

const A = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const B = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
const level = { A: { goals: 1, score: 1 }, B: { goals: 1, score: 1 } };
const kick = (side: 'A' | 'B', scored: boolean) => ({ event_type: 'note', payload: { kind: 'shootout_kick', team_side: side, scored } });
const note = (kind: string) => ({ event_type: 'note', payload: { kind } });

test('1–1 + a 3–0 shoot-out to A: A winning agrees with the play (was RESULT_DISPUTED, derived draw)', () => {
  const v = resultWouldContradictPlay({ teamAId: A, teamBId: B, claimedWinnerTeamId: A, currentSummary: level, eventCount: 12, shootoutSide: 'A' });
  expect([v.disagrees, v.derivedSide]).toEqual([false, 'A']);
});
test('the shoot-out loser named as winner still disagrees', () => {
  const v = resultWouldContradictPlay({ teamAId: A, teamBId: B, claimedWinnerTeamId: B, currentSummary: level, eventCount: 12, shootoutSide: 'A' });
  expect([v.disagrees, v.derivedSide]).toEqual([true, 'A']);
});
test('after completion too: a level game won on the shoot-out is not a discrepancy', () => {
  const v = checkResultAgainstPlay({ matchStatus: 'completed', isTerminal: (s) => s === 'completed', teamAId: A, teamBId: B, recordedWinnerTeamId: A, hasRecordedResult: true, derivedSummary: level, eventCount: 12, shootoutSide: 'A' });
  expect(v.disagrees).toBe(false);
});
test('a shoot-out never overrides goals that are not level', () => {
  expect(withShootout('B', 'A')).toBe('B');
  expect(withShootout('draw', null)).toBe('draw');
});

describe('shootoutSideOf · the kicks on the server', () => {
  test('hockey / football kicks: 3–0 to A', async () => {
    mockNotes = [note('shootout_start'), kick('A', true), kick('B', false), kick('A', true), kick('B', false), kick('A', true), kick('B', false)];
    expect(await shootoutSideOf('m')).toBe('A');
  });
  test('kicks before a back-out do not count', async () => {
    mockNotes = [note('shootout_start'), kick('A', true), note('shootout_cancel')];
    expect(await shootoutSideOf('m')).toBeNull();
  });
  test('a typed tally counts; else the result’s own shoot-out', async () => {
    mockNotes = [{ event_type: 'note', payload: { kind: 'shootout', A: 2, B: 4 } }];
    expect(await shootoutSideOf('m')).toBe('B');
    mockNotes = [];
    expect(await shootoutSideOf('m', { shootout: { A: 5, B: 4 } })).toBe('A');
    expect(await shootoutSideOf('m', null)).toBeNull();
  });
});
