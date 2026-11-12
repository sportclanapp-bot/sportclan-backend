/**
 * N-R7-S143 (Step 2 Batch 13, SIDE-A1-1 on emulator-5558): a round robin finished with Team 01 and
 * Team 02 level on every tie-break was COMPLETED with '🏆 CHAMPION Team 01' while its Table said
 * 'level on every tie-break. Draw lots and record the order.' — the team-id order crowned a champion
 * before any lots, and recording the lots never changed it. Now a league / round robin whose top place
 * is still level waits for the lots (stays live, no champion); recording them crowns the first drawn,
 * and on a finished one the lots set the champion.
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

jest.mock('../utils/tournamentAuth', () => ({ isTournamentOrganiser: jest.fn(async () => true) }));
// eslint-disable-next-line import/first
import { advanceTournamentWinner, championOf } from '../controllers/tournaments.controller';
// eslint-disable-next-line import/first
import { setLots } from '../controllers/lots.controller';

const T = '11111111-1111-4111-8111-111111111111';
const m = (id: string, a: string, b: string, winner: string | null, sa: number, sb: number) =>
  ({ id, tournament_id: T, team_a_id: a, team_b_id: b, winner_team_id: winner, status: 'completed', voided_at: null, group_label: null, round: 1, next_match_id: null, score_summary: { A: { score: sa }, B: { score: sb } }, overs: null });
const setup = (matches: Row[], o: Row = {}) => {
  db.tournaments = [{ id: T, name: 'RR', status: 'live', format: 'round_robin', sport_id: 'fb', tiebreaker_rules: [], settings: {}, champion_team_id: null, ...o }];
  db.sports = [{ id: 'fb', slug: 'football' }];
  db.tournament_entries = ['p05', 'p06'].map((id) => ({ tournament_id: T, team_id: id, status: 'approved', group_label: null, team: { id, name: id, short_name: null } }));
  db.matches = matches;
};
const lots = async (order: string[]) => {
  const res: any = { code: 200, body: null, status(c: number) { this.code = c; return this; }, json(b: unknown) { this.body = b; return this; } };
  await setLots({ userId: 'org', params: { id: T }, body: { group: null, order } } as any, res);
  return res;
};
const state = () => [db.tournaments[0]!.status, db.tournaments[0]!.champion_team_id];

describe('N-R7-S143 · level at the top: no champion until the lots are drawn', () => {
  test('a 1–1 draw (level on every tie-break): stays live, no champion', async () => {
    setup([m('1', 'p05', 'p06', null, 1, 1)]);
    await advanceTournamentWinner('1');
    expect(state()).toEqual(['live', null]);
    expect(await championOf(T)).toBeNull();
  });
  test('recording the lots crowns the first drawn (p06), and the tournament completes', async () => {
    setup([m('1', 'p05', 'p06', null, 1, 1)]);
    await advanceTournamentWinner('1');
    const r = await lots(['p06', 'p05']);
    expect(r.code).toBe(200);
    expect(state()).toEqual(['completed', 'p06']);
  });
  test('a finished one crowned before (old data): the lots set its champion', async () => {
    setup([m('1', 'p05', 'p06', null, 1, 1)], { status: 'completed', champion_team_id: 'p05' });
    await lots(['p06', 'p05']);
    expect(state()).toEqual(['completed', 'p06']);
  });
  test('a clear winner still crowns at once', async () => {
    setup([m('1', 'p05', 'p06', 'p05', 2, 1)]);
    await advanceTournamentWinner('1');
    expect(state()).toEqual(['completed', 'p05']);
  });
});
