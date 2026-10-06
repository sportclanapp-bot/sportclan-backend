/**
 * Badminton 7.11 (Oct 2026) · BAI's birth-year cut-off: an age limit can count
 * the age a player turns in the tournament's year (on 31 Dec) instead of the
 * age on the start date. U-15 in 2026 = born in 2012 or later.
 */
import { categoryProblem, categoryRefusal, storedCategory, categoryLabel, ageInYear } from '../utils/tournamentSettings';

const ON = new Date('2026-03-10T00:00:00Z');
const kid = (dob: string) => [{ name: 'Aarav', gender: 'male', dob }];

test('under 15 by birth year: born 2012 plays all year; born 2011 doesn’t, even before their birthday', () => {
  const byYear = { underAge: 15, ageBasis: 'year' as const };
  expect(categoryProblem(byYear, kid('2012-12-31'), ON)).toBeNull();
  expect(categoryProblem(byYear, kid('2011-12-31'), ON)).toBe('This is an under-15 event by birth year (born 2012 or later), and Aarav turns 15 in 2026.');
  // on the start date the 2011 child is still 14 — and allowed, as before
  expect(categoryProblem({ underAge: 15 }, kid('2011-12-31'), ON)).toBeNull();
});

test('veterans by birth year: 40+ in 2026 = born 1986 or earlier', () => {
  const v = { minAge: 40, ageBasis: 'year' as const };
  expect(categoryProblem(v, [{ name: 'Kiran', gender: 'male', dob: '1986-12-31' }], ON)).toBeNull();
  expect(categoryProblem(v, [{ name: 'Kiran', gender: 'male', dob: '1987-01-01' }], ON)).toBe('This event is for 40 and over by birth year (born 1986 or earlier), and Kiran turns 39 in 2026.');
});

test('checked, stored only with an age limit, and named', () => {
  expect(categoryRefusal({ underAge: 15, ageBasis: 'year' })).toBeNull();
  expect(categoryRefusal({ underAge: 15, ageBasis: 'month' })!.error).toBe('Ages are on the start date, or by birth year.');
  expect(storedCategory({ underAge: 15, ageBasis: 'year' })).toEqual({ underAge: 15, ageBasis: 'year' });
  expect(storedCategory({ gender: 'men', ageBasis: 'year' })).toEqual({ gender: 'men' });
  expect(categoryLabel({ gender: 'men', underAge: 15, ageBasis: 'year' })).toBe('Men’s · Under 15 (by birth year)');
  expect(ageInYear('2012-06-01', ON)).toBe(14);
});
