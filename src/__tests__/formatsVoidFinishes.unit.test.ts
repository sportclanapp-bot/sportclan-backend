/**
 * FORMATS (28 Sep, live): a voided fixture is not an unplayed one. In "P3 FMT
 * Football RR 5" every fixture but one was played and the last was voided; the
 * round robin stayed live with no champion, because the unplayed-fixture check
 * counted the voided fixture and a void never re-ran the crowning. The same gap
 * held a group stage back from seeding its knockout.
 *
 * In-memory Supabase: each from() filters its table's rows by the calls made.
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
import { recrownAfterVoidChange } from '../controllers/tournaments.controller';

const T = 't1';
const done = (id: string, a: string, b: string, winner: string | null, extra: Row = {}) =>
  ({ id, tournament_id: T, team_a_id: a, team_b_id: b, winner_team_id: winner, status: 'completed', voided_at: null, round: 1, group_label: null, next_match_id: null, score_summary: {}, ...extra });

describe('a void that finishes a round robin crowns it', () => {
  beforeEach(() => {
    db.tournaments = [{ id: T, status: 'live', format: 'round_robin', champion_team_id: null, tiebreaker_rules: [], name: 'P3' }];
    db.tournament_entries = ['x', 'y', 'z'].map((t) => ({ tournament_id: T, team_id: t, status: 'approved', team: { id: t, name: t } }));
    db.matches = [
      done('m1', 'x', 'y', 'x'),
      done('m2', 'x', 'z', 'x'),
      // the last fixture, never played, then voided
      { ...done('m3', 'y', 'z', null), status: 'scheduled', voided_at: '2026-09-28T10:00:00Z' },
    ];
  });

  it('crowns the standings leader and completes the tournament', async () => {
    await recrownAfterVoidChange('m3');
    expect(db.tournaments[0]).toMatchObject({ status: 'completed', champion_team_id: 'x' });
  });

  it('does nothing while an unvoided fixture is still to play', async () => {
    db.matches[1] = { ...db.matches[1]!, status: 'scheduled', winner_team_id: null };
    await recrownAfterVoidChange('m3');
    expect(db.tournaments[0]).toMatchObject({ status: 'live', champion_team_id: null });
  });

  it('a league works the same way', async () => {
    db.tournaments[0]!.format = 'league';
    await recrownAfterVoidChange('m3');
    expect(db.tournaments[0]).toMatchObject({ status: 'completed', champion_team_id: 'x' });
  });
});

describe('a void that ends the group stage seeds the knockout', () => {
  beforeEach(() => {
    db.tournaments = [{ id: T, status: 'live', format: 'groups_knockout', champion_team_id: null, tiebreaker_rules: [], num_groups: 2, group_size: null, qualifiers_per_group: 1 }];
    db.tournament_entries = [
      { tournament_id: T, team_id: 'a1', group_label: 'A', status: 'approved', team: { id: 'a1', name: 'a1' } },
      { tournament_id: T, team_id: 'a2', group_label: 'A', status: 'approved', team: { id: 'a2', name: 'a2' } },
      { tournament_id: T, team_id: 'b1', group_label: 'B', status: 'approved', team: { id: 'b1', name: 'b1' } },
      { tournament_id: T, team_id: 'b2', group_label: 'B', status: 'approved', team: { id: 'b2', name: 'b2' } },
    ];
    db.matches = [
      done('gA', 'a1', 'a2', 'a1', { round: 0, group_label: 'A' }),
      { ...done('gB', 'b1', 'b2', null, { round: 0, group_label: 'B' }), status: 'scheduled' },
      { ...done('gB2', 'b1', 'b2', 'b1', { round: 0, group_label: 'B' }) },
      { id: 'final', tournament_id: T, team_a_id: null, team_b_id: null, status: 'scheduled', round: 1, match_no: 0, group_label: null, next_match_id: null, voided_at: null },
    ];
  });

  it('once the last group fixture is voided, the knockout gets its teams', async () => {
    db.matches[1]!.voided_at = '2026-09-28T10:00:00Z';
    await recrownAfterVoidChange('gB');
    const final = db.matches.find((m) => m.id === 'final')!;
    expect([final.team_a_id, final.team_b_id].sort()).toEqual(['a1', 'b1']);
  });
});
