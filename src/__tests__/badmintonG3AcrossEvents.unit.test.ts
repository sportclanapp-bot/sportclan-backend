/**
 * Badminton gap 3 (Oct 2026) · across the events of one tournament:
 *  - a limit on how many events a player may enter (BAI Masters: 1 singles,
 *    1 doubles, 1 mixed), checked for a player, a pair or a team;
 *  - one schedule over the shared courts: an event's draw doesn't take a court
 *    another event holds, and a player in two events is never on two courts at
 *    once, with the rest between their matches — per player, not per team.
 */
import { fakeDb } from './helpers/fakeSupabase';
import { buildSchedule, absMinutesOf, type SchedulingConfig } from '../utils/scheduleFixtures';
import { eventClass, eventLimitsRefusal, storedEventLimits, limitsLine } from '../utils/eventLimits';

const P = 'bbbbbbbb-bbbb-4bbb-8bbb-000000000001';
const MS = 'bbbbbbbb-bbbb-4bbb-8bbb-000000000002';
const MS2 = 'bbbbbbbb-bbbb-4bbb-8bbb-000000000003';
const MD = 'bbbbbbbb-bbbb-4bbb-8bbb-000000000004';
const XD = 'bbbbbbbb-bbbb-4bbb-8bbb-000000000005';
const RAVI = 'bbbbbbbb-bbbb-4bbb-8bbb-000000000011';
const AMIT = 'bbbbbbbb-bbbb-4bbb-8bbb-000000000012';
const PRIYA = 'bbbbbbbb-bbbb-4bbb-8bbb-000000000013';
const ORG = 'bbbbbbbb-bbbb-4bbb-8bbb-000000000019';
const ev = (id: string, label: string, kind: string, settings: object = { v: 1 }) =>
  ({ id, name: `Open · ${label}`, parent_id: P, entry_kind: kind, status: 'upcoming', sport_id: 's', max_teams: 16, created_by: ORG, settings, start_date: '2026-11-07', fixtures_generated: false });
const mkDb = (limits: object | null = { singles: 1, doubles: 1, mixed: 1 }) => fakeDb({
  users: [
    { id: RAVI, name: 'Ravi', gender: 'male', dob: '1990-01-01' },
    { id: AMIT, name: 'Amit', gender: 'male', dob: '1990-01-01' },
    { id: PRIYA, name: 'Priya', gender: 'female', dob: '1990-01-01' },
    { id: ORG, name: 'Org', gender: 'male', dob: '1980-01-01' },
  ],
  tournaments: [
    { id: P, name: 'Open', is_parent: true, status: 'upcoming', created_by: ORG, settings: limits ? { v: 1, eventLimits: limits } : null },
    ev(MS, 'MS', 'singles'), ev(MS2, 'MS 35+', 'singles'), ev(MD, 'MD', 'doubles'), ev(XD, 'XD', 'doubles', { v: 1, category: { gender: 'mixed' } }),
  ],
});
let db = mkDb();
jest.mock('../utils/supabase', () => ({ get supabase() { return db.client; } }));
jest.mock('../utils/notify', () => ({ notifyUnlessBlocked: jest.fn(), notifyUser: jest.fn(), notifyUsers: jest.fn(), matchAudienceIds: jest.fn(async () => []) }));
jest.mock('../utils/blocks', () => ({ isBlockedBetween: jest.fn(async () => false), blockedUserIds: jest.fn(async () => new Set()) }));
jest.mock('../utils/tournamentChat', () => ({ syncTournamentChatMembers: jest.fn(), syncAfterSuccess: jest.fn(), canOpenTournamentChat: jest.fn(async () => false) }));

// eslint-disable-next-line import/first
import { enterSelf, addPlayersEntry } from '../controllers/pairEntries.controller';
// eslint-disable-next-line import/first
import { sharedScheduleFor } from '../utils/sharedCourts';

const run = async (fn: any, userId: string, params: object, body: object = {}) => {
  const r: any = { statusCode: 200, body: null, setHeader: jest.fn(), on: jest.fn(), once: jest.fn() };
  r.status = jest.fn((c: number) => { r.statusCode = c; return r; });
  r.json = jest.fn((b: unknown) => { r.body = b; return r; });
  await fn({ userId, params, query: {}, body, headers: {} } as any, r);
  return r;
};

describe('a limit on events per player', () => {
  beforeEach(() => { db = mkDb(); });
  test('one singles: the second singles is refused by name; doubles and mixed are still open', async () => {
    expect((await run(enterSelf, RAVI, { id: MS })).statusCode).toBe(200);
    const second = await run(enterSelf, RAVI, { id: MS2 });
    expect(second.statusCode).toBe(409);
    expect(second.body).toMatchObject({ code: 'EVENT_LIMIT', error: 'Ravi is already in 1 singles event — this tournament allows 1 per player.', user_id: RAVI });
    expect((await run(addPlayersEntry, ORG, { id: MD }, { user_ids: [RAVI, AMIT] })).statusCode).toBe(200);
    expect((await run(addPlayersEntry, ORG, { id: XD }, { user_ids: [RAVI, PRIYA] })).statusCode).toBe(200);
  });
  test('a total, counted across every kind', async () => {
    db = mkDb({ total: 2 });
    await run(enterSelf, RAVI, { id: MS });
    await run(addPlayersEntry, ORG, { id: MD }, { user_ids: [RAVI, AMIT] });
    const third = await run(addPlayersEntry, ORG, { id: XD }, { user_ids: [PRIYA, RAVI] });
    expect(third.body).toMatchObject({ code: 'EVENT_LIMIT', error: 'Ravi is already in 2 events — this tournament allows 2 per player.' });
  });
  test('no limit set: any number', async () => {
    db = mkDb(null);
    await run(enterSelf, RAVI, { id: MS });
    expect((await run(enterSelf, RAVI, { id: MS2 })).statusCode).toBe(200);
  });
  test('a withdrawn entry doesn’t count', async () => {
    await run(enterSelf, RAVI, { id: MS });
    db.t('tournament_entries')[0].status = 'withdrawn';
    expect((await run(enterSelf, RAVI, { id: MS2 })).statusCode).toBe(200);
  });
  test('the kinds, the checks and the words', () => {
    expect(eventClass({ entry_kind: 'doubles', settings: { category: { gender: 'mixed' } } })).toBe('mixed');
    expect(eventClass({ entry_kind: 'doubles', settings: null })).toBe('doubles');
    expect(eventClass({ entry_kind: 'team' })).toBe('team');
    expect(eventLimitsRefusal({ singles: 0 })!.code).toBe('BAD_EVENT_LIMITS');
    expect(eventLimitsRefusal({ triples: 1 })!.code).toBe('BAD_EVENT_LIMITS');
    expect(eventLimitsRefusal({ singles: 1, total: null })).toBeNull();
    expect(storedEventLimits({ singles: 1, doubles: null })).toEqual({ singles: 1 });
    expect(storedEventLimits({})).toBeNull();
    expect(limitsLine({ singles: 1, doubles: 1, mixed: 1 })).toBe('Up to 1 singles, 1 doubles and 1 mixed doubles events, per player');
    expect(limitsLine({ total: 2 })).toBe('Up to 2 events in all, per player');
    expect(limitsLine({ singles: 1 })).toBe('Up to 1 singles event, per player');
  });
});

describe('one schedule over the shared courts', () => {
  const cfg = (over: Partial<SchedulingConfig> = {}): SchedulingConfig => ({
    startDateYmd: '2026-11-07', endDateYmd: '2026-11-07', dailyStartMin: 9 * 60, dailyEndMin: 12 * 60,
    durationMin: 30, bufferMin: 0, groundCount: 2, groundNames: ['Court 1', 'Court 2'], bounded: true, ...over,
  });
  const at = (iso: string) => absMinutesOf(iso, '2026-11-07');
  test('the clock: 09:00 IST on the start date is minute 540', () => {
    expect(absMinutesOf('2026-11-07T03:30:00.000Z', '2026-11-07')).toBe(540);
  });
  test('a court another event holds is skipped', () => {
    const r = buildSchedule([{ round: 1, match_no: 1, team_a_id: 'a', team_b_id: 'b' }, { round: 1, match_no: 2, team_a_id: 'c', team_b_id: 'd' }],
      cfg({ busyGrounds: [{ ground: 'Court 1', start: 540, end: 570 }] }));
    expect(r.ok).toBe(true);
    const a = (r as any).assignments;
    expect(a.get('1:1')).toEqual({ scheduled_at: '2026-11-07T03:30:00.000Z', ground_label: 'Court 2' });
    expect(at(a.get('1:2').scheduled_at)).toBe(570);
  });
  test('a player busy in another event isn’t put on court then — nor in their rest after', () => {
    const playersOf = new Map([['pairA', ['ravi', 'amit']], ['pairB', ['x', 'y']]]);
    const playerBusy = new Map<string, Array<[number, number]>>([['ravi', [[540, 570]]]]);
    const r = buildSchedule([{ round: 1, match_no: 1, team_a_id: 'pairA', team_b_id: 'pairB' }], cfg({ playersOf, playerBusy, restMin: 30 }));
    // 09:00 he's playing singles, 09:30–10:00 is his rest: 10:00
    expect(at((r as any).assignments.get('1:1').scheduled_at)).toBe(600);
    const noRest = buildSchedule([{ round: 1, match_no: 1, team_a_id: 'pairA', team_b_id: 'pairB' }], cfg({ playersOf, playerBusy }));
    expect(at((noRest as any).assignments.get('1:1').scheduled_at)).toBe(570);
  });
  test('per player within the draw too: two pairs sharing nobody can play at once', () => {
    const playersOf = new Map([['p1', ['a']], ['p2', ['b']], ['p3', ['c']], ['p4', ['d']]]);
    const r = buildSchedule([{ round: 1, match_no: 1, team_a_id: 'p1', team_b_id: 'p2' }, { round: 1, match_no: 2, team_a_id: 'p3', team_b_id: 'p4' }],
      cfg({ playersOf, playerBusy: new Map() }));
    const a = (r as any).assignments;
    expect(at(a.get('1:1').scheduled_at)).toBe(at(a.get('1:2').scheduled_at));
  });
  test('when it can’t fit, it says the courts are shared', () => {
    const r = buildSchedule([{ round: 1, match_no: 1, team_a_id: 'a', team_b_id: 'b' }],
      cfg({ dailyEndMin: 9 * 60 + 30, busyGrounds: [{ ground: 'Court 1', start: 540, end: 570 }, { ground: 'Court 2', start: 540, end: 570 }] }));
    expect(r.ok).toBe(false);
    expect((r as any).error).toMatch(/courts are shared with the tournament’s other events/);
  });
  test('the sibling events’ slots and players, read for a draw', async () => {
    db = mkDb(null);
    db.t('matches').push(
      { tournament_id: MS, scheduled_at: '2026-11-07T03:30:00.000Z', ground_label: 'Court 1', team_a_id: 'tR', team_b_id: 'tA', status: 'scheduled', voided_at: null },
      { tournament_id: MS, scheduled_at: '2026-11-07T04:00:00.000Z', ground_label: 'Court 2', team_a_id: 'tR', team_b_id: 'tA', status: 'completed', voided_at: null },
      { tournament_id: MD, scheduled_at: '2026-11-07T04:30:00.000Z', ground_label: 'Court 2', team_a_id: 'x', team_b_id: 'y', status: 'scheduled', voided_at: '2026-11-01T00:00:00Z' },
    );
    db.t('team_members').push({ team_id: 'tR', user_id: RAVI }, { team_id: 'tA', user_id: AMIT }, { team_id: 'own', user_id: RAVI });
    db.t('tournaments').forEach((x) => { x.match_duration_minutes = 30; });
    const s = await sharedScheduleFor({ id: XD, parent_id: P }, ['own'], '2026-11-07', 30);
    expect(s!.busyGrounds).toEqual([{ ground: 'Court 1', start: 540, end: 570 }]);
    expect(s!.playerBusy.get(RAVI)).toEqual([[540, 570]]);
    expect(s!.playersOf.get('own')).toEqual([RAVI]);
    expect(await sharedScheduleFor({ id: 'solo', parent_id: null }, [], '2026-11-07', 30)).toBeNull();
  });
});
