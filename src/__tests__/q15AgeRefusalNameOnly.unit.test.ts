/**
 * Q15 (Dipak, 21 Nov 2026, N-R3B-1, launch blocker) · an age-limit refusal shows the organiser the
 * player's name only — never their birth date (it may be private), nor their age, which gives the
 * year away. Before: '…and P3 FMT Player 09 was born on 1 Jan 1995.' for a private birth date.
 */
import { categoryProblem } from '../utils/tournamentSettings';

const ON = new Date('2026-11-14T00:00:00Z');
const DOB = '1995-03-07';
const leaks = (s: string | null) => !!s && /1995|Mar|was born|turns|add up to|\bis 3\d\b/.test(s); // DOB 7 Mar 1995: 31 on the start date
const P = [{ name: 'P3 FMT Player 09', gender: 'male', dob: DOB }];

it.each([
  [{ bornFrom: '2010-01-01' }, 'This event is for players born on or after 1 Jan 2010, and P3 FMT Player 09 is over the age limit.'],
  [{ bornTo: '1980-12-31' }, 'This event is for players born on or before 31 Dec 1980, and P3 FMT Player 09 is under the age limit.'],
  [{ underAge: 19 }, 'This is an under-19 event (age on the start date, 14 Nov 2026), and P3 FMT Player 09 is over the age limit.'],
  [{ underAge: 19, ageBasis: 'year' }, 'This is an under-19 event by birth year (born 2008 or later), and P3 FMT Player 09 is over the age limit.'],
  [{ minAge: 40 }, 'This event is for 40 and over (age on the start date, 14 Nov 2026), and P3 FMT Player 09 is under the age limit.'],
  [{ minAge: 40, ageBasis: 'year' }, 'This event is for 40 and over by birth year (born 1986 or earlier), and P3 FMT Player 09 is under the age limit.'],
])('%j → the name and the event’s limit, no birth date or age', (c, want) => {
  const r = categoryProblem(c as any, P, ON);
  expect(r).toBe(want);
  expect(leaks(r)).toBe(false);
});

it('a pair under a combined-age limit: names only, no ages or sum', () => {
  const r = categoryProblem({ pairAgeMin: 90 } as any, [{ name: 'Ravi', dob: '1990-02-01' }, { name: 'Amit', dob: '1995-03-07' }], ON);
  expect(r).toBe('This event is for pairs 90+ combined, and Ravi and Amit are under it together.');
  expect(r).not.toMatch(/\d{2}\.$|\b(36|31|67)\b/);
});

it('a player who fits is still let in (the check itself is unchanged)', () => {
  expect(categoryProblem({ bornFrom: '1990-01-01' } as any, P, ON)).toBeNull();
  expect(categoryProblem({ underAge: 40 } as any, P, ON)).toBeNull();
});
