/**
 * N-R7-S123 (Step 2 Batch 9, SPP1-CRM-105): an over-age (or under-age) entrant's
 * refusal names the start date in day-month-year, as the born-on-or-after
 * refusal names its dates. It read '… is 31 on the start date.' with no date.
 */
import { categoryProblem } from '../utils/tournamentSettings';

const P = (name: string, dob: string) => ({ name, gender: 'male', dob, rating: null });

test('the under-N refusal names the start date', () => {
  expect(categoryProblem({ underAge: 14 }, [P('P3 S2B9 P15', '1995-01-01')], new Date('2026-11-14')))
    .toBe('This is an under-14 event, and P3 S2B9 P15 is 31 on the start date (14 Nov 2026).');
});

test('the N-and-over refusal names the start date', () => {
  expect(categoryProblem({ minAge: 45 }, [P('Ravi', '1990-03-05')], new Date('2026-12-01T00:00:00Z')))
    .toBe('This event is for 45 and over, and Ravi is 36 on the start date (1 Dec 2026).');
});

test('by birth year it still names the year, not a date', () => {
  expect(categoryProblem({ underAge: 15, ageBasis: 'year' }, [P('Asha', '2011-12-31')], new Date('2026-01-10')))
    .toBe('This is an under-15 event by birth year (born 2012 or later), and Asha turns 15 in 2026.');
});
