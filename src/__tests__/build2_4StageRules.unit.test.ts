/**
 * BUILD 2.4 · a tournament's match rules per stage (tournaments.match_rules,
 * migration 114): group / knockout / final, falling back to default, then the
 * sport's standard — copied onto each fixture (rules + format / overs) at the
 * draw, checked by the shared validator, and fixed once the draw is made.
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

// eslint-disable-next-line import/first
import { generateFixtures, createTournament, updateTournament } from '../controllers/tournaments.controller';
// eslint-disable-next-line import/first
import { stageRules, tournamentRulesRefusal } from '../utils/matchRules';
const T = '22222222-2222-4222-8222-222222222222';
const has = (q: Q, s: string) => q.some((c) => c.startsWith(s));
const call = async () => {
  const r: any = { statusCode: 200, body: null, setHeader: jest.fn() };
  r.status = jest.fn((c: number) => { r.statusCode = c; return r; });
  r.json = jest.fn((b: unknown) => { r.body = b; return r; });
  await generateFixtures({ userId: 'me', params: { id: T }, query: {}, body: {} } as any, r);
  return r;
};
const inserted = () => mockLog.filter((q) => q[0] === 'from:matches' && has(q, 'insert:')).flatMap((q) => q.filter((c) => c.startsWith('insert:')).map((c) => JSON.parse(c.slice(7))));
const STAGES = { group: { overs: 10 }, knockout: { overs: 20 }, final: { overs: 50 } };
const setupGK = (teams: number, extra: object = {}) => {
  mockLog = [];
  mockSportSlug = 'cricket';
  mockNext = (q) => {
    if (q[0] === 'from:tournaments' && has(q, 'update:')) return { data: [{ id: T }] };
    if (q[0] === 'from:tournaments') return { data: { id: T, status: 'upcoming', sport_id: 'sp', format: 'groups_knockout', start_date: '2026-10-05', match_rules: STAGES, num_groups: 2, qualifiers_per_group: 2, ...extra } };
    if (q[0] === 'from:tournament_entries' && has(q, 'select:')) return { data: Array.from({ length: teams }, (_, i) => ({ team_id: `t${i}`, team: { id: `t${i}`, name: `T${i}` } })) };
    if (q[0] === 'from:matches' && has(q, 'insert:')) return { data: [{ id: 'm1', match_no: 0 }] };
    return { data: [] };
  };
};

describe('BUILD 2.4 · stageRules', () => {
  test('the final falls back to knockout then default; a stage left alone is standard', () => {
    expect(stageRules('cricket', STAGES, 'final').overs).toBe(50);
    expect(stageRules('cricket', { knockout: { overs: 20 } }, 'final').overs).toBe(20);
    expect(stageRules('cricket', { default: { overs: 5 } }, 'group').overs).toBe(5);
    expect(stageRules('cricket', null, 'knockout')).toEqual({ v: 1, style: 'limited', overs: 20, players: null, lastManStands: false, retireAt: null, bowlerOvers: null, extraRuns: 1, rebowl: true, freeHit: false, inningsMinutes: null, powerplayOvers: null, drawAllowed: true });
  });
  test('each stage is checked by the rules validator', () => {
    expect(tournamentRulesRefusal('cricket', { group: { overs: 0 } })).toMatchObject({ code: 'BAD_RULES', error: 'Group / league matches: Overs must be a whole number from 1 to 50.' });
    expect(tournamentRulesRefusal('cricket', { semi: {} })?.field).toBe('semi');
    expect(tournamentRulesRefusal('cricket', STAGES)).toBeNull();
  });
});

describe('BUILD 2.4 · the draw copies each stage’s rules onto its fixtures', () => {
  test('groups T10, knockout T20, the final T50', async () => {
    setupGK(4);
    expect((await call()).statusCode).toBe(200);
    const rows = inserted().flat();
    const group = rows.filter((r) => r.group_label);
    const ko = rows.filter((r) => !r.group_label);
    expect(group.length).toBeGreaterThan(0);
    for (const r of group) expect([r.format, r.overs, r.rules.overs]).toEqual(['T10', 10, 10]);
    const final = ko.reduce((a, b) => (a.round > b.round ? a : b));
    expect([final.format, final.overs, final.rules.overs]).toEqual(['T50', 50, 50]);
    for (const r of ko.filter((x) => x !== final)) expect([r.format, r.overs]).toEqual(['T20', 20]);
  });
  test('a knockout’s last round is the final', async () => {
    setupGK(4, { format: 'knockout' });
    await call();
    const rows = inserted().flat();
    const maxRound = Math.max(...rows.map((r) => r.round));
    for (const r of rows) expect(r.overs).toBe(r.round === maxRound ? 50 : 20);
  });
  test('a league plays the group rules', async () => {
    setupGK(3, { format: 'league' });
    await call();
    for (const r of inserted().flat()) expect(r.overs).toBe(10);
  });
});

describe('BUILD 2.4 · set on create and edit, fixed once drawn', () => {
  const run = async (fn: any, req: object) => {
    const r: any = { statusCode: 200, body: null, setHeader: jest.fn() };
    r.status = jest.fn((c: number) => { r.statusCode = c; return r; });
    r.json = jest.fn((b: unknown) => { r.body = b; return r; });
    await fn({ userId: 'me', params: { id: T }, query: {}, body: {}, ...req } as any, r);
    return r;
  };
  const tBody = { sport_id: 'sp', name: 'P3 Stages', format: 'league', max_teams: 4, entry_fee: 0, start_date: '2026-10-05' };
  test('create stores each stage as full rules; bad ones → 400, nothing inserted', async () => {
    mockSportSlug = 'cricket';
    mockLog = [];
    mockNext = (q) => (q[0] === 'from:tournaments' && has(q, 'insert:') ? { data: { id: T } } : { data: null });
    const ok = await run(createTournament, { body: { ...tBody, match_rules: { knockout: { overs: 50 } } } });
    expect(ok.statusCode).toBeLessThan(300);
    const q = mockLog.find((x) => x[0] === 'from:tournaments' && has(x, 'insert:'))!;
    expect(JSON.parse(q.find((c) => c.startsWith('insert:'))!.slice(7)).match_rules).toEqual({ knockout: { v: 1, style: 'limited', overs: 50, players: null, lastManStands: false, retireAt: null, bowlerOvers: null, extraRuns: 1, rebowl: true, freeHit: false, inningsMinutes: null, powerplayOvers: null, drawAllowed: true } });
    mockLog = [];
    const bad = await run(createTournament, { body: { ...tBody, match_rules: { final: { overs: 60 } } } });
    expect([bad.statusCode, bad.body.code]).toEqual([400, 'BAD_RULES']);
    expect(mockLog.some((x) => has(x, 'insert:'))).toBe(false);
  });
  test('edit after the draw → 409 RULES_LOCKED', async () => {
    mockSportSlug = 'cricket';
    mockLog = [];
    mockNext = (q) => (q[0] === 'from:tournaments' ? { data: { id: T, created_by: 'me', status: 'upcoming', format: 'league', fixtures_generated: true, sport_id: 'sp' } } : { data: null });
    const r = await run(updateTournament, { body: { match_rules: { default: { overs: 10 } } } });
    expect([r.statusCode, r.body.code]).toEqual([409, 'RULES_LOCKED']);
  });
});
