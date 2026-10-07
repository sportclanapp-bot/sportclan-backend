/**
 * Stage 8 · F21 · the organiser's announcements, any sport: posted to everyone
 * in the tournament (every event's entrants for a tournament made of events),
 * listed newest first, taken down softly.
 */
import { fakeDb } from './helpers/fakeSupabase';

const id = (n: number) => `cdcdcdcd-cdcd-4dcd-8dcd-${String(n).padStart(12, '0')}`;
const P = id(1); const E1 = id(2); const E2 = id(3); const ORG = id(4); const U1 = id(5); const U2 = id(6); const REF = id(7); const OUT = id(8);
const mk = () => fakeDb({
  tournaments: [
    { id: P, name: 'Pune Open', created_by: ORG, parent_id: null, is_parent: true },
    { id: E1, name: 'Pune Open · U-14', created_by: ORG, parent_id: P, is_parent: false },
    { id: E2, name: 'Pune Open · U-17', created_by: ORG, parent_id: P, is_parent: false },
  ],
  tournament_organisers: [], tournament_officials: [{ tournament_id: P, user_id: REF }],
  tournament_entries: [{ id: 'x1', tournament_id: E1, team_id: 'ta', status: 'approved' }, { id: 'x2', tournament_id: E2, team_id: 'tb', status: 'pending' }, { id: 'x3', tournament_id: E2, team_id: 'tc', status: 'rejected' }],
  team_members: [{ team_id: 'ta', user_id: U1 }, { team_id: 'tb', user_id: U2 }, { team_id: 'tc', user_id: OUT }],
  users: [{ id: ORG, name: 'Org' }],
  tournament_announcements: [],
});
let db = mk();
jest.mock('../utils/supabase', () => ({ get supabase() { return db.client; } }));
const sent: Array<{ ids: string[]; title: string; body: string }> = [];
jest.mock('../utils/notify', () => ({ notifyUsers: jest.fn(async (ids: string[], n: { title: string; body: string }) => { sent.push({ ids, ...n }); }) }));
// eslint-disable-next-line import/first
import { listAnnouncements, postAnnouncement, deleteAnnouncement } from '../controllers/announcements.controller';

const run = async (fn: any, userId: string, params: object, body: object = {}, query: object = {}) => {
  const r: any = { statusCode: 200, body: null };
  r.status = jest.fn((c: number) => { r.statusCode = c; return r; });
  r.json = jest.fn((b: unknown) => { r.body = b; return r; });
  await fn({ userId, params, body, query } as any, r);
  return r;
};
beforeEach(() => { db = mk(); sent.length = 0; });

test('posted on the tournament: every event’s entrants (not the rejected), the officials — not the organiser', async () => {
  const r = await run(postAnnouncement, ORG, { id: P }, { body: '  Pitch 2 is running 20 minutes late.  ' });
  expect([r.statusCode, r.body.told]).toEqual([201, 3]);
  expect(sent[0]!.ids.sort()).toEqual([U1, U2, REF].sort());
  expect(sent[0]!.title).toBe('📣 Pune Open');
  expect(sent[0]!.body).toBe('Pitch 2 is running 20 minutes late.');
});

test('posted on one event: that event’s entrants; an event lists its own and the tournament’s', async () => {
  await run(postAnnouncement, ORG, { id: P }, { body: 'Final at 6 pm' });
  await run(postAnnouncement, ORG, { id: E1 }, { body: 'U-14 kit check at 8' });
  expect(sent[1]!.ids.sort()).toEqual([U1, REF].sort());
  const l = await run(listAnnouncements, U1, { id: E1 });
  expect(l.body.announcements.map((a: any) => [a.body, a.from_tournament]).sort()).toEqual([['Final at 6 pm', true], ['U-14 kit check at 8', false]]);
  expect(l.body.can_post).toBe(false);
});

test('refusals; taken down softly', async () => {
  expect((await run(postAnnouncement, U1, { id: P }, { body: 'x' })).statusCode).toBe(403);
  expect((await run(postAnnouncement, ORG, { id: P }, { body: '   ' })).body.code).toBe('EMPTY');
  expect((await run(postAnnouncement, ORG, { id: P }, { body: 'x'.repeat(1001) })).body.code).toBe('TOO_LONG');
  const p = await run(postAnnouncement, ORG, { id: P }, { body: 'Oops' });
  expect((await run(deleteAnnouncement, U1, { id: P, aid: p.body.announcement.id })).statusCode).toBe(403);
  expect((await run(deleteAnnouncement, ORG, { id: P, aid: p.body.announcement.id })).body.ok).toBe(true);
  expect(db.t('tournament_announcements')).toHaveLength(1); // still there, soft-deleted
  expect((await run(listAnnouncements, ORG, { id: P })).body.announcements).toEqual([]);
});
