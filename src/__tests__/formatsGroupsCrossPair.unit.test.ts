/**
 * FORMATS (28 Sep, live): groups → knockout paired group mates in the first
 * knockout round. Qualifiers are seeded by tier (winners, then runners-up, by
 * points) and paired 1 v 4, 2 v 3, so when the stronger winner's own
 * runner-up was the weaker runner-up, the two met again at once.
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
import { crossGroupFirstRound } from '../utils/koFirstRound';

const T = 't1';
const g = (id: string, label: string, a: string, b: string, winner: string | null) =>
  ({ id, tournament_id: T, team_a_id: a, team_b_id: b, winner_team_id: winner, status: 'completed', voided_at: null, round: 0, group_label: label, next_match_id: null, score_summary: {} });
const entry = (id: string, label: string) => ({ tournament_id: T, team_id: id, group_label: label, status: 'approved', team: { id, name: id } });

describe('groups → knockout pairs across groups', () => {
  beforeEach(() => {
    db.tournaments = [{ id: T, status: 'live', format: 'groups_knockout', champion_team_id: null, tiebreaker_rules: [], num_groups: 2, group_size: null, qualifiers_per_group: 2 }];
    db.tournament_entries = [entry('a1', 'A'), entry('a2', 'A'), entry('a3', 'A'), entry('b1', 'B'), entry('b2', 'B'), entry('b3', 'B')];
    db.matches = [
      // A: a1 wins both (6 pts); a2 and a3 draw (1 pt each) → a1 top, a runner-up on 1 pt
      g('ga1', 'A', 'a1', 'a2', 'a1'), g('ga2', 'A', 'a1', 'a3', 'a1'), g('ga3', 'A', 'a2', 'a3', null),
      // B: a cycle, 3 pts each → the B runner-up (3 pts) outranks A's (1 pt)
      g('gb1', 'B', 'b1', 'b2', 'b1'), g('gb2', 'B', 'b2', 'b3', 'b2'), g('gb3', 'B', 'b3', 'b1', 'b3'),
      { id: 'sf1', tournament_id: T, team_a_id: null, team_b_id: null, status: 'scheduled', round: 1, match_no: 0, group_label: null, next_match_id: 'f', voided_at: null },
      { id: 'sf2', tournament_id: T, team_a_id: null, team_b_id: null, status: 'scheduled', round: 1, match_no: 1, group_label: null, next_match_id: 'f', voided_at: null },
    ];
  });

  it('no semi-final pairs two teams from the same group', async () => {
    await advanceTournamentWinner('gb3');
    const semis = db.matches.filter((m) => m.round === 1);
    const grp = (id: string) => id[0];
    expect(semis.every((m) => m.team_a_id && m.team_b_id)).toBe(true);
    for (const m of semis) expect(grp(m.team_a_id)).not.toBe(grp(m.team_b_id));
    // the group winners keep the top slots
    const tops = semis.map((m) => m.team_a_id as string);
    expect(tops).toContain('a1');
    expect(tops.filter((x) => x.startsWith('b'))).toHaveLength(1);
  });
});

describe('crossGroupFirstRound', () => {
  const t = (id: string) => ({ id, name: id });
  const grp = (id: string) => id[0];
  it('swaps lower seeds to break a same-group pair', () => {
    const out = crossGroupFirstRound([{ a: t('a1'), b: t('a2') }, { a: t('b1'), b: t('b2') }], grp);
    expect(out.map((m) => [m.a!.id, m.b!.id])).toEqual([['a1', 'b2'], ['b1', 'a2']]);
  });
  it('leaves a clean round, byes and an unavoidable clash alone', () => {
    const clean = [{ a: t('a1'), b: t('b2') }, { a: t('b1'), b: t('a2') }];
    expect(crossGroupFirstRound(clean, grp)).toEqual(clean);
    const bye = [{ a: t('a1'), b: null }, { a: t('b1'), b: t('a2') }];
    expect(crossGroupFirstRound(bye, grp)).toEqual(bye);
    const oneGroup = [{ a: t('a1'), b: t('a4') }, { a: t('a2'), b: t('a3') }];
    expect(crossGroupFirstRound(oneGroup, grp)).toEqual(oneGroup);
  });
});
