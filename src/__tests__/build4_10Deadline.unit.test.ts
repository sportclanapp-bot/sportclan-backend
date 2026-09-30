/**
 * BUILD 4.10 · the registration deadline: the app now sets it on create and
 * edit; the server keeps enforcing it for captains' entries (entryRefusal) and
 * now refuses one after the day the tournament starts — only when an edit moves
 * the deadline or the start, so an older tournament's other edits go through.
 */
import { tournamentDetailsRefusal } from '../utils/tournamentRules';

test('a deadline by the start day is fine; after it → DEADLINE_AFTER_START', () => {
  expect(tournamentDetailsRefusal({ start_date: '2026-10-10T00:00:00Z', registration_deadline: '2026-10-09T12:00:00Z' })).toBeNull();
  expect(tournamentDetailsRefusal({ start_date: '2026-10-10T00:00:00Z', registration_deadline: '2026-10-10T18:00:00Z' })).toBeNull();
  expect(tournamentDetailsRefusal({ start_date: '2026-10-10T00:00:00Z', registration_deadline: '2026-10-12T00:00:00Z' }))
    .toEqual({ error: 'Entries have to close by the day the tournament starts.', code: 'DEADLINE_AFTER_START' });
});
test('an edit moving the start before a stored deadline is refused', () => {
  expect(tournamentDetailsRefusal({ start_date: '2026-10-01T00:00:00Z' }, { start_date: '2026-10-10T00:00:00Z', registration_deadline: '2026-10-08T00:00:00Z' })?.code).toBe('DEADLINE_AFTER_START');
});
test('an unrelated edit to an older tournament with a late deadline goes through', () => {
  expect(tournamentDetailsRefusal({ name: 'P3 renamed' }, { start_date: '2026-10-01T00:00:00Z', registration_deadline: '2026-10-20T00:00:00Z' })).toBeNull();
});
