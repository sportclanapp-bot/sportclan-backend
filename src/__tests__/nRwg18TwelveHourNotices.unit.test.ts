/**
 * N-RWG1-8 (launch test plan): the match reminder and the "running late" notice
 * said the time as "21:00" (and a moved fixture as "Sat 15 Jul · 14:00"), while
 * the app says "9:00 pm" everywhere. The server's notices use the house format.
 */
import { formatTimeIst, formatSlotIst } from '../utils/scheduleFixtures';
import { matchReminderBody } from '../utils/matchReminder';

test('the time in a notice is 12-hour with lowercase am/pm, in India time', () => {
  expect(formatTimeIst('2026-10-14T15:30:00Z')).toBe('9:00 pm');
  expect(formatTimeIst('2026-10-14T06:30:00Z')).toBe('12:00 pm');
  expect(formatTimeIst('2026-10-14T18:30:00Z')).toBe('12:00 am');
  expect(formatTimeIst('2026-10-14T04:05:00Z')).toBe('9:35 am');
  expect(formatTimeIst('bad')).toBeNull();
});

test('a moved fixture and a reminder read the same way', () => {
  expect(formatSlotIst('2026-07-15T08:30:00Z', 'Ground 2')).toBe('Wed 15 Jul · 2:00 pm · Ground 2');
  const at = '2026-10-14T15:30:00Z';
  expect(matchReminderBody('Lions vs Tigers', at, new Date(Date.parse(at) - 15 * 60_000), formatTimeIst(at)))
    .toBe('⏰ Lions vs Tigers starts at 9:00 pm in 15 minutes!');
});
