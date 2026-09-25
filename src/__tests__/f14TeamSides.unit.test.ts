/**
 * F-14 · an open pickup needs no team names (blank → "Team A" / "Team B",
 * decision 2026-09-25). F-20 · a typed-in side needs a name and two can't share
 * one — only the form checked. F-19 · names trimmed and capped at 60; a bad
 * city id was a 500.
 */
jest.mock('../utils/supabase', () => ({ supabase: { from: () => ({}) } }));
import { createFieldRefusal, teamSidesFor } from '../controllers/matches.controller';

const code = (r: ReturnType<typeof teamSidesFor>) => ('code' in r ? r.code : null);

describe('teamSidesFor', () => {
  test('F-14: an open pickup with blank names is Team A v Team B', () => {
    expect(teamSidesFor({ isOpen: true })).toEqual({ a: 'Team A', b: 'Team B' });
    expect(teamSidesFor({ isOpen: true, teamAName: '  Sunday Crew ' })).toEqual({ a: 'Sunday Crew', b: 'Team B' });
  });
  test('F-14: an open pickup with a registered side keeps it', () => {
    expect(teamSidesFor({ isOpen: true, teamAId: 't1' })).toEqual({ a: null, b: 'Team B' });
  });
  test('F-20: a closed typed-in match needs both names', () => {
    expect(code(teamSidesFor({ isOpen: false, teamAName: 'Lions' }))).toBe('TEAM_NAME_REQUIRED');
    expect(code(teamSidesFor({ isOpen: false, teamAName: '   ', teamBName: 'Tigers' }))).toBe('TEAM_NAME_REQUIRED');
    expect(teamSidesFor({ isOpen: false, teamAId: 't1', teamBName: 'Tigers' })).toEqual({ a: null, b: 'Tigers' });
    expect(teamSidesFor({ isOpen: false, teamAId: 't1', teamBId: 't2' })).toEqual({ a: null, b: null });
  });
  test('F-20: two typed-in sides cannot share a name (any case, any spacing)', () => {
    expect(code(teamSidesFor({ isOpen: false, teamAName: 'Lions', teamBName: ' lions ' }))).toBe('SAME_TEAM_NAME');
    expect(code(teamSidesFor({ isOpen: true, teamAName: 'Team B' }))).toBe('SAME_TEAM_NAME');
  });
  test('F-19: names are trimmed and capped at 60', () => {
    expect(teamSidesFor({ isOpen: false, teamAName: ' A ', teamBName: 'B' })).toEqual({ a: 'A', b: 'B' });
    expect(code(teamSidesFor({ isOpen: false, teamAName: 'x'.repeat(61), teamBName: 'B' }))).toBe('TEAM_NAME_TOO_LONG');
    expect(teamSidesFor({ isOpen: false, teamAName: 'x'.repeat(60), teamBName: 'B' })).toEqual({ a: 'x'.repeat(60), b: 'B' });
  });
  test('a non-string name counts as blank', () => {
    expect(teamSidesFor({ isOpen: true, teamAName: 42 })).toEqual({ a: 'Team A', b: 'Team B' });
  });
});

describe('createFieldRefusal · city_id (F-19)', () => {
  test('absent, empty or a uuid pass', () => {
    expect(createFieldRefusal({})).toBeNull();
    expect(createFieldRefusal({ city_id: '' })).toBeNull();
    expect(createFieldRefusal({ city_id: '7254e4fb-3b5c-4e58-a1c1-341cf4c18df2' })).toBeNull();
  });
  test.each([['pune'], [12], ['7254e4fb']])('%p is refused', (v) => {
    expect(createFieldRefusal({ city_id: v })?.code).toBe('BAD_CITY');
  });
});
