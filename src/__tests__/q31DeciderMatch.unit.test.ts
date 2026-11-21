/**
 * Q31 (Dipak chose B, 21 Nov 2026): on a full tie after every tie-break the organiser chooses a draw
 * of lots or a decider match. The decider is a match outside the tables (tournament_id null) for
 * exactly two level teams; its winner goes first in the group's draw-of-lots order, so the champion
 * follows. A level decider writes nothing; lots drawn by hand take over from it.
 */
type Row = Record<string, any>;
const db: Record<string, Row[]> = { tournaments: [], matches: [], tournament_entries: [], sports: [], teams: [], team_members: [], match_participants: [] };
let seq = 0;
const contains = (row: unknown, part: unknown): boolean => {
  if (Array.isArray(part)) return Array.isArray(row) && part.every((p) => row.some((r) => contains(r, p)));
  if (part && typeof part === 'object') return !!row && typeof row === 'object' && Object.entries(part).every(([k, v]) => contains((row as Row)[k], v));
  return row === part;
};
jest.mock('../utils/supabase', () => {
  const from = (table: string) => {
    const filters: Array<(r: Row) => boolean> = [];
    let patch: Row | null = null;
    let inserted: Row[] | null = null;
    let head = false;
    const run = () => {
      if (inserted) return inserted;
      const rows = (db[table] ?? []).filter((r) => filters.every((f) => f(r)));
      if (patch) for (const r of rows) Object.assign(r, patch);
      return rows;
    };
    const q: any = {
      select: (_c?: string, o?: { head?: boolean }) => { head = !!o?.head; return q; },
      update: (p: Row) => { patch = p; return q; },
      insert: (p: Row | Row[]) => { inserted = (Array.isArray(p) ? p : [p]).map((r) => ({ id: `m-new-${++seq}`, voided_at: null, winner_team_id: null, ...r })); (db[table] ??= []).push(...inserted); return q; },
      upsert: (p: Row | Row[]) => { (db[table] ??= []).push(...(Array.isArray(p) ? p : [p])); return q; },
      eq: (c: string, v: unknown) => { filters.push((r) => r[c] === v); return q; },
      neq: (c: string, v: unknown) => { filters.push((r) => r[c] !== v); return q; },
      is: (c: string, v: null) => { filters.push((r) => (r[c] ?? null) === v); return q; },
      or: () => q,
      not: (c: string, _op: string, v: null) => { filters.push((r) => (r[c] ?? null) !== v); return q; },
      in: (c: string, v: unknown[]) => { filters.push((r) => v.includes(r[c])); return q; },
      contains: (c: string, v: unknown) => { filters.push((r) => contains(r[c], v)); return q; },
      order: () => q,
      range: () => q,
      limit: () => q,
      single: () => Promise.resolve({ data: run()[0] ?? null, error: null }),
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
jest.mock('../utils/sportCache', () => ({ ...jest.requireActual('../utils/sportCache'), getSport: jest.fn(async () => ({ id: 'fb', slug: 'football' })) }));
// eslint-disable-next-line import/first
import { advanceTournamentWinner } from '../controllers/tournaments.controller';
// eslint-disable-next-line import/first
import { setLots } from '../controllers/lots.controller';
// eslint-disable-next-line import/first
import { createDecider, deciderAfterResult, applyDeciders } from '../controllers/decider.controller';

const T = '11111111-1111-4111-8111-111111111111';
const A = '22222222-2222-4222-8222-222222222222';
const B = '33333333-3333-4333-8333-333333333333';
const C = '44444444-4444-4444-8444-444444444444';
const m = (id: string, a: string, b: string, winner: string | null, sa: number, sb: number) =>
  ({ id, tournament_id: T, team_a_id: a, team_b_id: b, winner_team_id: winner, status: 'completed', voided_at: null, group_label: null, round: 1, next_match_id: null, score_summary: { A: { score: sa }, B: { score: sb } }, overs: null });
const setup = (matches: Row[]) => {
  db.tournaments = [{ id: T, name: 'RR', status: 'live', format: 'round_robin', sport_id: 'fb', tiebreaker_rules: [], settings: {}, champion_team_id: null, match_rules: null, entry_kind: 'team' }];
  db.sports = [{ id: 'fb', slug: 'football' }];
  db.teams = [A, B, C].map((id, i) => ({ id, name: `Team ${i + 1}` }));
  db.tournament_entries = [A, B].map((id) => ({ tournament_id: T, team_id: id, status: 'approved', group_label: null, team: { id, name: id, short_name: null } }));
  db.matches = matches;
};
const call = async (fn: (req: any, res: any) => Promise<unknown>, body: Row) => {
  const res: any = { code: 200, body: null, status(c: number) { this.code = c; return this; }, json(b: unknown) { this.body = b; return this; } };
  await fn({ userId: 'org', params: { id: T }, body } as any, res);
  return res;
};
const tour = () => db.tournaments[0]!;
const finish = async (matchId: string, winner: string | null) => {
  Object.assign(db.matches.find((x) => x.id === matchId)!, { status: 'completed', winner_team_id: winner });
  await deciderAfterResult(matchId);
};

describe('Q31 · a decider match for two teams level on every tie-break', () => {
  beforeEach(async () => { setup([m('1', A, B, null, 1, 1)]); await advanceTournamentWinner('1'); });

  test('level at the top: no champion yet; the decider is a match outside the table', async () => {
    expect([tour().status, tour().champion_team_id]).toEqual(['live', null]);
    const r = await call(createDecider, { group: null, team_ids: [A, B] });
    expect(r.code).toBe(201);
    const d = db.matches.find((x) => x.id === r.body.match_id)!;
    expect(d).toMatchObject({ tournament_id: null, team_a_id: A, team_b_id: B, status: 'scheduled', is_ranked: false, team_a_name: 'Team 1' });
    expect(tour().settings.deciders).toEqual([{ group: '', match_id: d.id, team_ids: [A, B] }]);
  });

  test('three teams, the same team twice, or a team not in the tournament: refused (draw lots)', async () => {
    expect((await call(createDecider, { group: null, team_ids: [A, B, C] })).body.code).toBe('BAD_DECIDER');
    expect((await call(createDecider, { group: null, team_ids: [A, A] })).body.code).toBe('BAD_DECIDER');
    expect((await call(createDecider, { group: null, team_ids: [A, C] })).body.code).toBe('BAD_DECIDER');
  });

  test('one open decider at a time', async () => {
    const first = await call(createDecider, { group: null, team_ids: [A, B] });
    const again = await call(createDecider, { group: null, team_ids: [A, B] });
    expect([again.code, again.body.code, again.body.match_id]).toEqual([409, 'DECIDER_OPEN', first.body.match_id]);
  });

  test('the decider’s winner goes first in the draw of lots and is crowned', async () => {
    const r = await call(createDecider, { group: null, team_ids: [A, B] });
    await finish(r.body.match_id, B);
    expect(tour().settings.lots).toEqual({ '': [B, A] });
    expect([tour().status, tour().champion_team_id]).toEqual(['completed', B]);
    const { view } = await applyDeciders(tour() as any);
    expect(view).toEqual([{ group: null, match_id: r.body.match_id, team_ids: [A, B], status: 'completed', winner_team_id: B, closed: false }]);
  });

  test('a decider that ends level writes nothing; another can be set', async () => {
    const r = await call(createDecider, { group: null, team_ids: [A, B] });
    await finish(r.body.match_id, null);
    expect(tour().settings.lots).toBeUndefined();
    expect([tour().status, tour().champion_team_id]).toEqual(['live', null]);
    expect((await call(createDecider, { group: null, team_ids: [A, B] })).code).toBe(201);
  });

  test('lots drawn by hand take over: the decider’s later result changes nothing', async () => {
    const r = await call(createDecider, { group: null, team_ids: [A, B] });
    await call(setLots, { group: null, order: [A, B] });
    expect(tour().champion_team_id).toBe(A);
    await finish(r.body.match_id, B);
    expect(tour().settings.lots).toEqual({ '': [A, B] });
    expect(tour().champion_team_id).toBe(A);
  });
});
