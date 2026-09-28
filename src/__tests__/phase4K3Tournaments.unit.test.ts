/**
 * Phase 4 · K3 — tournament standings, bracket names and seeding (SC-373/376/377/378).
 * Supabase is a recording chain: every from()/rpc() starts its own query and
 * resolves to mockNext(q).
 */
type Q = string[];
let mockLog: Q[] = [];
let mockNext: (q: Q) => { data?: unknown; error?: unknown; count?: number | null } = () => ({ data: null, error: null });
jest.mock('../utils/supabase', () => {
  const start = (head: string) => {
    const q: string[] = [head];
    mockLog.push(q);
    const chain: any = {};
    for (const m of ['select', 'in', 'not', 'eq', 'neq', 'is', 'limit', 'update', 'delete', 'order', 'or', 'ilike', 'range', 'gte', 'gt', 'lt', 'lte', 'upsert', 'insert', 'filter', 'match', 'contains', 'overlaps', 'textSearch', 'returns', 'abortSignal']) {
      chain[m] = jest.fn((...a: unknown[]) => { q.push(`${m}:${JSON.stringify(a)}`); return chain; });
    }
    const done = () => ({ data: null, error: null, ...mockNext(q) });
    chain.single = jest.fn(async () => { q.push('single'); return done(); });
    chain.maybeSingle = jest.fn(async () => { q.push('maybeSingle'); return done(); });
    chain.then = (ok: (v: unknown) => unknown, bad?: (e: unknown) => unknown) => {
      try { return Promise.resolve(ok(done())); } catch (e) { return bad ? bad(e) : Promise.reject(e); }
    };
    return chain;
  };
  return { supabase: { from: jest.fn((t: string) => start(`from:${t}`)), rpc: jest.fn((n: string, args?: unknown) => start(`rpc:${n}:${JSON.stringify(args ?? null)}`)) } };
});
jest.mock('../utils/tournamentAuth', () => ({
  ...jest.requireActual('../utils/tournamentAuth'),
  isTournamentOrganiser: jest.fn(async () => true),
}));
jest.mock('../utils/tournamentChat', () => ({ syncTournamentChatMembers: jest.fn(), syncAfterSuccess: jest.fn(), canOpenTournamentChat: jest.fn(async () => true) }));
jest.mock('../utils/notify', () => ({ notifyUser: jest.fn(), notifyUsers: jest.fn(), notifyUnlessBlocked: jest.fn(), matchAudienceIds: jest.fn(async () => []), matchFollowerIds: jest.fn(async () => []) }));

// eslint-disable-next-line import/first
import { getTournamentStandings } from '../controllers/features.controller';
// eslint-disable-next-line import/first
import { getBracket, generateFixtures } from '../controllers/tournaments.controller';

const ME = '11111111-1111-4111-8111-111111111111';
const TOUR = '22222222-2222-4222-8222-222222222222';
const res = () => {
  const r: any = { statusCode: 200, body: null, setHeader: jest.fn() };
  r.status = jest.fn((c: number) => { r.statusCode = c; return r; });
  r.json = jest.fn((b: unknown) => { r.body = b; return r; });
  return r;
};
const call = async (fn: any, req: object) => { const r = res(); await fn({ userId: ME, params: { id: TOUR }, query: {}, body: {}, ...req }, r); return r; };
const has = (q: Q, s: string) => q.some((c) => c.includes(s));
const entry = (id: string, status = 'approved', group: string | null = null) => ({ team_id: id, group_label: group, status, team: { id, name: `Team ${id}`, short_name: null } });
const played = (a: string | null, b: string | null, w: string | null, ga = 0, gb = 0) => ({
  id: `m-${a}-${b}`, team_a_id: a, team_b_id: b, winner_team_id: w, status: 'completed', overs: null,
  score_summary: { team_a_score: ga, team_b_score: gb },
});
const standingsDb = (format: string, entries: object[], matches: object[]) => (q: Q) => {
  if (q[0] === 'from:tournaments') return { data: { id: TOUR, sport_id: 'sp', format, tiebreaker_rules: [], qualifiers_per_group: 1 } };
  if (q[0] === 'from:tournament_entries') return { data: entries };
  if (q[0] === 'from:matches') return { data: matches };
  if (q[0] === 'from:sports') return { data: { slug: 'football' } };
  return { data: null };
};
const row = (r: any, id: string) => r.body.standings.find((s: any) => s.teamId === id);

beforeEach(() => { mockLog = []; mockNext = () => ({ data: null, error: null }); });

describe('SC-373 · standings and bracket names', () => {
  it('K3-22 (f349bff): a knockout BYE (completed, one empty slot, a winner) gives no played/won/points', async () => {
    mockNext = standingsDb('knockout', [entry('A'), entry('B'), entry('C')], [played('B', null, 'B')]);
    const r = await call(getTournamentStandings, {});
    expect([row(r, 'B').played, row(r, 'B').won, row(r, 'B').points]).toEqual([0, 0, 0]);
  });
  it('K3-22 (f349bff): a round robin / league is "Fixtures", not "Final"', async () => {
    for (const format of ['round_robin', 'league']) {
      mockNext = (q) => (q[0] === 'from:tournaments' ? { data: { id: TOUR, name: 'Cup', format } } : q[0] === 'from:matches' ? { data: [{ id: 'm1', round: 1 }, { id: 'm2', round: 1 }] } : { data: null });
      const r = await call(getBracket, {});
      expect(r.body.rounds.map((x: any) => x.name)).toEqual(['Fixtures']);
    }
    // control: a knockout's last round is still the Final
    mockNext = (q) => (q[0] === 'from:tournaments' ? { data: { id: TOUR, name: 'Cup', format: 'knockout' } } : q[0] === 'from:matches' ? { data: [{ id: 'm1', round: 1 }, { id: 'm2', round: 2 }] } : { data: null });
    expect((await call(getBracket, {})).body.rounds.map((x: any) => x.name)).toEqual(['Semi-Finals', 'Final']);
  });
});

describe('SC-377 · a withdrawn team', () => {
  it('K3-23 (1d4bf49): pending entries are not read; withdrawn ones are', async () => {
    mockNext = standingsDb('league', [entry('A')], []);
    await call(getTournamentStandings, {});
    const q = mockLog.find((x) => x[0] === 'from:tournament_entries')!.join();
    expect(q).toContain('in:["status",["approved","withdrawn"]]');
  });
  it('K3-23 / K3-26 (1d4bf49, 6e18c2d): Z beat B, B withdrew — Z keeps its 3 points and ranks above C (not by team id); B sinks to the bottom and cannot qualify', async () => {
    mockNext = standingsDb('groups_knockout', [entry('Z', 'approved', 'G'), entry('B', 'withdrawn', 'G'), entry('C', 'approved', 'G')], [played('Z', 'B', 'Z', 2, 0)]);
    const r = await call(getTournamentStandings, {});
    expect(r.body.standings.map((s: any) => s.teamId)).toEqual(['Z', 'C', 'B']);
    expect(row(r, 'Z').points).toBe(3);
    expect(row(r, 'B').withdrawn).toBe(true);
    expect(row(r, 'B').qualified).toBeUndefined();
    expect(row(r, 'Z').qualified).toBe(true);
  });
  it('K3-23 (1d4bf49): a withdrawn team that never played is dropped as a phantom row', async () => {
    mockNext = standingsDb('league', [entry('A'), entry('GONE', 'withdrawn')], []);
    const r = await call(getTournamentStandings, {});
    expect(r.body.standings.map((s: any) => s.teamId)).toEqual(['A']);
  });
});

describe('SC-378 · a direct knockout is seeded', () => {
  it('K3-23 (1d4bf49): entries are read in seed order, and round 1 is the standard bracket — byes on the top seeds', async () => {
    const teams = ['s1', 's2', 's3', 's4', 's5'];
    let n = 0;
    mockNext = (q) => {
      if (q[0] === 'from:tournaments' && q.includes('maybeSingle')) return { data: { id: TOUR, status: 'upcoming', sport_id: 'sp', format: 'knockout', start_date: '2026-10-10', created_by: ME, ground_count: 1 } };
      if (q[0] === 'from:tournaments' && has(q, 'fixtures_generated')) return { data: [{ id: TOUR }] };
      if (q[0] === 'from:tournament_entries') return { data: teams.map((t, i) => ({ team_id: t, seed: i + 1, entered_at: null, team: { id: t, name: t } })) };
      if (q[0] === 'from:matches' && q.some((c) => c.startsWith('insert:'))) {
        const rows = JSON.parse(q.find((c) => c.startsWith('insert:'))!.slice(7))[0];
        return { data: rows.map((x: any) => ({ id: `id${n++}`, match_no: x.match_no })) };
      }
      return { data: null };
    };
    await call(generateFixtures, {});
    expect(mockLog.find((x) => x[0] === 'from:tournament_entries')!.join()).toContain('order:["seed",{"ascending":true,"nullsFirst":false}]');
    const r1 = mockLog.map((x) => x.find((c) => c.startsWith('insert:'))).filter(Boolean)
      .map((c) => JSON.parse(c!.slice(7))[0]).find((rows: any[]) => rows[0]?.round === 1) as any[];
    const pairs = r1.map((m) => [m.team_a_id, m.team_b_id]);
    expect(pairs).toEqual([['s1', null], ['s4', 's5'], ['s2', null], ['s3', null]]);
  });
});
