/**
 * BUILD 4.5 · best third places: with it on, the best next-placed teams across
 * the groups (compared per game played) fill the knockout's open places — as
 * its lowest seeds — instead of those places being byes. In-memory Supabase,
 * like formatsGroupsCrossPair.
 */
type Row = Record<string, any>;
const db: Record<string, Row[]> = { tournaments: [], matches: [], tournament_entries: [], sports: [] };
jest.mock('../utils/supabase', () => {
  const from = (table: string) => {
    const filters: Array<(r: Row) => boolean> = [];
    let patch: Row | null = null;
    let head = false;
    const run = () => {
      const rows = (db[table] ?? []).filter((r) => filters.every((f) => f(r)));
      if (patch) for (const r of rows) Object.assign(r, patch);
      return rows;
    };
    const q: any = {
      select: (_c?: string, o?: { head?: boolean }) => { head = !!o?.head; return q; },
      update: (p: Row) => { patch = p; return q; },
      eq: (c: string, v: unknown) => { filters.push((r) => r[c] === v); return q; },
      is: (c: string, v: null) => { filters.push((r) => (r[c] ?? null) === v); return q; },
      not: (c: string, _op: string, v: null) => { filters.push((r) => (r[c] ?? null) !== v); return q; },
      in: (c: string, v: unknown[]) => { filters.push((r) => v.includes(r[c])); return q; },
      order: () => q,
      range: () => q, // Oct 2026: reads page with .range() (selectAll)
      limit: () => q,
      maybeSingle: () => Promise.resolve({ data: run()[0] ?? null, error: null }),
      then: (resolve: (v: unknown) => unknown) => { const rows = run(); return resolve({ data: head ? null : rows, count: rows.length, error: null }); },
    };
    return q;
  };
  return { supabase: { from } };
});
jest.mock('../utils/notify', () => ({ notifyUnlessBlocked: jest.fn(), notifyUsers: jest.fn(), matchAudienceIds: jest.fn(async () => []) }));
jest.mock('../utils/tournamentChat', () => ({ syncTournamentChatMembers: jest.fn(), syncAfterSuccess: jest.fn(), canOpenTournamentChat: jest.fn() }));

// eslint-disable-next-line import/first
import { advanceTournamentWinner } from '../controllers/tournaments.controller';
// eslint-disable-next-line import/first
import { getTournamentStandings } from '../controllers/features.controller';
// eslint-disable-next-line import/first
import { openKnockoutPlaces, bestPlacedAcrossGroups, computeStats, type GMatch } from '../utils/standings';

const T = 't1';
const g = (id: string, label: string, a: string, b: string, winner: string | null) =>
  ({ id, tournament_id: T, team_a_id: a, team_b_id: b, winner_team_id: winner, status: 'completed', voided_at: null, round: 0, group_label: label, next_match_id: null, score_summary: {} });
const entry = (id: string, label: string) => ({ tournament_id: T, team_id: id, group_label: label, status: 'approved', team: { id, name: id } });
const ko = (id: string, n: number) => ({ id, tournament_id: T, team_a_id: null, team_b_id: null, status: 'scheduled', round: 1, match_no: n, group_label: null, next_match_id: `sf${n >> 1}`, next_slot: n % 2 ? 'b' : 'a', voided_at: null, score_summary: {} });

describe('BUILD 4.5 · open places and the best next-placed', () => {
  test('3 groups × 2 through → a bracket of 8 with 2 open; 2 × 2 → none; 6 × 2 → 4', () => {
    expect(openKnockoutPlaces([3, 3, 3], 2)).toBe(2);
    expect(openKnockoutPlaces([4, 4], 2)).toBe(0);
    expect(openKnockoutPlaces([4, 4, 4, 4, 4, 4], 2)).toBe(4);
    expect(openKnockoutPlaces([3, 1], 2)).toBe(1);
  });
  test('compared per game, so a group of 4 doesn’t beat a group of 3 on games alone', () => {
    // x3 (group of 4): 3 pts from 3 games; y3 (group of 3): 3 pts from 2 games → y3 better.
    const ms: GMatch[] = [
      { team_a_id: 'x3', team_b_id: 'x1', winner_team_id: 'x3', status: 'completed', score_summary: {} },
      { team_a_id: 'x3', team_b_id: 'x2', winner_team_id: 'x2', status: 'completed', score_summary: {} },
      { team_a_id: 'x3', team_b_id: 'x4', winner_team_id: 'x4', status: 'completed', score_summary: {} },
      { team_a_id: 'y3', team_b_id: 'y1', winner_team_id: 'y3', status: 'completed', score_summary: {} },
      { team_a_id: 'y3', team_b_id: 'y2', winner_team_id: 'y2', status: 'completed', score_summary: {} },
    ];
    const stats = computeStats(['x1', 'x2', 'x3', 'x4', 'y1', 'y2', 'y3'], ms);
    expect(bestPlacedAcrossGroups([['x1', 'x2', 'x3', 'x4'], ['y1', 'y2', 'y3']], 2, 1, stats)).toEqual(['y3']);
  });
});

describe('BUILD 4.5 · best third places fill the knockout', () => {
  beforeEach(() => {
    db.tournaments = [{ id: T, status: 'live', format: 'groups_knockout', champion_team_id: null, tiebreaker_rules: [], num_groups: 3, group_size: null, qualifiers_per_group: 2, settings: { v: 1, bestThirds: true } }];
    db.tournament_entries = ['a', 'b', 'c'].flatMap((l) => [1, 2, 3].map((n) => entry(`${l}${n}`, l.toUpperCase())));
    db.matches = [
      // A: a1 6, a2 3, a3 0.   B: b1 6, b2 1, b3 1 (b2 over b3 on id).   C: a cycle, 3 each → c3 third on 3.
      g('a12', 'A', 'a1', 'a2', 'a1'), g('a13', 'A', 'a1', 'a3', 'a1'), g('a23', 'A', 'a2', 'a3', 'a2'),
      g('b12', 'B', 'b1', 'b2', 'b1'), g('b13', 'B', 'b1', 'b3', 'b1'), g('b23', 'B', 'b2', 'b3', null),
      g('c12', 'C', 'c1', 'c2', 'c1'), g('c23', 'C', 'c2', 'c3', 'c2'), g('c31', 'C', 'c3', 'c1', 'c3'),
      ko('q0', 0), ko('q1', 1), ko('q2', 2), ko('q3', 3),
    ];
  });
  test('the two best thirds (c3 on 3, b3 on 1) take the open places; a3 (0) is out; no byes', async () => {
    await advanceTournamentWinner('c31');
    const qf = db.matches.filter((m) => m.round === 1);
    const inKO = new Set(qf.flatMap((m) => [m.team_a_id, m.team_b_id]));
    expect(qf.every((m) => m.team_a_id && m.team_b_id)).toBe(true);
    for (const t of ['a1', 'a2', 'b1', 'b2', 'c1', 'c2', 'c3', 'b3']) expect(inKO.has(t)).toBe(true);
    expect(inKO.has('a3')).toBe(false);
    // the thirds are the lowest seeds: each meets a group winner
    for (const third of ['c3', 'b3']) {
      const m = qf.find((x) => x.team_a_id === third || x.team_b_id === third)!;
      const opp = m.team_a_id === third ? m.team_b_id : m.team_a_id;
      expect(['a1', 'b1', 'c1']).toContain(opp);
    }
  });
  test('off: no third goes through', async () => {
    db.tournaments[0]!.settings = null;
    await advanceTournamentWinner('c31');
    const inKO = new Set(db.matches.filter((m) => m.round === 1).flatMap((m) => [m.team_a_id, m.team_b_id]));
    for (const t of ['a3', 'b3', 'c3']) expect(inKO.has(t)).toBe(false);
  });
});

describe('BUILD 4.5 · the table marks the best thirds as qualifying', () => {
  beforeEach(() => {
    db.sports = [{ id: 'sp', slug: 'football' }];
    db.tournaments = [{ id: T, sport_id: 'sp', status: 'live', format: 'groups_knockout', tiebreaker_rules: [], num_groups: 3, qualifiers_per_group: 2, settings: { v: 1, bestThirds: true } }];
    db.tournament_entries = ['a', 'b', 'c'].flatMap((l) => [1, 2, 3].map((n) => entry(`${l}${n}`, l.toUpperCase())));
    db.matches = [
      g('a12', 'A', 'a1', 'a2', 'a1'), g('a13', 'A', 'a1', 'a3', 'a1'), g('a23', 'A', 'a2', 'a3', 'a2'),
      g('b12', 'B', 'b1', 'b2', 'b1'), g('b13', 'B', 'b1', 'b3', 'b1'), g('b23', 'B', 'b2', 'b3', null),
      g('c12', 'C', 'c1', 'c2', 'c1'), g('c23', 'C', 'c2', 'c3', 'c2'), g('c31', 'C', 'c3', 'c1', 'c3'),
    ];
  });
  const table = async () => {
    const r: any = { statusCode: 200, body: null };
    r.status = (c: number) => { r.statusCode = c; return r; };
    r.json = (b: unknown) => { r.body = b; return r; };
    await getTournamentStandings({ params: { id: T }, query: {} } as any, r);
    return r.body.standings as Array<{ teamId: string; qualified?: boolean }>;
  };
  test('c3 and b3 are in a qualifying place, a3 isn’t', async () => {
    const q = new Set((await table()).filter((r) => r.qualified).map((r) => r.teamId));
    expect([...q].sort()).toEqual(['a1', 'a2', 'b1', 'b2', 'b3', 'c1', 'c2', 'c3']);
  });
  test('off: only the top 2 of each group', async () => {
    db.tournaments[0]!.settings = null;
    const q = new Set((await table()).filter((r) => r.qualified).map((r) => r.teamId));
    expect([...q].sort()).toEqual(['a1', 'a2', 'b1', 'b2', 'c1', 'c2']);
  });
});
