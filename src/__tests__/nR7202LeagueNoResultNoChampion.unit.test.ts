/**
 * N-R7-202 (Step 2 Batch 9, SP-CRM-136) · a two-player carrom league whose only fixture was
 * abandoned (a no-result: not played, no points) was marked COMPLETED with '🏆 CHAMPION P06' —
 * the table was all 0 and the team-id terminator picked a champion although nothing counted.
 * A league crowns only when at least one fixture counts (a result or a walkover); until then it
 * stays live, and deciding the abandoned fixture (⚖️ Decide the result) crowns it as before.
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
import { advanceTournamentWinner } from '../controllers/tournaments.controller';

const T = 't1';
const m = (id: string, a: string, b: string, winner: string | null, status: string) =>
  ({ id, tournament_id: T, team_a_id: a, team_b_id: b, winner_team_id: winner, status, voided_at: null, group_label: null, round: 1, next_match_id: null, score_summary: {}, overs: null });
const setup = (matches: Row[]) => {
  db.tournaments = [{ id: T, name: 'L', status: 'live', format: 'league', sport_id: 'cr', tiebreaker_rules: [], settings: {}, champion_team_id: null }];
  db.sports = [{ id: 'cr', slug: 'carrom' }];
  db.tournament_entries = ['p05', 'p06'].map((id) => ({ tournament_id: T, team_id: id, status: 'approved', group_label: null, team: { id, name: id, short_name: null } }));
  db.matches = matches;
};

describe('N-R7-202 · a league with nothing counted has no champion', () => {
  test('its only fixture abandoned: stays live, no champion', async () => {
    setup([m('1', 'p05', 'p06', null, 'abandoned')]);
    await advanceTournamentWinner('1');
    expect([db.tournaments[0]!.status, db.tournaments[0]!.champion_team_id]).toEqual(['live', null]);
  });
  test('the abandoned fixture decided afterwards crowns its winner', async () => {
    setup([m('1', 'p05', 'p06', 'p05', 'completed')]);
    await advanceTournamentWinner('1');
    expect([db.tournaments[0]!.status, db.tournaments[0]!.champion_team_id]).toEqual(['completed', 'p05']);
  });
  test('a walkover counts: an abandoned match with a winner still crowns', async () => {
    setup([m('1', 'p05', 'p06', 'p06', 'abandoned')]);
    await advanceTournamentWinner('1');
    expect([db.tournaments[0]!.status, db.tournaments[0]!.champion_team_id]).toEqual(['completed', 'p06']);
  });
});
