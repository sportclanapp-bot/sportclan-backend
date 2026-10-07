/**
 * Stage 9 · T13 · a full event's waitlist (every sport): entries wait in
 * order; a withdrawal, a refusal or a bigger draw moves the first one up (in
 * for an open event, else to approval) and tells them; never after the draw.
 * Turned off, a full event refuses, as before.
 */
import { fakeDb } from './helpers/fakeSupabase';

const ORG = 'bbbbbbbb-bbbb-4bbb-8bbb-000000000001';
const U = (n: number) => `bbbbbbbb-bbbb-4bbb-8bbb-0000000000${String(n).padStart(2, '0')}`;
const SID = 'sport-tn';
const MS = 'bbbbbbbb-bbbb-4bbb-8bbb-000000000099';
const mk = (settings: object = { v: 1 }) => fakeDb({
  users: [ORG, U(2), U(3), U(4), U(5)].map((id, i) => ({ id, name: `P${i}`, username: `p${i}`, gender: 'male', dob: '1990-01-01' })),
  tournaments: [{ id: MS, name: 'Pune Open · MS', status: 'upcoming', sport_id: SID, max_teams: 2, created_by: ORG, settings, start_date: '2026-11-07', entry_kind: 'singles', fixtures_generated: false }],
});
let db = mk();
jest.mock('../utils/supabase', () => ({ get supabase() { return db.client; } }));
const told: Array<{ ids: string[]; type: string; title: string }> = [];
jest.mock('../utils/notify', () => ({
  notifyUnlessBlocked: jest.fn(), notifyUser: jest.fn(), matchAudienceIds: jest.fn(async () => []),
  notifyUsers: jest.fn(async (ids: string[], n: { type: string; title: string }) => { told.push({ ids, type: n.type, title: n.title }); }),
}));
jest.mock('../utils/blocks', () => ({ isBlockedBetween: jest.fn(async () => false), blockedUserIds: jest.fn(async () => new Set()) }));
jest.mock('../utils/tournamentChat', () => ({ syncTournamentChatMembers: jest.fn(), syncAfterSuccess: jest.fn(), canOpenTournamentChat: jest.fn(async () => false) }));
// eslint-disable-next-line import/first
import { enterSelf } from '../controllers/pairEntries.controller';
// eslint-disable-next-line import/first
import { updateEntry } from '../controllers/tournaments.controller';
// eslint-disable-next-line import/first
import { promoteWaitlist } from '../utils/waitlist';

const run = async (fn: any, userId: string, params: object, body: object = {}) => {
  const r: any = { statusCode: 200, body: null, setHeader: jest.fn(), on: jest.fn(), once: jest.fn() };
  r.status = jest.fn((c: number) => { r.statusCode = c; return r; });
  r.json = jest.fn((b: unknown) => { r.body = b; return r; });
  await fn({ userId, params, query: {}, body, headers: {} } as any, r);
  return r;
};
const statuses = () => db.t('tournament_entries').map((e: any) => e.status);
beforeEach(() => { db = mk(); told.length = 0; });

test('full: the 3rd and 4th wait, in order; a withdrawal moves the 3rd up to approval and tells them', async () => {
  for (const n of [2, 3, 4, 5]) await run(enterSelf, U(n), { id: MS });
  expect(statuses()).toEqual(['pending', 'pending', 'waitlisted', 'waitlisted']);
  const first = db.t('tournament_entries')[0] as any;
  const w = await run(updateEntry, U(2), { id: MS, entryId: first.id }, { status: 'withdrawn' });
  expect(w.statusCode).toBe(200);
  expect(statuses()).toEqual(['withdrawn', 'pending', 'pending', 'waitlisted']);
  expect(told.find((t) => t.type === 'waitlist_in')).toMatchObject({ ids: [U(4)], title: 'Off the waitlist · Pune Open · MS' });
});

test('an open event moves them straight in; a bigger draw moves several; never after the draw', async () => {
  db = mk({ v: 1, entry: 'open' });
  for (const n of [2, 3, 4, 5]) await run(enterSelf, U(n), { id: MS });
  expect(statuses()).toEqual(['approved', 'approved', 'waitlisted', 'waitlisted']);
  (db.t('tournaments')[0] as any).max_teams = 4;
  expect((await promoteWaitlist(MS)).length).toBe(2);
  expect(statuses()).toEqual(['approved', 'approved', 'approved', 'approved']);
  db = mk();
  for (const n of [2, 3, 4]) await run(enterSelf, U(n), { id: MS });
  (db.t('tournaments')[0] as any).fixtures_generated = true;
  (db.t('tournaments')[0] as any).max_teams = 8;
  expect(await promoteWaitlist(MS)).toEqual([]);
});

test('turned off: full refuses, as before', async () => {
  db = mk({ v: 1, waitlist: false });
  for (const n of [2, 3]) await run(enterSelf, U(n), { id: MS });
  expect((await run(enterSelf, U(4), { id: MS })).body.code).toBe('TOURNAMENT_FULL');
});

test('waiting counts as entered: no second entry', async () => {
  for (const n of [2, 3, 4]) await run(enterSelf, U(n), { id: MS });
  expect((await run(enterSelf, U(4), { id: MS })).body.code).toBe('ALREADY_ENTERED');
});
