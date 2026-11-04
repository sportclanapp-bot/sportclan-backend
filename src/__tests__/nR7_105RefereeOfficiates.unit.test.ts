/**
 * N-R7-105 (Step 2 Batch 6, SPP1-TTN-157): a tournament's referee (and chief /
 * deputy referee) may default a player (canDefault), but couldn't open the pad
 * at all — canOfficiateMatch let in the umpire, the scorer and the organiser
 * only — so the 4th misconduct's "call the umpire, the referee or the
 * organiser" had no one to answer it but those. A referee now officiates the
 * tournament's fixtures like its scorer (score, toss, line-ups, complete); voiding stays
 * with the organiser / umpire ({ scorers: false }).
 */
let mockRoles: string[] = [];
jest.mock('../utils/supabase', () => {
  const from = (table: string) => {
    let roleFilter: string[] | null = null;
    const chain: any = {};
    for (const m of ['select', 'eq', 'limit', 'maybeSingle']) chain[m] = jest.fn(() => chain);
    chain.in = jest.fn((col: string, vals: string[]) => { if (col === 'role') roleFilter = vals; return chain; });
    chain.then = (ok: (v: unknown) => unknown) => {
      if (table === 'tournaments') return Promise.resolve(ok({ data: { created_by: 'org', parent_id: null }, error: null }));
      if (table === 'tournament_organisers') return Promise.resolve(ok({ data: [], error: null }));
      if (table === 'tournament_officials') {
        const hit = mockRoles.some((r) => !roleFilter || roleFilter.includes(r));
        return Promise.resolve(ok({ data: hit ? [{ id: 'o1' }] : [], error: null }));
      }
      return Promise.resolve(ok({ data: null, error: null }));
    };
    return chain;
  };
  return { supabase: { from: jest.fn(from) } };
});
jest.mock('../utils/tournamentEvents', () => ({ ...jest.requireActual('../utils/tournamentEvents'), familyLookupIds: jest.fn(async (id: string) => [id]) }));
jest.mock('../middleware/admin.middleware', () => ({ isAdminUser: jest.fn(async () => false) }));

// eslint-disable-next-line import/first
import { canOfficiateMatch, canDefault } from '../utils/tournamentAuth';

const M = { tournament_id: 't1', created_by: 'org', umpire_id: 'ump', scorer_id: null };

describe('N-R7-105: the tournament referee officiates its fixtures', () => {
  test.each(['referee', 'chief_referee', 'deputy_referee'])('%s: may officiate (open the pad) and default', async (role) => {
    mockRoles = [role];
    expect(await canOfficiateMatch(M, 'ref')).toBe(true);
    expect(await canDefault(M, 'ref')).toBe(true);
  });
  test('a referee still can’t void (scorers: false keeps it to the organiser and the umpire)', async () => {
    mockRoles = ['referee'];
    expect(await canOfficiateMatch(M, 'ref', { scorers: false })).toBe(false);
  });
  test('a commentator or an assistant still can’t officiate', async () => {
    mockRoles = ['commentator', 'assistant'];
    expect(await canOfficiateMatch(M, 'x')).toBe(false);
  });
});
