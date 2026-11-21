/**
 * Q44 (Dipak, 21 Nov 2026), X1-129: on a phone set to another time zone the app
 * shows match times as "7:00 pm IST", but the match reminder said "starts at
 * 8:53 am" with no zone. The reminder now says "IST" too, so every time reads
 * the same way (the push and the in-app Notifications row both use this text).
 */
import { matchReminderBody } from '../utils/matchReminder';
import { formatTimeIst } from '../utils/scheduleFixtures';

const at = '2026-10-21T03:23:00Z'; // 8:53 am IST
test('the reminder names the time zone', () => {
  expect(matchReminderBody('Lions vs Tigers', at, new Date(Date.parse(at) - 8 * 60_000), formatTimeIst(at)))
    .toBe('⏰ Lions vs Tigers starts at 8:53 am IST in 8 minutes!');
});
test('a catch-up reminder too', () => {
  expect(matchReminderBody(null, at, new Date(Date.parse(at) + 60_000), formatTimeIst(at)))
    .toBe('⏰ Your match was due to start at 8:53 am IST and hasn’t started yet.');
});
test('no time known: no label', () => {
  expect(matchReminderBody(null, at, new Date(Date.parse(at) - 5 * 60_000), null)).toBe('⏰ Your match starts in 5 minutes!');
});
