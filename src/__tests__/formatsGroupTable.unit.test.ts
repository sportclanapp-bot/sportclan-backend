/**
 * FORMATS (28 Sep): the groups → knockout table is the group table. It counted
 * every completed match, so a team's knockout wins were added to its group
 * played/won/points once the knockout began.
 */
type Row = Record<string, any>;
const db: Record<string, Row[]> = { tournaments: [], matches: [], tournament_entries: [], sports: [] };
jest.mock('../utils/supabase', () => {
  const from = (table: string) => {
    const filters: Array<(r: Row) => boolean> = [];
    const run = () => (db[table] ?? []).filter((r) => filters.every((f) => f(r)));
    const q: any = {
      select: () => q,
      eq: (c: string, v: unknown) => { filters.push((r) => r[c] === v); return q; },
      is: (c: string, v: null) => { filters.push((r) => (r[c] ?? null) === v); return q; },
      in: (c: string, v: unknown[]) => { filters.push((r) => v.includes(r[c])); return q; },
      order: () => q,
      maybeSingle: () => Promise.resolve({ data: run()[0] ?? null, error: null }),
      then: (resolve: (v: unknown) => unknown) => resolve({ data: run(), error: null }),
    };
    return q;
  };
  return { supabase: { from } };
});

// eslint-disable-next-line import/first
import { getTournamentStandings } from '../controllers/features.controller';

const T = 't1';
const m = (id: string, a: string, b: string, winner: string, group: string | null) =>
  ({ id, tournament_id: T, team_a_id: a, team_b_id: b, winner_team_id: winner, status: 'completed', voided_at: null, group_label: group, round: group ? 0 : 1, score_summary: { team_a_score: 2, team_b_score: 1 }, overs: null });
const entry = (id: string, g: string) => ({ tournament_id: T, team_id: id, group_label: g, status: 'approved', team: { id, name: id, short_name: null } });

beforeEach(() => {
  db.tournaments = [{ id: T, sport_id: 'football', format: 'groups_knockout', tiebreaker_rules: [], qualifiers_per_group: 2 }];
  db.sports = [{ id: 'football', slug: 'football' }];
  db.tournament_entries = [entry('a1', 'A'), entry('a2', 'A'), entry('b1', 'B'), entry('b2', 'B')];
  db.matches = [
    m('ga', 'a1', 'a2', 'a1', 'A'),
    m('gb', 'b1', 'b2', 'b1', 'B'),
    // knockout: semis and final
    m('sf1', 'a1', 'b2', 'a1', null),
    m('sf2', 'b1', 'a2', 'b1', null),
    m('f', 'a1', 'b1', 'a1', null),
  ];
});

it('group rows count group matches only, after the knockout is played', async () => {
  const r: any = { statusCode: 200 };
  r.status = jest.fn((c: number) => { r.statusCode = c; return r; });
  r.json = jest.fn((b: unknown) => { r.body = b; return r; });
  await getTournamentStandings({ params: { id: T }, query: {} } as any, r);
  const row = (id: string) => r.body.standings.find((s: any) => s.teamId === id);
  expect(row('a1')).toMatchObject({ played: 1, won: 1, points: 3, groupLabel: 'A' });
  expect(row('b1')).toMatchObject({ played: 1, won: 1, points: 3, groupLabel: 'B' });
  expect(row('a2')).toMatchObject({ played: 1, won: 0, points: 0 });
});

it('a league table still counts every match', async () => {
  db.tournaments[0]!.format = 'league';
  for (const e of db.tournament_entries) e.group_label = null;
  const r: any = { statusCode: 200 };
  r.status = jest.fn((c: number) => { r.statusCode = c; return r; });
  r.json = jest.fn((b: unknown) => { r.body = b; return r; });
  await getTournamentStandings({ params: { id: T }, query: {} } as any, r);
  expect(r.body.standings.find((s: any) => s.teamId === 'a1')).toMatchObject({ played: 3, won: 3, points: 9 });
});
