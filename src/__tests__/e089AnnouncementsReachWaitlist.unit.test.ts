/** E-089 (Round 6): an announcement (a court change) reached approved and pending entrants but not the WAITLISTED, who may yet be moved into the draw. */
import { fakeDb } from './helpers/fakeSupabase';

const id = (n: number) => `e0890000-cdcd-4dcd-8dcd-${String(n).padStart(12, '0')}`;
const T = id(1); const ORG = id(2); const IN = id(3); const WAIT = id(4); const GONE = id(5);
const mk = () => fakeDb({
  tournaments: [{ id: T, name: 'Thane Open', created_by: ORG, parent_id: null, is_parent: false }],
  tournament_organisers: [], tournament_officials: [],
  tournament_entries: [
    { id: 'x1', tournament_id: T, team_id: 'ta', status: 'approved' },
    { id: 'x2', tournament_id: T, team_id: 'tb', status: 'waitlisted' },
    { id: 'x3', tournament_id: T, team_id: 'tc', status: 'withdrawn' },
  ],
  team_members: [{ team_id: 'ta', user_id: IN }, { team_id: 'tb', user_id: WAIT }, { team_id: 'tc', user_id: GONE }],
  users: [{ id: ORG, name: 'Org' }],
  tournament_announcements: [],
});
let db = mk();
jest.mock('../utils/supabase', () => ({ get supabase() { return db.client; } }));
const sent: string[][] = [];
jest.mock('../utils/notify', () => ({ notifyUsers: jest.fn(async (ids: string[]) => { sent.push(ids); }) }));
// eslint-disable-next-line import/first
import { postAnnouncement } from '../controllers/announcements.controller';

test('the waitlisted are told; the withdrawn are not', async () => {
  db = mk(); sent.length = 0;
  const r: any = { statusCode: 200, body: null };
  r.status = jest.fn((c: number) => { r.statusCode = c; return r; });
  r.json = jest.fn((b: unknown) => { r.body = b; return r; });
  await postAnnouncement({ userId: ORG, params: { id: T }, body: { body: 'Court 3 moves to Hall B.' }, query: {} } as any, r);
  expect(r.statusCode).toBe(201);
  expect(sent[0]!.sort()).toEqual([IN, WAIT].sort());
});
