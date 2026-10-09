/**
 * BUILD 1.4 · a no-result and a walkover count the same way everywhere.
 * An abandoned match with no winner is a no-result: not played, no points
 * (it was a 1-1 draw for crowning and the offline hub, but left out of the
 * server table). An abandoned match WITH a winner is a walkover: a win,
 * including in the table and for the champion of a final. An abandoned
 * group match no longer holds the knockout back.
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
      // Stage 13 · CR9: a PostgREST or() of col.eq.x / col.neq.x / col.is.null terms.
      or: (expr: string) => {
        const terms = expr.split(',').map((t) => { const [c, op, ...v] = t.split('.'); return { c: c!, op, v: v.join('.') }; });
        filters.push((r) => terms.some(({ c, op, v }) => (op === 'is' && v === 'null' ? (r[c] ?? null) === null : op === 'eq' ? r[c] === v : op === 'neq' ? (r[c] ?? null) !== null && r[c] !== v : false)));
        return q;
      },
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
import { computeStats } from '../utils/standings';
// eslint-disable-next-line import/first
import { advanceTournamentWinner, championOf } from '../controllers/tournaments.controller';
// eslint-disable-next-line import/first
import { getTournamentStandings } from '../controllers/features.controller';

const T = 't1';
const m = (id: string, a: string, b: string, winner: string | null, status: string, extra: Row = {}) =>
  ({ id, tournament_id: T, team_a_id: a, team_b_id: b, winner_team_id: winner, status, voided_at: null, group_label: null, round: 1, next_match_id: null, score_summary: {}, overs: null, ...extra });

describe('computeStats', () => {
  test('an abandoned no-result is not played and earns nothing', () => {
    const st = computeStats(['x', 'y'], [m('1', 'x', 'y', null, 'abandoned') as any]);
    expect(st.get('x')).toMatchObject({ played: 0, drawn: 0, points: 0 });
  });
  test('an abandoned match with a winner is a walkover win', () => {
    const st = computeStats(['x', 'y'], [m('1', 'x', 'y', 'x', 'abandoned') as any]);
    expect(st.get('x')).toMatchObject({ played: 1, won: 1, points: 3 });
    expect(st.get('y')).toMatchObject({ played: 1, lost: 1, points: 0 });
  });
  test('a completed match with no winner is still a draw', () => {
    expect(computeStats(['x', 'y'], [m('1', 'x', 'y', null, 'completed') as any]).get('x')).toMatchObject({ drawn: 1, points: 1 });
  });
});

describe('the table counts walkovers', () => {
  test('a withdrawal walkover shows as a win in GET /standings', async () => {
    db.tournaments = [{ id: T, sport_id: 'fb', format: 'league', tiebreaker_rules: [], qualifiers_per_group: 2 }];
    db.sports = [{ id: 'fb', slug: 'football' }];
    db.tournament_entries = ['x', 'y'].map((id) => ({ tournament_id: T, team_id: id, status: 'approved', group_label: null, team: { id, name: id, short_name: null } }));
    db.matches = [m('1', 'x', 'y', 'x', 'abandoned')];
    const r: any = { statusCode: 200 };
    r.status = jest.fn((c: number) => { r.statusCode = c; return r; });
    r.json = jest.fn((b: unknown) => { r.body = b; return r; });
    await getTournamentStandings({ params: { id: T }, query: {} } as any, r);
    expect(r.body.standings.find((s: any) => s.teamId === 'x')).toMatchObject({ won: 1, points: 3 });
  });
});

describe('an abandoned group match doesn\'t block the knockout', () => {
  test('the knockout is seeded once every group match is completed or abandoned', async () => {
    db.tournaments = [{ id: T, status: 'live', format: 'groups_knockout', tiebreaker_rules: [], num_groups: 2, group_size: null, qualifiers_per_group: 1 }];
    db.tournament_entries = [['a1', 'A'], ['a2', 'A'], ['b1', 'B'], ['b2', 'B']].map(([id, g]) => ({ tournament_id: T, team_id: id, group_label: g, status: 'approved', team: { id, name: id } }));
    db.matches = [
      m('gA', 'a1', 'a2', 'a1', 'completed', { round: 0, group_label: 'A' }),
      m('gB', 'b1', 'b2', null, 'abandoned', { round: 0, group_label: 'B' }),
      { id: 'final', tournament_id: T, team_a_id: null, team_b_id: null, status: 'scheduled', round: 1, match_no: 0, group_label: null, next_match_id: null, voided_at: null },
    ];
    await advanceTournamentWinner('gA');
    const f = db.matches.find((x) => x.id === 'final')!;
    expect([f.team_a_id, f.team_b_id].filter(Boolean)).toHaveLength(2);
  });
});

describe('a final won by walkover still crowns', () => {
  test('championOf finds an abandoned final with a winner', async () => {
    db.tournaments = [{ id: T, format: 'knockout', tiebreaker_rules: [] }];
    db.matches = [m('final', 'x', 'y', 'y', 'abandoned', { team_a_name: 'X', team_b_name: 'Y', round: 2 })];
    expect(await championOf(T)).toEqual({ id: 'y', name: 'Y' });
  });
});
