/**
 * Stage 9 · T12 · a doubles pair's combined age ("90+"), and amateurs only —
 * any doubles or pair sport (tennis, badminton, table tennis, pickleball).
 */
import { categoryRefusal, categoryProblem, categoryLabel, storedCategory, amateurDeclarationRefusal } from '../utils/tournamentSettings';

const on = new Date('2026-11-28');
const p = (name: string, dob: string | null) => ({ name, dob, gender: 'male' });

test('a pair’s combined age: on the start date, or by birth year', () => {
  const c = { pairAgeMin: 90 };
  expect(categoryProblem(c, [p('Ravi', '1975-01-10'), p('Amit', '1980-05-01')], on)).toBeNull(); // 51 + 46 = 97
  expect(categoryProblem(c, [p('Ravi', '1985-12-31'), p('Amit', '1990-12-01')], on)).toBe('This event is for pairs 90+ combined, and Ravi and Amit add up to 75.');
  expect(categoryProblem({ pairAgeMin: 76, ageBasis: 'year' }, [p('Ravi', '1985-12-31'), p('Amit', '1990-12-01')], on)).toBeNull(); // 41 + 36 by year
  expect(categoryProblem(c, [p('Ravi', null), p('Amit', '1980-05-01')], on)).toMatch(/Ravi’s profile doesn’t list their date of birth/);
  expect(categoryProblem(c, [p('Ravi', '2000-01-01')], on)).toBeNull(); // singles: not a pair
});

test('stored, labelled, refused', () => {
  expect(categoryRefusal({ pairAgeMin: 30 })?.error).toBe('A pair’s combined age is 40 to 200.');
  expect(categoryRefusal({ amateurOnly: 'yes' })?.error).toBe('Amateurs only is on or off.');
  expect(storedCategory({ pairAgeMin: 110, amateurOnly: true, ageBasis: 'year' })).toEqual({ pairAgeMin: 110, amateurOnly: true, ageBasis: 'year' });
  expect(storedCategory({ amateurOnly: false })).toBeNull();
  expect(categoryLabel({ gender: 'men', pairAgeMin: 100, amateurOnly: true })).toBe('Men’s · Pairs 100+ combined · Amateurs only');
});

test('amateurs only: the entry needs the declaration', () => {
  expect(amateurDeclarationRefusal({ amateurOnly: true }, undefined)?.code).toBe('DECLARATION');
  expect(amateurDeclarationRefusal({ amateurOnly: true }, true)).toBeNull();
  expect(amateurDeclarationRefusal({ gender: 'men' }, undefined)).toBeNull();
  expect(amateurDeclarationRefusal(null, undefined)).toBeNull();
});
