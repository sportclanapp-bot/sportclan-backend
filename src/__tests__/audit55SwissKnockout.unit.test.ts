/** Audit #55 (11 Oct 2026): the knockout after a Swiss wasn't treated as a knockout (a level result went through; no shoot-out / super over / tie-break). */
import { fakeDb } from './helpers/fakeSupabase';

let db = fakeDb();
jest.mock('../utils/supabase', () => ({ get supabase() { return db.client; } }));
// eslint-disable-next-line import/first
import { isKnockoutBracketMatch } from '../utils/knockout';

describe('audit #55', () => {
  beforeEach(() => {
    db = fakeDb({
      tournaments: [{ id: 'sw', format: 'swiss' }, { id: 'ko', format: 'knockout' }, { id: 'lg', format: 'league' }],
      matches: [{ id: 'swko', bracket: 'ko' }, { id: 'swr', bracket: null }],
    });
  });
  it('a Swiss’s knockout match is a bracket match; a Swiss round is not', async () => {
    expect(await isKnockoutBracketMatch({ id: 'swko', tournament_id: 'sw', round: 1, group_label: null })).toBe(true);
    expect(await isKnockoutBracketMatch({ id: 'swko', tournament_id: 'sw', round: 1, group_label: null, bracket: 'ko' })).toBe(true);
    expect(await isKnockoutBracketMatch({ id: 'swr', tournament_id: 'sw', round: 2, group_label: null })).toBe(false);
  });
  it('unchanged for knockout and league', async () => {
    expect(await isKnockoutBracketMatch({ tournament_id: 'ko', round: 1, group_label: null })).toBe(true);
    expect(await isKnockoutBracketMatch({ tournament_id: 'lg', round: 1, group_label: null })).toBe(false);
  });
});
