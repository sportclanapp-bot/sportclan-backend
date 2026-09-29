/**
 * BUILD 1.11 · `home_away` was stored as sent and never read. It now says what
 * the format decides — a league plays home and away, a round robin once,
 * knockout ties are one match — and a contradicting value is refused.
 */
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
jest.mock('../utils/notify', () => ({
  notifyUser: jest.fn(), notifyUsers: jest.fn(), notifyUnlessBlocked: jest.fn(), sendPushToUsers: jest.fn(), allowedRecipients: jest.fn(async () => []),
  matchAudienceIds: jest.fn(async () => []), matchFollowerIds: jest.fn(async () => []),
}));

// eslint-disable-next-line import/first
import { createTournament, updateTournament, homeAwayFor } from '../controllers/tournaments.controller';

const T = '22222222-2222-4222-8222-222222222222';
const run = async (fn: any, body: object) => {
  const r: any = { statusCode: 200, body: null, setHeader: jest.fn() };
  r.status = jest.fn((c: number) => { r.statusCode = c; return r; });
  r.json = jest.fn((b: unknown) => { r.body = b; return r; });
  await fn({ userId: 'me', params: { id: T }, query: {}, body } as any, r);
  return r;
};
const writes = () => mockLog.filter((q) => q.some((c) => /^(insert|update|upsert|delete):/.test(c)));
const written = (table: string) => {
  const q = mockLog.find((x) => x[0] === `from:${table}` && x.some((c) => /^(insert|update):/.test(c)));
  const c = q?.find((x) => /^(insert|update):/.test(x));
  if (!c) return null;
  const v = JSON.parse(c.slice(c.indexOf(':') + 1));
  return c.startsWith('update:') ? v[0] : v; // the mock logs update's arguments as an array
};
const create = (extra: object) => ({
  sport_id: 'sp', name: 'P3 Home Away Cup', max_teams: 4, entry_fee: 0, start_date: '2026-10-05', ...extra,
});
beforeEach(() => {
  mockLog = [];
  mockNext = (q) => {
    if (q[0] === 'from:tournaments' && q.some((c) => c.startsWith('insert:'))) return { data: { id: T } };
    if (q[0] === 'from:tournaments' && q.some((c) => c.startsWith('update:'))) return { data: { id: T } };
    if (q[0] === 'from:tournaments') return { data: null };
    return { data: null };
  };
});

describe('BUILD 1.11 · home_away follows the format', () => {
  test.each([['league', true], ['round_robin', false], ['knockout', false], ['groups_knockout', false], ['LEAGUE', true]])('%s → %s', (f, v) => {
    expect(homeAwayFor(f)).toBe(v);
  });

  test.each([
    ['round_robin', true], ['knockout', true], ['groups_knockout', true], ['league', false], ['league', 'yes'],
  ])('create %s with home_away %p → 400 HOME_AWAY_MISMATCH, nothing written', async (format, home_away) => {
    const r = await run(createTournament, create({ format, home_away }));
    expect([r.statusCode, r.body.code]).toEqual([400, 'HOME_AWAY_MISMATCH']);
    expect(writes()).toHaveLength(0);
  });

  test.each([['league', undefined, true], ['league', true, true], ['round_robin', undefined, false], ['round_robin', false, false]])(
    'create %s (home_away %p) stores %p', async (format, home_away, stored) => {
      const r = await run(createTournament, create({ format, ...(home_away === undefined ? {} : { home_away }) }));
      expect(r.statusCode).toBeLessThan(300);
      expect(written('tournaments').home_away).toBe(stored);
    },
  );

  const existing = (extra: object) => (q: Q) => {
    if (q[0] === 'from:tournaments' && q.some((c) => c.startsWith('update:'))) return { data: { id: T } };
    if (q[0] === 'from:tournaments') return { data: { id: T, created_by: 'me', status: 'upcoming', name: 'P3 Cup', format: 'round_robin', fixtures_generated: false, ...extra } };
    return { data: null };
  };
  test('edit: home_away true on a round robin → 400, nothing written', async () => {
    mockNext = existing({});
    const r = await run(updateTournament, { home_away: true });
    expect([r.statusCode, r.body.code]).toEqual([400, 'HOME_AWAY_MISMATCH']);
    expect(writes()).toHaveLength(0);
  });
  test('edit: round robin → league (before the draw) stores home_away true with it', async () => {
    mockNext = existing({});
    const r = await run(updateTournament, { format: 'league' });
    expect(r.statusCode).toBe(200);
    expect(written('tournaments')).toMatchObject({ format: 'league', home_away: true });
  });
  test('edit: a rename leaves home_away alone', async () => {
    mockNext = existing({});
    await run(updateTournament, { name: 'P3 Cup Renamed' });
    expect(written('tournaments')).not.toHaveProperty('home_away');
  });
});
