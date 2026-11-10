/**
 * N-R7-S130 (Step 2 Batch 12, SP-HOC-170): a fixture's reserve umpire (named on the officials
 * sheet: hockey / badminton) couldn't open the pad or take over scoring — canOfficiateMatch let
 * in the umpire, the scorer and the organiser only (403 'Only the scorer, umpire or organiser can
 * take over.'). The reserve umpire now officiates like the scorer; voiding stays with the
 * organiser / umpire; the other assistant seats (second umpire, judge, technical officer) don't.
 */
let mockSeats: Array<{ match_id: string; user_id: string; role: string; removed_at: string | null }> = [];
jest.mock('../utils/supabase', () => {
  const from = (table: string) => {
    const f: Record<string, unknown> = {}; let isNull: string | null = null;
    const chain: any = {};
    for (const m of ['select', 'limit', 'maybeSingle', 'in']) chain[m] = jest.fn(() => chain);
    chain.eq = jest.fn((c: string, v: unknown) => { f[c] = v; return chain; });
    chain.is = jest.fn((c: string) => { isNull = c; return chain; });
    chain.then = (ok: (v: unknown) => unknown) => {
      if (table === 'tournaments') return Promise.resolve(ok({ data: { created_by: 'org', parent_id: null }, error: null }));
      if (table === 'match_officials') {
        const rows = mockSeats.filter((r) => Object.entries(f).every(([k, v]) => (r as any)[k] === v) && (isNull !== 'removed_at' || r.removed_at === null));
        return Promise.resolve(ok({ data: rows.map(() => ({ id: 's1' })), error: null }));
      }
      return Promise.resolve(ok({ data: [], error: null }));
    };
    return chain;
  };
  return { supabase: { from: jest.fn(from) } };
});
jest.mock('../utils/tournamentEvents', () => ({ ...jest.requireActual('../utils/tournamentEvents'), familyLookupIds: jest.fn(async (id: string) => [id]) }));
jest.mock('../middleware/admin.middleware', () => ({ isAdminUser: jest.fn(async () => false) }));

// eslint-disable-next-line import/first
import { canOfficiateMatch } from '../utils/tournamentAuth';

const T = { id: 'm1', tournament_id: 't1', created_by: 'org', umpire_id: 'ump', scorer_id: null };
const C = { id: 'm2', tournament_id: null, created_by: 'host', umpire_id: null, scorer_id: null };

describe('N-R7-S130: the reserve umpire officiates the fixture', () => {
  beforeEach(() => { mockSeats = []; });
  test('a tournament fixture’s reserve umpire may officiate (open the pad, take over)', async () => {
    mockSeats = [{ match_id: 'm1', user_id: 'res', role: 'reserve_umpire', removed_at: null }];
    expect(await canOfficiateMatch(T, 'res')).toBe(true);
  });
  test('a casual match’s reserve umpire too', async () => {
    mockSeats = [{ match_id: 'm2', user_id: 'res', role: 'reserve_umpire', removed_at: null }];
    expect(await canOfficiateMatch(C, 'res')).toBe(true);
  });
  test('not for voiding (scorers: false)', async () => {
    mockSeats = [{ match_id: 'm1', user_id: 'res', role: 'reserve_umpire', removed_at: null }];
    expect(await canOfficiateMatch(T, 'res', { scorers: false })).toBe(false);
  });
  test('a removed reserve umpire, another match’s, or another assistant seat can’t', async () => {
    mockSeats = [
      { match_id: 'm1', user_id: 'res', role: 'reserve_umpire', removed_at: '2026-11-10T00:00:00Z' },
      { match_id: 'm9', user_id: 'res2', role: 'reserve_umpire', removed_at: null },
      { match_id: 'm1', user_id: 'jdg', role: 'judge', removed_at: null },
      { match_id: 'm1', user_id: 'u2', role: 'umpire_2', removed_at: null },
    ];
    for (const u of ['res', 'res2', 'jdg', 'u2']) expect(await canOfficiateMatch(T, u)).toBe(false);
  });
  test('the umpire, organiser and casual host are unchanged', async () => {
    expect(await canOfficiateMatch(T, 'ump')).toBe(true);
    expect(await canOfficiateMatch(T, 'org')).toBe(true);
    expect(await canOfficiateMatch(C, 'host')).toBe(true);
    expect(await canOfficiateMatch(C, 'x')).toBe(false);
  });
});
