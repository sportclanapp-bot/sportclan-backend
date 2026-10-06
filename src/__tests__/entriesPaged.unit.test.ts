/**
 * Oct 2026 (Dipak: no full download) · an app that pages entries
 * (X-Client-Features: entries_paged) gets the counts and only the entries it
 * needs with the tournament (the viewer's own, the champion's); the list
 * comes a page at a time from GET /tournaments/:id/entries. An older app still
 * gets every entry — all 1200 of them, past the 1000-row limit.
 */
import { fakeDb } from './helpers/fakeSupabase';

const id = (n: number) => `cdcdcdcd-cdcd-4dcd-8dcd-${String(n).padStart(12, '0')}`;
const T = id(1); const ME = id(2); const ORG = id(3);
const team = (i: number) => id(10_000 + i);
const N = 1200;
const mkDb = () => fakeDb({
  tournaments: [{ id: T, name: 'P3 Big', status: 'upcoming', format: 'groups_knockout', created_by: ORG, champion_team_id: null, parent_id: null, is_parent: false }],
  tournament_entries: Array.from({ length: N }, (_, i) => ({
    id: id(20_000 + i), tournament_id: T, team_id: team(i),
    status: i < 1100 ? 'approved' : i < 1150 ? 'pending' : 'withdrawn',
    seed: null, group_label: i < 1100 ? (i % 2 ? 'A' : 'B') : null, club: null,
    entered_at: new Date(Date.UTC(2026, 9, 1, 0, 0, i)).toISOString(), fee_paid_at: i < 300 ? '2026-10-02T00:00:00Z' : null,
    // the embedded team → members join (the real database resolves it)
    mem: { m: [5, 1120].includes(i) ? [{ user_id: ME }] : [] },
  })),
  team_members: [{ id: id(30_000), team_id: team(5), user_id: ME }, { id: id(30_001), team_id: team(1120), user_id: ME }],
  matches: [],
}, { maxRows: 1000 });
let db = mkDb();
jest.mock('../utils/supabase', () => ({ get supabase() { return db.client; } }));
jest.mock('../utils/tournamentAuth', () => ({ ...jest.requireActual('../utils/tournamentAuth'), isTournamentOrganiser: jest.fn(async (_t: string, u: string) => u === ORG) }));
jest.mock('../utils/tournamentChat', () => ({ canOpenTournamentChat: jest.fn(async () => true), syncTournamentChatMembers: jest.fn(), syncAfterSuccess: jest.fn() }));

// eslint-disable-next-line import/first
import { getTournament, getEntriesPage } from '../controllers/tournaments.controller';

const run = async (fn: any, userId: string, extra: object = {}) => {
  const r: any = { statusCode: 200, body: null, setHeader: jest.fn() };
  r.status = jest.fn((c: number) => { r.statusCode = c; return r; });
  r.json = jest.fn((b: unknown) => { r.body = b; return r; });
  await fn({ userId, params: { id: T }, query: {}, headers: {}, ...extra } as any, r);
  return r;
};
beforeEach(() => { db = mkDb(); });

test('an older app: every entry (1200, past the 1000-row limit), no summary', async () => {
  const r = await run(getTournament, ME);
  expect(r.body.entries).toHaveLength(N);
  expect(r.body.entries_paged).toBeUndefined();
});

test('a paging app: the counts and only the viewer’s own entries', async () => {
  const r = await run(getTournament, ME, { headers: { 'x-client-features': 'events,pairs,entries_paged' } });
  expect(r.body.entries_paged).toBe(true);
  expect(r.body.entry_summary).toMatchObject({ approved: 1100, pending: 50, withdrawn: 50, rejected: 0, total: 1200 });
  expect(r.body.entry_summary.fee_paid).toBeUndefined(); // not the organiser
  expect(r.body.entry_summary.groups.sort((a: any, b: any) => a.label.localeCompare(b.label))).toEqual([{ label: 'A', count: 550 }, { label: 'B', count: 550 }]);
  expect(r.body.entries.map((e: any) => e.team_id).sort()).toEqual([team(5), team(1120)].sort());
  const org = await run(getTournament, ORG, { headers: { 'x-client-features': 'entries_paged' } });
  expect(org.body.entry_summary.fee_paid).toBe(300);
});

test('a page of entries: by status, in entry order, with the total', async () => {
  const p1 = await run(getEntriesPage, ME, { query: { status: 'approved', limit: '50' } });
  expect(p1.body.entries).toHaveLength(50);
  expect(p1.body).toMatchObject({ total: 1100, has_more: true });
  expect(p1.body.entries[0].team_id).toBe(team(0));
  const last = await run(getEntriesPage, ME, { query: { status: 'approved', offset: '1050', limit: '100' } });
  expect(last.body.entries).toHaveLength(50);
  expect(last.body.has_more).toBe(false);
  expect(last.body.entries.at(-1).team_id).toBe(team(1099));
  const pend = await run(getEntriesPage, ME, { query: { status: 'pending' } });
  expect(pend.body).toMatchObject({ total: 50, has_more: false });
  expect((await run(getEntriesPage, ME, { query: { status: 'nope' } })).statusCode).toBe(400);
  // the page size is capped at 100 (paging, not a cap on entries)
  expect((await run(getEntriesPage, ME, { query: { status: 'approved', limit: '5000' } })).body.entries).toHaveLength(100);
});
