/**
 * N-R7-S111 (OBS-C6-1) · a ladder's tab said 'P06, P09, P07 and P05 are level on
 * every tie-break. The organiser will draw lots.' A ladder is in its positions
 * (seed, then challenges), never tie-breaks: nobody on it is level.
 */
type Row = Record<string, any>;
const db: Record<string, Row[]> = { tournaments: [], matches: [], tournament_entries: [], sports: [], match_events: [] };
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
import { getTournamentStandings } from '../controllers/features.controller';

const T = 't8';
const m = (id: string, a: string, b: string, status: string, extra: Row = {}) =>
  ({ id, tournament_id: T, team_a_id: a, team_b_id: b, winner_team_id: null, status, voided_at: null, group_label: null, round: 1, next_match_id: null, score_summary: { A: { score: 0 }, B: { score: 0 } }, overs: null, ...extra });
const standings = async () => {
  const r: any = { statusCode: 200, body: null, status(c: number) { this.statusCode = c; return this; }, json(b: unknown) { this.body = b; return this; } };
  await getTournamentStandings({ params: { id: T }, query: {} } as any, r);
  return r.body;
};
beforeEach(() => {
  db.tournaments = [{ id: T, sport_id: 'fb', format: 'league', tiebreaker_rules: [], qualifiers_per_group: 2, settings: {} }];
  db.sports = [{ id: 'fb', slug: 'football' }];
  db.tournament_entries = ['x', 'y', 'z'].map((id) => ({ tournament_id: T, team_id: id, status: 'approved', group_label: null, team: { id, name: id, short_name: null } }));
});

test('a ladder reports nobody level, even with every challenge drawn', async () => {
  db.tournaments[0].format = 'ladder';
  db.tournament_entries.forEach((e, i) => { e.seed = i + 1; });
  db.matches = [m('1', 'x', 'y', 'completed'), m('2', 'y', 'z', 'completed'), m('3', 'x', 'z', 'completed')];
  const s = await standings();
  expect(s.level).toEqual([]);
  expect(s.by_lot).toEqual([]);
  expect(s.standings.map((r: any) => r.team_id ?? r.teamId)).toEqual(['x', 'y', 'z']);
});

test('the same results in a league are still level (control)', async () => {
  db.matches = [m('1', 'x', 'y', 'completed'), m('2', 'y', 'z', 'completed'), m('3', 'x', 'z', 'completed')];
  expect((await standings()).level.map((l: any) => l.team_ids.length)).toEqual([3]);
});
