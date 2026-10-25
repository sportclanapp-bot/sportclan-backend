/**
 * N-R7-S75 (Step 2 · Batch 4, SP-BDM-057) · a mixed doubles pair where one profile lists no gender:
 * the refusal was the general 'A mixed event needs at least one man and one woman in the pair.',
 * never saying what to fix. It now names the player whose profile lacks a gender, as the men's and
 * women's events do; a pair of two men (or two women) keeps the general words.
 */
import { categoryProblem } from '../utils/tournamentSettings';

const on = new Date('2026-11-01T00:00:00Z');
const P = (name: string, gender: string | null) => ({ user_id: name, name, gender, dob: null, rating: null }) as any;
test('a profile with no gender is named', () => {
  expect(categoryProblem({ gender: 'mixed' }, [P('Anita', 'female'), P('Fresh', null)], on)).toBe('Fresh’s profile doesn’t list their gender, and this is a mixed event (one man and one woman). Add it to the profile first.');
});
test('two of one gender: the general words; a man and a woman: fine', () => {
  expect(categoryProblem({ gender: 'mixed' }, [P('Anita', 'female'), P('Bela', 'female')], on)).toBe('A mixed event needs at least one man and one woman on the team.');
  expect(categoryProblem({ gender: 'mixed' }, [P('Anita', 'female'), P('Ravi', 'male')], on)).toBeNull();
  expect(categoryProblem({ gender: 'mixed' }, [P('Anita', 'female'), P('Ravi', 'male'), P('Fresh', null)], on)).toBeNull();
});
