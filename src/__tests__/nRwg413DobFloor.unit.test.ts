/**
 * N-RWG4-13 (launch test plan, Round 1) · the date-of-birth picker's earliest date (120
 * calendar years before today) was refused 'Please enter a valid date of birth' for most of
 * the day: the server measured 120 × 365.25 days from this instant. It now compares dates.
 */
import { dobProblem } from '../utils/profileRules';

afterEach(() => jest.useRealTimers());
const at = (iso: string) => { jest.useFakeTimers(); jest.setSystemTime(new Date(iso)); };

it.each(['2026-10-13T21:30:00Z', '2026-10-14T00:30:00Z', '2026-10-14T04:30:00Z', '2026-10-14T15:30:00Z'])(
  'the picker’s earliest date (14 Oct 1906) is accepted all day on 14 Oct 2026 IST (%s)', (now) => {
    at(now);
    expect(dobProblem('1906-10-14')).toBeNull();
  },
);
it('a day earlier than that is still refused (older than 120)', () => {
  at('2026-10-14T04:30:00Z');
  expect(dobProblem('1906-10-12')).toBe('Please enter a valid date of birth');
});
it('today and the future keep their rules', () => {
  at('2026-10-14T04:30:00Z');
  expect(dobProblem('2026-10-14')).toBeNull();
  expect(dobProblem('2026-10-16')).toBe('Date of birth can’t be in the future');
});
