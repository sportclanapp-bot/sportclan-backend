/**
 * BUILD 4.12 · a third-place match. It shares the final's round and, like the
 * final, has no next match — the rule the server used for "the final" — so it
 * is flagged (matches.third_place, migration 116) and kept out of crowning.
 * The semi-final losers fill it; the tournament completes when both it and the
 * final are decided, whichever is last, and the final's winner is champion.
 * In-memory Supabase, like formatsGroupsCrossPair.
 */
type Row = Record<string, any>;
const db: Record<string, Row[]> = { tournaments: [], matches: [], tournament_entries: [] };
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
      single: () => Promise.resolve({ data: run()[0] ?? null, error: null }),
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
import { advanceTournamentWinner, championOf } from '../controllers/tournaments.controller';

const T = 't1';
const row = (id: string, round: number, match_no: number, a: string | null, b: string | null, extra: Record<string, unknown> = {}) =>
  ({ id, tournament_id: T, round, match_no, team_a_id: a, team_b_id: b, team_a_name: a ?? 'TBD', team_b_name: b ?? 'TBD', status: 'scheduled', winner_team_id: null, voided_at: null, group_label: null, next_match_id: null, next_slot: null, score_summary: {}, ...extra });
const decide = async (id: string, winner: string) => {
  const m = db.matches.find((x) => x.id === id)!;
  Object.assign(m, { status: 'completed', winner_team_id: winner });
  await advanceTournamentWinner(id);
};
const tp = () => db.matches.find((m) => m.third_place)!;
const tour = () => db.tournaments[0]!;

beforeEach(() => {
  db.tournaments = [{ id: T, status: 'live', format: 'knockout', champion_team_id: null, name: 'P3 Cup', settings: { v: 1, thirdPlace: true } }];
  db.tournament_entries = ['A', 'B', 'C', 'D'].map((t) => ({ tournament_id: T, team_id: t, status: 'approved', team: { id: t, name: t } }));
  db.matches = [
    row('sf1', 1, 0, 'A', 'D', { next_match_id: 'f', next_slot: 'A' }),
    row('sf2', 1, 1, 'B', 'C', { next_match_id: 'f', next_slot: 'B' }),
    row('f', 2, 0, null, null),
    row('tp', 2, 1, null, null, { third_place: true }),
  ];
});

test('the semi losers fill the third-place match: first semi’s in A, second’s in B', async () => {
  await decide('sf1', 'A');
  await decide('sf2', 'C');
  expect([tp().team_a_id, tp().team_b_id]).toEqual(['D', 'B']);
  expect(db.matches.find((m) => m.id === 'f')).toMatchObject({ team_a_id: 'A', team_b_id: 'C' });
});

test('final first, third place last: completes only then, crowning the final’s winner', async () => {
  await decide('sf1', 'A');
  await decide('sf2', 'C');
  await decide('f', 'C');
  expect(tour().status).toBe('live');
  await decide('tp', 'B');
  expect(tour()).toMatchObject({ status: 'completed', champion_team_id: 'C' });
});

test('third place first, final last: the final crowns', async () => {
  await decide('sf1', 'A');
  await decide('sf2', 'C');
  await decide('tp', 'D');
  expect(tour().status).toBe('live');
  await decide('f', 'A');
  expect(tour()).toMatchObject({ status: 'completed', champion_team_id: 'A' });
});

test('championOf never names the third-place winner', async () => {
  Object.assign(db.matches.find((m) => m.id === 'tp')!, { team_a_id: 'D', team_b_id: 'B', status: 'completed', winner_team_id: 'D' });
  expect(await championOf(T)).toBeNull();
  Object.assign(db.matches.find((m) => m.id === 'f')!, { team_a_id: 'A', team_b_id: 'C', status: 'completed', winner_team_id: 'C' });
  expect((await championOf(T))?.id).toBe('C');
});

test('a bye semi: the other semi’s loser takes third without playing', async () => {
  db.matches[0] = row('sf1', 1, 0, 'A', null, { next_match_id: 'f', next_slot: 'A' });
  await decide('sf1', 'A');
  expect(tp()).toMatchObject({ team_a_id: null, team_a_name: 'BYE' });
  await decide('sf2', 'B');
  expect(tp()).toMatchObject({ team_b_id: 'C', status: 'completed', winner_team_id: 'C' });
  await decide('f', 'A');
  expect(tour()).toMatchObject({ status: 'completed', champion_team_id: 'A' });
});
