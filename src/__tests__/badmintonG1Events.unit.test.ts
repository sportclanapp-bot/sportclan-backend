/**
 * Badminton gap 1 (Oct 2026) · events inside a tournament.
 *
 * A tournament made of events is a parent row (is_parent) with one row per
 * event (parent_id). The parent holds what the events share; each event its
 * own format, size, category, rules and fee. Older apps never see the parent:
 * lists give them each event as a tournament of its own.
 */
let mockOrganiser = true;
type Q = string[];
let mockLog: Q[] = [];
let mockNext: (q: Q) => { data?: unknown; error?: unknown; count?: number } = () => ({ data: null, error: null });
jest.mock('../utils/supabase', () => {
  const start = (t: string) => {
    const q: string[] = [`from:${t}`];
    mockLog.push(q);
    const chain: any = {};
    for (const m of ['select', 'in', 'not', 'eq', 'neq', 'is', 'limit', 'maybeSingle', 'single', 'update', 'delete', 'order', 'or', 'ilike', 'range', 'gte', 'gt', 'lt', 'lte', 'upsert']) {
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
  isTournamentOrganiser: jest.fn(async () => mockOrganiser),
  authorizeCarveout: jest.fn(async () => ({ ok: true, viaAdmin: false })),
  logAdminAction: jest.fn(),
}));
jest.mock('../utils/teamVisibility', () => ({ ...jest.requireActual('../utils/teamVisibility'), isTeamDisbanded: jest.fn(async () => false) }));
jest.mock('../utils/tournamentChat', () => ({
  syncTournamentChatMembers: jest.fn(async () => undefined),
  syncAfterSuccess: jest.fn(),
  canOpenTournamentChat: jest.fn(async () => false),
}));
jest.mock('../utils/testContent', () => ({ hideTestFor: jest.fn(async () => false), excludeTest: (q: unknown) => q, testUserIdSet: jest.fn(async () => new Set()) }));
jest.mock('../utils/sports', () => ({ ...jest.requireActual('../utils/sports'), validateSportForCreate: jest.fn(async () => null) }));
jest.mock('../utils/sportId', () => ({ resolveSportId: jest.fn(async () => undefined) }));
let mockSportSlug = 'badminton';
jest.mock('../utils/sportCache', () => ({ ...jest.requireActual('../utils/sportCache'), getSport: jest.fn(async () => ({ slug: mockSportSlug })) }));
jest.mock('../utils/notify', () => ({
  notifyUser: jest.fn(), notifyUsers: jest.fn(), notifyUnlessBlocked: jest.fn(), sendPushToUsers: jest.fn(), allowedRecipients: jest.fn(async () => []),
  matchAudienceIds: jest.fn(async () => []), matchFollowerIds: jest.fn(async () => []),
}));
jest.mock('../utils/teamAuth', () => ({ ...jest.requireActual('../utils/teamAuth'), isTeamManager: jest.fn(async () => true) }));

// eslint-disable-next-line import/first
import {
  createTournament, listTournaments, getTournament, createEntry, generateFixtures, updateTournament, addEvents, entryCheck,
} from '../controllers/tournaments.controller';
// eslint-disable-next-line import/first
import { parentStatusOf, eventName, eventsListRefusal, entryKindsFor, sameSharedValue, clientHas } from '../utils/tournamentEvents';

const P = '11111111-1111-4111-8111-111111111111';
const E1 = '22222222-2222-4222-8222-222222222222';
const E2 = '33333333-3333-4333-8333-333333333333';
const TEAM = '44444444-4444-4444-8444-444444444444';
const has = (q: Q, s: string) => q.some((c) => c.startsWith(s));
const arg = (q: Q, m: string) => JSON.parse(q.find((c) => c.startsWith(`${m}:`))!.slice(m.length + 1));
const run = async (fn: any, req: object) => {
  const r: any = { statusCode: 200, body: null, setHeader: jest.fn(), on: jest.fn(), once: jest.fn() };
  r.status = jest.fn((c: number) => { r.statusCode = c; return r; });
  r.json = jest.fn((b: unknown) => { r.body = b; return r; });
  await fn({ userId: 'me', params: {}, query: {}, body: {}, headers: {}, ...req } as any, r);
  return r;
};
const inserts = (table: string) => mockLog.filter((q) => q[0] === `from:${table}` && has(q, 'insert:')).map((q) => arg(q, 'insert'));
const updates = (table: string) => mockLog.filter((q) => q[0] === `from:${table}` && has(q, 'update:')).map((q) => ({ set: arg(q, 'update')[0], q }));

beforeEach(() => { mockOrganiser = true; mockSportSlug = 'badminton'; mockLog = []; });

const OPEN = {
  sport_id: 'bd', name: 'P3 Sunday Open', venue: 'Koramangala Indoor', start_date: '2026-11-07', end_date: '2026-11-08',
  ground_count: 4, ground_names: ['Court 1', 'Court 2', 'Court 3', 'Court 4'], daily_start_time: '08:00', entry_fee: 500,
};
const EVENTS = [
  { label: 'Men’s singles', entry_kind: 'singles', format: 'knockout', max_teams: 32, entry_fee: 750, settings: { category: { gender: 'men' } } },
  { label: 'Mixed doubles', entry_kind: 'doubles', format: 'groups_knockout', max_teams: 16 },
];

describe('creating a tournament made of events', () => {
  const create = (body: object) => {
    mockNext = (q) => {
      if (q[0] === 'from:tournaments' && has(q, 'insert:')) {
        const rows = arg(q, 'insert');
        if (Array.isArray(rows)) return { data: rows.map((r: any, i: number) => ({ ...r, id: [E1, E2][i] })) };
        return { data: { ...rows, id: P } };
      }
      if (q[0] === 'from:chats') return { data: { id: 'chat-1' } };
      return { data: null };
    };
    return run(createTournament, { body });
  };
  test('the parent takes the shared details; each event its own, named "Parent · Event"', async () => {
    const r = await create({ ...OPEN, events: EVENTS });
    expect(r.statusCode).toBe(200);
    const [parent, events] = inserts('tournaments');
    expect(parent).toMatchObject({ name: 'P3 Sunday Open', is_parent: true, max_teams: null, settings: null, match_rules: null, venue: 'Koramangala Indoor', created_by: 'me' });
    expect(events).toHaveLength(2);
    expect(events[0]).toMatchObject({
      parent_id: P, event_label: 'Men’s singles', event_order: 0, entry_kind: 'singles', name: 'P3 Sunday Open · Men’s singles',
      format: 'knockout', max_teams: 32, entry_fee: 750, venue: 'Koramangala Indoor', start_date: '2026-11-07', ground_count: 4,
      ground_names: ['Court 1', 'Court 2', 'Court 3', 'Court 4'], created_by: 'me', sport_metadata: { _chat_id: 'chat-1' },
    });
    expect(events[0].settings).toMatchObject({ category: { gender: 'men' } });
    // no fee of its own → the tournament's; each event its own join code
    expect(events[1]).toMatchObject({ event_label: 'Mixed doubles', event_order: 1, entry_kind: 'doubles', entry_fee: 500, format: 'groups_knockout' });
    expect(events[0].entry_code).toEqual(expect.any(String));
    expect(events[0].entry_code).not.toBe(events[1].entry_code);
    expect(events[0]).not.toHaveProperty('is_parent');
    // one chat for the whole tournament
    expect(inserts('chats')).toHaveLength(1);
    expect(r.body.tournament.events.map((e: any) => e.id)).toEqual([E1, E2]);
  });
  test('an event that doesn’t pass is refused by name, and nothing is written', async () => {
    const r = await create({ ...OPEN, events: [EVENTS[0], { label: 'Boys U-15', max_teams: 1 }] });
    expect(r.statusCode).toBe(400);
    expect(r.body.error).toMatch(/^Boys U-15: max_teams must be between/);
    expect(inserts('tournaments')).toHaveLength(0);
  });
  test('two events with one name, no events, or doubles in a team sport are refused', async () => {
    expect((await create({ ...OPEN, events: [EVENTS[0], { ...EVENTS[1], label: ' men’s SINGLES ' }] })).body.code).toBe('DUPLICATE_EVENT');
    expect((await create({ ...OPEN, events: [] })).body.code).toBe('BAD_EVENTS');
    mockSportSlug = 'cricket';
    const r = await create({ ...OPEN, events: [{ label: 'Pairs', entry_kind: 'doubles', max_teams: 8, format: 'knockout' }] });
    expect(r.body.code).toBe('BAD_ENTRY_KIND');
    expect(inserts('tournaments')).toHaveLength(0);
  });
  test('gap 3: the tournament keeps its limit of events per player', async () => {
    await create({ ...OPEN, events: EVENTS, event_limits: { singles: 1, doubles: 1, mixed: 1, total: null } });
    expect(inserts('tournaments')[0].settings).toEqual({ v: 1, eventLimits: { singles: 1, doubles: 1, mixed: 1 } });
    const bad = await create({ ...OPEN, events: EVENTS, event_limits: { singles: 0 } });
    expect(bad.body.code).toBe('BAD_EVENT_LIMITS');
  });
  test('an older app’s create is written exactly as before (no parent or entry-kind keys)', async () => {
    mockSportSlug = 'cricket';
    const r = await create({ ...OPEN, format: 'knockout', max_teams: 8 });
    expect(r.statusCode).toBe(200);
    const [row] = inserts('tournaments');
    expect(row).not.toHaveProperty('is_parent');
    expect(row).not.toHaveProperty('entry_kind');
    expect(row).not.toHaveProperty('parent_id');
    expect(row).toMatchObject({ max_teams: 8, format: 'knockout' });
  });
  test('a single tournament can be singles or doubles (badminton), not in cricket', async () => {
    expect((await create({ ...OPEN, format: 'knockout', max_teams: 8, entry_kind: 'doubles' })).statusCode).toBe(200);
    expect(inserts('tournaments')[0]).toMatchObject({ entry_kind: 'doubles' });
    mockSportSlug = 'cricket';
    expect((await create({ ...OPEN, format: 'knockout', max_teams: 8, entry_kind: 'singles' })).body.code).toBe('BAD_ENTRY_KIND');
  });
});

describe('lists: grouped for apps that know events, flat for older apps', () => {
  const list = async (headers: object) => {
    mockLog = [];
    mockNext = (q) => {
      if (q[0] === 'from:tournaments' && has(q, 'range:')) return { data: [{ id: P, name: 'P3 Sunday Open', is_parent: true }, { id: 'x', name: 'Solo Cup', is_parent: false }], count: 2 };
      if (q[0] === 'from:tournaments') return { data: [{ id: E1, parent_id: P, event_label: 'Men’s singles', event_order: 0, entry_kind: 'singles', status: 'upcoming' }] };
      return { data: null };
    };
    return run(listTournaments, { headers });
  };
  test('an older app never gets the parent', async () => {
    await list({});
    const q = mockLog.find((x) => has(x, 'range:'))!;
    expect(arg(q, 'eq')).toEqual(['is_parent', false]);
    expect(has(q, 'is:')).toBe(false);
  });
  test('the new app gets parents (with their events) and no events on their own', async () => {
    const r = await list({ 'x-client-features': 'events,pairs' });
    const q = mockLog.find((x) => has(x, 'range:'))!;
    expect(arg(q, 'is')).toEqual(['parent_id', null]);
    expect(r.body.tournaments[0]).toMatchObject({ events_count: 1, events: [{ id: E1, label: 'Men’s singles', entry_kind: 'singles', status: 'upcoming' }] });
    expect(r.body.tournaments[1]).not.toHaveProperty('events');
  });
});

describe('reading a parent or an event', () => {
  test('a parent lists its events with their entry counts', async () => {
    mockNext = (q) => {
      if (q[0] === 'from:tournaments' && has(q, 'order:')) return { data: [{ id: E1, event_label: 'MS', status: 'live' }, { id: E2, event_label: 'XD', status: 'upcoming' }] };
      if (q[0] === 'from:tournaments' && arg(q, 'eq')[0] === 'parent_id') return { data: [{ status: 'live' }, { status: 'upcoming' }] };
      if (q[0] === 'from:tournaments') return { data: { id: P, name: 'Open', is_parent: true, status: 'upcoming' } };
      if (q[0] === 'from:tournament_entries' && has(q, 'in:')) return { data: [{ tournament_id: E1, status: 'approved' }, { tournament_id: E1, status: 'pending' }] };
      if (q[0] === 'from:tournament_entries') return { data: [] };
      return { data: null, count: 0 };
    };
    const r = await run(getTournament, { params: { id: P } });
    expect(r.body.events.map((e: any) => [e.id, e.entries_count, e.pending_count])).toEqual([[E1, 1, 1], [E2, 0, 0]]);
    // its status follows its events (one is live)
    expect(r.body.tournament.status).toBe('live');
  });
  test('an event names its tournament', async () => {
    mockNext = (q) => {
      if (q[0] === 'from:tournaments' && has(q, 'order:')) return { data: [{ id: E1 }, { id: E2 }] };
      if (q[0] === 'from:tournaments' && arg(q, 'eq')[1] === P) return { data: { id: P, name: 'Open', status: 'live', entry_code: 'ABC' } };
      if (q[0] === 'from:tournaments') return { data: { id: E1, name: 'Open · MS', parent_id: P } };
      return { data: [], count: 0 };
    };
    const r = await run(getTournament, { params: { id: E1 } });
    expect(r.body.parent).toEqual({ id: P, name: 'Open', status: 'live', entry_code: 'ABC' });
    expect(r.body.events).toHaveLength(2);
  });
});

describe('a parent is entered and drawn through its events', () => {
  test('entering the parent (an older app or a stale link) is refused, asking to update', async () => {
    mockNext = (q) => {
      if (q[0] === 'from:team_members') return { data: { role: 'captain' } };
      if (q[0] === 'from:tournaments') return { data: { id: P, status: 'upcoming', is_parent: true } };
      return { data: null };
    };
    const r = await run(createEntry, { params: { id: P }, body: { team_id: TEAM } });
    expect(r.statusCode).toBe(409);
    expect(r.body).toEqual({ error: 'This tournament is made of events. Update SportClan to enter one of them.', code: 'ENTER_AN_EVENT' });
    expect(inserts('tournament_entries')).toHaveLength(0);
  });
  test('the entry check says so beside every team', async () => {
    mockNext = (q) => (q[0] === 'from:tournaments' ? { data: { id: P, status: 'upcoming', is_parent: true } } : { data: [] });
    const r = await run(entryCheck, { params: { id: P }, body: { team_ids: [TEAM] } });
    expect(r.body.teams[0]).toMatchObject({ ok: false, code: 'ENTER_AN_EVENT' });
  });
  test('the draw is made per event', async () => {
    mockNext = (q) => (q[0] === 'from:tournaments' ? { data: { id: P, status: 'upcoming', is_parent: true } } : { data: null });
    const r = await run(generateFixtures, { params: { id: P } });
    expect(r.statusCode).toBe(409);
    expect(r.body.code).toBe('DRAW_PER_EVENT');
    expect(mockLog.filter((q) => q[0] === 'from:matches')).toHaveLength(0);
  });
});

describe('editing', () => {
  const PARENT_ROW = { id: P, name: 'P3 Sunday Open', status: 'upcoming', is_parent: true, created_by: 'me', venue: 'Old Hall', start_date: '2026-11-07', format: 'knockout' };
  const EVENT_ROW = { id: E1, name: 'P3 Sunday Open · MS', status: 'upcoming', parent_id: P, event_label: 'MS', created_by: 'me', venue: 'Old Hall', start_date: '2026-11-07', format: 'knockout', entry_kind: 'singles' };
  const edit = (row: object, body: object, parentRow: object = PARENT_ROW, siblings: object[] = []) => {
    mockLog = [];
    mockNext = (q) => {
      if (q[0] === 'from:tournaments' && has(q, 'update:')) return { data: { ...row, ...arg(q, 'update')[0] } };
      if (q[0] === 'from:tournaments' && arg(q, 'eq')[0] === 'parent_id') return { data: siblings };
      if (q[0] === 'from:tournaments' && arg(q, 'eq')[1] === P && (row as any).id !== P) return { data: parentRow };
      if (q[0] === 'from:tournaments') return { data: row };
      return { data: [], count: 0 };
    };
    return run(updateTournament, { params: { id: (row as any).id }, body });
  };
  test('an event can’t move its venue or dates on its own; unchanged values (older apps) are fine', async () => {
    const r = await edit(EVENT_ROW, { venue: 'New Hall' });
    expect(r.statusCode).toBe(409);
    expect(r.body).toMatchObject({ code: 'SHARED_WITH_EVENTS', field: 'venue' });
    const ok = await edit(EVENT_ROW, { venue: 'Old Hall', start_date: '2026-11-07', description: null, max_teams: 16 });
    expect(ok.statusCode).toBe(200);
    const set = updates('tournaments').find((u) => arg(u.q, 'eq')[1] === E1)!.set;
    expect(set).toMatchObject({ max_teams: 16 });
    expect(set).not.toHaveProperty('venue');
  });
  test('renaming an event renames it "Parent · New label"; two events can’t share a name', async () => {
    await edit(EVENT_ROW, { event_label: ' Men’s singles ' });
    expect(updates('tournaments')[0].set).toMatchObject({ event_label: 'Men’s singles', name: 'P3 Sunday Open · Men’s singles' });
    const dup = await edit(EVENT_ROW, { event_label: 'XD' }, PARENT_ROW, [{ id: E2, event_label: 'xd' }]);
    expect(dup.body.code).toBe('DUPLICATE_EVENT');
  });
  test('the parent’s venue, dates and name reach every event', async () => {
    const r = await edit(PARENT_ROW, { venue: 'New Hall', name: 'P3 Diwali Open' }, PARENT_ROW, [{ id: E1, event_label: 'MS' }]);
    expect(r.statusCode).toBe(200);
    const all = updates('tournaments');
    expect(all.find((u) => arg(u.q, 'eq')[0] === 'parent_id' && u.set.venue)!.set).toEqual({ venue: 'New Hall' });
    expect(all.find((u) => u.set.name === 'P3 Diwali Open · MS')).toBeTruthy();
  });
  test('the parent ignores per-event settings, and can’t be completed while an event is still on', async () => {
    await edit(PARENT_ROW, { max_teams: 8, format: 'league', description: 'Shuttles: Mavis 350' });
    const set = updates('tournaments')[0].set;
    expect(set).not.toHaveProperty('max_teams');
    expect(set).not.toHaveProperty('format');
    expect(set.description).toBe('Shuttles: Mavis 350');
    const r = await edit(PARENT_ROW, { status: 'completed' }, PARENT_ROW, [{ status: 'live' }]);
    expect(r.body.code).toBe('EVENTS_UNFINISHED');
  });
  test('cancelling the tournament cancels its unfinished events', async () => {
    const r = await edit(PARENT_ROW, { status: 'cancelled' }, PARENT_ROW, [{ id: E1, name: 'Open · MS' }]);
    expect(r.statusCode).toBe(200);
    expect(updates('tournaments').some((u) => u.set.status === 'cancelled' && arg(u.q, 'eq')[1] === E1)).toBe(true);
  });
  test('gap 3: the parent changes (or clears) its limit of events per player', async () => {
    await edit({ ...PARENT_ROW, settings: { v: 1, eventLimits: { total: 3 } } }, { event_limits: { singles: 1 } });
    expect(updates('tournaments')[0].set.settings).toEqual({ v: 1, eventLimits: { singles: 1 } });
    await edit({ ...PARENT_ROW, settings: { v: 1, eventLimits: { total: 3 } } }, { event_limits: null });
    expect(updates('tournaments')[0].set.settings).toEqual({ v: 1 });
    expect((await edit(PARENT_ROW, { event_limits: { total: 99 } })).body.code).toBe('BAD_EVENT_LIMITS');
  });
  test('who enters can change only before anyone has entered', async () => {
    const r = await edit({ ...EVENT_ROW, entry_kind: 'team' }, { entry_kind: 'doubles' });
    expect(r.statusCode).toBe(200);
    mockNext = (q) => (q[0] === 'from:tournament_entries' ? { count: 3 } : q[0] === 'from:tournaments' && arg(q, 'eq')[1] === P ? { data: PARENT_ROW } : q[0] === 'from:tournaments' ? { data: { ...EVENT_ROW, entry_kind: 'team' } } : { data: null });
    const locked = await run(updateTournament, { params: { id: E1 }, body: { entry_kind: 'doubles' } });
    expect(locked.body.code).toBe('ENTRY_KIND_LOCKED');
  });
});

describe('adding events later', () => {
  test('appended after the last, checked like the first ones', async () => {
    mockNext = (q) => {
      if (q[0] === 'from:tournaments' && has(q, 'insert:')) return { data: arg(q, 'insert').map((r: any) => ({ ...r, id: E2 })) };
      if (q[0] === 'from:tournaments' && arg(q, 'eq')[0] === 'parent_id') return { data: [{ event_label: 'MS', event_order: 0, status: 'upcoming' }] };
      if (q[0] === 'from:tournaments') return { data: { id: P, name: 'Open', status: 'upcoming', is_parent: true, sport_id: 'bd', format: 'knockout', created_by: 'me', sport_metadata: { _chat_id: 'c' } } };
      return { data: null };
    };
    const r = await run(addEvents, { params: { id: P }, body: { events: [{ label: 'WS', entry_kind: 'singles', max_teams: 16 }] } });
    expect(r.statusCode).toBe(200);
    expect(inserts('tournaments')[0][0]).toMatchObject({ parent_id: P, event_label: 'WS', event_order: 1, name: 'Open · WS', sport_metadata: { _chat_id: 'c' } });
    const dup = await run(addEvents, { params: { id: P }, body: { events: [{ label: 'ms', max_teams: 16 }] } });
    expect(dup.body.code).toBe('DUPLICATE_EVENT');
    mockOrganiser = false;
    expect((await run(addEvents, { params: { id: P }, body: { events: [{ label: 'WD', max_teams: 16 }] } })).statusCode).toBe(403);
  });
});

describe('the rules, on their own', () => {
  test('a parent’s status follows its events', () => {
    expect(parentStatusOf([], 'upcoming')).toBe('upcoming');
    expect(parentStatusOf([{ status: 'upcoming' }, { status: 'upcoming' }], 'upcoming')).toBe('upcoming');
    expect(parentStatusOf([{ status: 'live' }, { status: 'upcoming' }], 'upcoming')).toBe('live');
    expect(parentStatusOf([{ status: 'completed' }, { status: 'upcoming' }], 'upcoming')).toBe('live');
    expect(parentStatusOf([{ status: 'completed' }, { status: 'cancelled' }], 'live')).toBe('completed');
    expect(parentStatusOf([{ status: 'cancelled' }, { status: 'cancelled' }], 'live')).toBe('cancelled');
  });
  test('event names fit the 120-character name', () => {
    expect(eventName('Open', 'MS')).toBe('Open · MS');
    const long = eventName('x'.repeat(120), 'Women’s doubles U-17');
    expect(long.length).toBeLessThanOrEqual(120);
    expect(long.endsWith('… · Women’s doubles U-17')).toBe(true);
  });
  test('up to 40 events', () => {
    expect(eventsListRefusal(Array.from({ length: 40 }, (_, i) => ({ label: `E${i}` })))).toBeNull();
    expect(eventsListRefusal(Array.from({ length: 41 }, (_, i) => ({ label: `E${i}` })))!.code).toBe('BAD_EVENTS');
    expect(eventsListRefusal([{ label: 'B' }], ['A', 'b'])!.code).toBe('DUPLICATE_EVENT');
    expect(eventsListRefusal([{ label: '' }])!.code).toBe('BAD_EVENT_LABEL');
  });
  test('who can enter as one player or a pair', () => {
    expect(entryKindsFor('badminton')).toEqual(['team', 'singles', 'doubles']);
    expect(entryKindsFor('table-tennis')).toEqual(['team', 'singles', 'doubles']);
    expect(entryKindsFor('chess')).toEqual(['team', 'singles']);
    expect(entryKindsFor('cricket')).toEqual(['team']);
  });
  test('an older app sending the shared values back unchanged', () => {
    expect(sameSharedValue('daily_start_time', '08:00', '08:00:00')).toBe(true);
    expect(sameSharedValue('start_date', '2026-11-07', '2026-11-07')).toBe(true);
    expect(sameSharedValue('description', '', null)).toBe(true);
    expect(sameSharedValue('ground_names', ['Court 1'], ['Court 1'])).toBe(true);
    expect(sameSharedValue('ground_count', 4, 3)).toBe(false);
    expect(clientHas({ headers: { 'x-client-features': 'pairs, events' } }, 'events')).toBe(true);
    expect(clientHas({ headers: {} }, 'events')).toBe(false);
  });
});
