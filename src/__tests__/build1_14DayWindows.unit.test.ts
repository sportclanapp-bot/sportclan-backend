/**
 * BUILD 1.14 · per-day playing windows are checked. They were stored as sent —
 * only rows missing a field were dropped, silently — so "25:00", a day that
 * ends before it starts (no slots), a date outside the tournament and the same
 * day twice all went in.
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
import { createTournament } from '../controllers/tournaments.controller';
// eslint-disable-next-line import/first
import { dayWindowsRefusal, tournamentDetailsRefusal } from '../utils/tournamentRules';

const day = (day_date: unknown, start_time: unknown = '09:00', end_time: unknown = '18:00') => ({ day_date, start_time, end_time });

describe('BUILD 1.14 · dayWindowsRefusal', () => {
  test('good windows pass, inside the dates', () => {
    expect(dayWindowsRefusal([day('2026-10-05'), day('2026-10-06', '07:30', '12:00')], '2026-10-05', '2026-10-06')).toBeNull();
    expect(dayWindowsRefusal(undefined)).toBeNull();
    expect(dayWindowsRefusal([])).toBeNull();
  });
  test.each([
    ['not a list', { a: 1 }, 'day_windows must be a list of days.'],
    ['a bad date', [day('2026-02-30')], 'Each day needs a date like 2026-10-05.'],
    ['a missing date', [day(undefined)], 'Each day needs a date like 2026-10-05.'],
    ['25:00', [day('2026-10-05', '25:00')], 'On 2026-10-05, the start must be a time like 09:00.'],
    ['no end', [day('2026-10-05', '09:00', null)], 'On 2026-10-05, the end must be a time like 09:00.'],
    ['end before start', [day('2026-10-05', '18:00', '09:00')], 'On 2026-10-05, play has to end after it starts.'],
    ['end equals start', [day('2026-10-05', '09:00', '09:00')], 'On 2026-10-05, play has to end after it starts.'],
    ['the same day twice', [day('2026-10-05'), day('2026-10-05', '10:00', '11:00')], '2026-10-05 is listed twice.'],
    ['before the start', [day('2026-10-04')], "2026-10-04 is outside the tournament's dates."],
    ['after the end', [day('2026-10-07')], "2026-10-07 is outside the tournament's dates."],
  ])('%s → refused', (_n, w, msg) => {
    expect(dayWindowsRefusal(w, '2026-10-05', '2026-10-06')).toEqual({ error: msg, code: 'INVALID_DAY_WINDOWS' });
  });
  // Oct 2026 (Dipak): no cap on the days — a 90-day league's hours, each day inside its dates.
  test('any number of days', () => {
    const many = Array.from({ length: 90 }, (_, i) => day(new Date(Date.UTC(2026, 9, 1 + i)).toISOString().slice(0, 10)));
    expect(dayWindowsRefusal(many)).toBeNull();
    expect(dayWindowsRefusal(many, '2026-10-01', '2026-12-29')).toBeNull();
  });
  test('an edit checks against the stored dates', () => {
    expect(tournamentDetailsRefusal({ day_windows: [day('2026-10-09')] }, { start_date: '2026-10-05', end_date: '2026-10-06' })?.code).toBe('INVALID_DAY_WINDOWS');
  });
});

describe('BUILD 1.14 · create refuses before saving anything', () => {
  test('a backwards day → 400, no tournament inserted', async () => {
    mockLog = [];
    mockNext = () => ({ data: null });
    const r: any = { statusCode: 200, body: null, setHeader: jest.fn() };
    r.status = jest.fn((c: number) => { r.statusCode = c; return r; });
    r.json = jest.fn((b: unknown) => { r.body = b; return r; });
    await createTournament({ userId: 'me', params: {}, query: {}, body: {
      sport_id: 'sp', name: 'P3 Windows', format: 'league', max_teams: 4, entry_fee: 0,
      start_date: '2026-10-05', end_date: '2026-10-06', day_windows: [day('2026-10-05', '18:00', '09:00')],
    } } as any, r);
    expect([r.statusCode, r.body.code]).toEqual([400, 'INVALID_DAY_WINDOWS']);
    expect(mockLog.some((q) => q.some((c) => c.startsWith('insert:') || c.startsWith('upsert:')))).toBe(false);
  });
});
