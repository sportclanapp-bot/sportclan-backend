/**
 * N-R7-S171 (Step 2 FINAL C6b, SIDE-C6b-1 / FMT-PKB-DE-02) · a double elimination with a 'final' stage
 * rule: the MAIN DRAW's last match (the winners' bracket final) took the final stage's rules (1 × 15) as
 * if it were the tournament's final, while the back-draw final kept the round rules. In a double
 * elimination the Final (main winner v back-draw winner) and the Reset final are the final; the main
 * draw's last match is a round before it and now plays the rounds' rules ('qf' stage, as the back-draw
 * final). Every knockout sport (one draw helper, insertDoubleElim).
 */
let mockSportSlug = 'cricket';
type Q = string[];
let mockLog: Q[] = [];
let mockNext: (q: Q) => { data?: unknown; error?: unknown; count?: number } = () => ({ data: null, error: null });
jest.mock('../utils/supabase', () => {
  const start = (t: string) => {
    const q: string[] = [`from:${t}`];
    mockLog.push(q);
    const chain: any = {};
    for (const m of ['select', 'in', 'not', 'eq', 'neq', 'is', 'limit', 'maybeSingle', 'single', 'update', 'delete', 'order', 'or', 'ilike', 'range', 'gte', 'gt', 'lt', 'upsert']) {
      chain[m] = jest.fn((...a: unknown[]) => { q.push(`${m}:${JSON.stringify(a)}`); return chain; });
    }
    chain.insert = jest.fn((row: unknown) => { q.push(`insert:${JSON.stringify(row)}`); return chain; });
    chain.then = (ok: (v: unknown) => unknown, bad?: (e: unknown) => unknown) => {
      try { return Promise.resolve(ok({ data: null, error: null, ...mockNext(q) })); } catch (e) { return bad ? bad(e) : Promise.reject(e); }
    };
    return chain;
  };
  return { supabase: { from: jest.fn(start), rpc: jest.fn(async () => ({ data: null, error: null })) } };
});
jest.mock('../utils/tournamentAuth', () => ({
  ...jest.requireActual('../utils/tournamentAuth'),
  isTournamentOrganiser: jest.fn(async () => true),
  logAdminAction: jest.fn(),
}));
jest.mock('../utils/teamVisibility', () => ({ ...jest.requireActual('../utils/teamVisibility'), isTeamDisbanded: jest.fn(async () => false) }));
let mockCanOpenChat = false;
jest.mock('../utils/tournamentChat', () => ({
  syncTournamentChatMembers: jest.fn(async () => undefined),
  syncAfterSuccess: jest.fn(),
  canOpenTournamentChat: jest.fn(async () => mockCanOpenChat),
}));
jest.mock('../utils/testContent', () => ({ hideTestFor: jest.fn(async () => false), excludeTest: (q: unknown) => q, testUserIdSet: jest.fn(async () => new Set()) }));
jest.mock('../utils/sports', () => ({ ...jest.requireActual('../utils/sports'), validateSportForCreate: jest.fn(async () => null) }));
jest.mock('../utils/sportId', () => ({ resolveSportId: jest.fn(async () => undefined) }));
jest.mock('../utils/sportCache', () => ({ ...jest.requireActual('../utils/sportCache'), getSport: jest.fn(async () => ({ slug: mockSportSlug })) }));
jest.mock('../utils/notify', () => ({
  notifyUser: jest.fn(), notifyUsers: jest.fn(), notifyUnlessBlocked: jest.fn(), sendPushToUsers: jest.fn(), allowedRecipients: jest.fn(async () => []),
  matchAudienceIds: jest.fn(async () => []), matchFollowerIds: jest.fn(async () => []),
}));
const T = '22222222-2222-4222-8222-222222222222';
const has = (q: Q, s: string) => q.some((c) => c.startsWith(s));
const run = async (fn: any, req: object) => {
  const r: any = { statusCode: 200, body: null, setHeader: jest.fn() };
  r.status = jest.fn((c: number) => { r.statusCode = c; return r; });
  r.json = jest.fn((b: unknown) => { r.body = b; return r; });
  await fn({ userId: 'me', params: { id: T }, query: {}, body: {}, ...req } as any, r);
  return r;
};
const written = (table: string, op: 'insert' | 'update') => mockLog.filter((q) => q[0] === `from:${table}` && has(q, `${op}:`)).map((q) => { const v = JSON.parse(q.find((c) => c.startsWith(`${op}:`))!.slice(op.length + 1)); return op === 'update' ? v[0] : v; });

// eslint-disable-next-line import/first
import { generateFixtures } from '../controllers/tournaments.controller';

const setup = (sport: string, teams: number, settings: unknown, extra: object = {}) => {
  mockLog = [];
  mockSportSlug = sport;
  mockNext = (q) => {
    if (q[0] === 'from:tournaments' && has(q, 'update:')) return { data: [{ id: T }] };
    if (q[0] === 'from:tournaments') return { data: { id: T, status: 'upcoming', sport_id: 'sp', format: 'knockout', start_date: '2026-10-05', end_date: '2026-10-05', daily_start_time: '09:00', daily_end_time: '20:00', match_duration_minutes: 60, buffer_minutes: 0, ground_count: 1, settings, ...extra } };
    if (q[0] === 'from:tournament_entries' && has(q, 'select:')) return { data: Array.from({ length: teams }, (_, i) => ({ id: `e${i}`, team_id: `t${i}`, entered_at: `2026-10-01T0${i}:00`, team: { id: `t${i}`, name: `T${i}` } })) };
    if (q[0] === 'from:matches' && has(q, 'insert:')) {
      const ins = JSON.parse(q.find((c) => c.startsWith('insert:'))!.slice(7));
      return { data: (Array.isArray(ins) ? ins : [ins]).map((r: any, i: number) => ({ id: `m${r.round}-${r.match_no}-${i}`, match_no: r.match_no })) };
    }
    return { data: [] };
  };
};
const inserted = () => mockLog.filter((q) => q[0] === 'from:matches' && has(q, 'insert:')).flatMap((q) => { const v = JSON.parse(q.find((c) => c.startsWith('insert:'))!.slice(7)); return Array.isArray(v) ? v : [v]; });


const rowsBy = () => {
  const rows = inserted() as any[];
  const main = rows.filter((r) => !r.bracket);
  const k = Math.max(...main.map((r) => r.round));
  const back = rows.filter((r) => r.bracket === 'back');
  const bk = Math.max(...back.map((r) => r.round));
  return { rows, mainFinal: main.filter((r) => r.round === k), mainEarly: main.filter((r) => r.round < k), backFinal: back.filter((r) => r.round === bk), backEarly: back.filter((r) => r.round < bk), final: rows.filter((r) => r.bracket === 'final'), reset: rows.filter((r) => r.bracket === 'reset') };
};

test('cricket DE-4 (rounds T20, final T50): only the Final and the Reset final play the final stage', async () => {
  setup('cricket', 4, { v: 1, doubleElim: true }, { match_rules: { knockout: { overs: 20 }, final: { overs: 50 } } });
  expect((await run(generateFixtures, {})).statusCode).toBe(200);
  const s = rowsBy();
  expect([s.final.length, s.reset.length, s.mainFinal.length, s.backFinal.length]).toEqual([1, 1, 1, 1]);
  for (const r of [...s.final, ...s.reset]) expect([r.overs, r.rules.overs]).toEqual([50, 50]);
  for (const r of [...s.mainFinal, ...s.mainEarly, ...s.backFinal, ...s.backEarly]) expect([r.bracket ?? 'main', r.round, r.overs, r.rules.overs]).toEqual([r.bracket ?? 'main', r.round, 20, 20]);
});

test('pickleball DE-4 (rounds 3 × 11 side-out, final 1 × 15 side-out): the main draw final is 3 × 11', async () => {
  setup('pickleball', 4, { v: 1, doubleElim: true }, { match_rules: { knockout: { bestOf: 3, target: 11, scoring: 'sideout' }, final: { bestOf: 1, target: 15, scoring: 'sideout' } } });
  expect((await run(generateFixtures, {})).statusCode).toBe(200);
  const s = rowsBy();
  for (const r of [...s.final, ...s.reset]) expect([r.rules.bestOf, r.rules.target]).toEqual([1, 15]);
  for (const r of [...s.mainFinal, ...s.mainEarly, ...s.backFinal, ...s.backEarly]) expect([r.bracket ?? 'main', r.round, r.rules.bestOf, r.rules.target]).toEqual([r.bracket ?? 'main', r.round, 3, 11]);
});

test('DE-8 with a quarter-final stage: the main final plays it like the main semis and the back final; the Final and Reset the final stage', async () => {
  setup('cricket', 8, { v: 1, doubleElim: true }, { end_date: '2026-10-08', match_rules: { knockout: { overs: 10 }, qf: { overs: 20 }, final: { overs: 50 } } });
  expect((await run(generateFixtures, {})).statusCode).toBe(200);
  const s = rowsBy();
  for (const r of [...s.final, ...s.reset]) expect(r.overs).toBe(50);
  for (const r of [...s.mainFinal, ...s.backFinal]) expect(r.overs).toBe(20);
});

test('a single-elimination knockout is unchanged: its last round is the final', async () => {
  setup('cricket', 4, { v: 1 }, { match_rules: { knockout: { overs: 20 }, final: { overs: 50 } } });
  expect((await run(generateFixtures, {})).statusCode).toBe(200);
  const rows = inserted() as any[];
  const k = Math.max(...rows.map((r) => r.round));
  for (const r of rows) expect(r.overs).toBe(r.round === k ? 50 : 20);
});
