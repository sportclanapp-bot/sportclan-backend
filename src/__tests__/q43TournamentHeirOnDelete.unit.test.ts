/**
 * Q43 (Dipak, 21 Nov 2026: B): a tournament's creator deletes their account → each unfinished
 * tournament (and its events) passes to the longest-standing co-organiser still on SportClan, who is
 * told; with none, it goes into the admin queue (content_reports 'tournament') for the admin to decide.
 * Finished tournaments are left as they are.
 */
import fs from 'fs';
import path from 'path';
import { fakeDb } from './helpers/fakeSupabase';

let db = fakeDb({});
jest.mock('../utils/supabase', () => ({ get supabase() { return db.client; } }));
const notifyUsers = jest.fn(async () => undefined);
jest.mock('../utils/notify', () => ({ notifyUsers: (...a: unknown[]) => (notifyUsers as any)(...a) }));
// eslint-disable-next-line import/first
import { handTournamentsOnDelete, ADMIN_QUEUE_REASON } from '../utils/tournamentHeirsOnDelete';

const GONE = 'u-gone'; const OLD = 'u-old'; const NEW = 'u-new'; const DEAD = 'u-dead';
const org = (tid: string, uid: string, at: string) => ({ tournament_id: tid, user_id: uid, created_at: at, role: 'co_organiser' });

beforeEach(() => {
  notifyUsers.mockClear();
  db = fakeDb({
    tournaments: [
      { id: 'T1', name: 'Agra Cup', created_by: GONE, parent_id: null, status: 'live' },
      { id: 'T1e', name: 'Agra Cup · MS', created_by: GONE, parent_id: 'T1', status: 'live' },
      { id: 'T2', name: 'Solo League', created_by: GONE, parent_id: null, status: 'upcoming' },
      { id: 'T3', name: 'Old Cup', created_by: GONE, parent_id: null, status: 'completed' },
    ],
    tournament_organisers: [org('T1', DEAD, '2026-09-01'), org('T1', OLD, '2026-09-05'), org('T1', NEW, '2026-10-01')],
    content_reports: [],
    users: [{ id: GONE, deleted_at: '2026-11-21T00:00:00Z' }, { id: DEAD, deleted_at: '2026-11-01T00:00:00Z' }, { id: OLD, deleted_at: null }, { id: NEW, deleted_at: null }],
  });
});

test('a co-organiser takes over (the longest-standing live one), events too, and is told', async () => {
  const r = await handTournamentsOnDelete(GONE);
  expect(r.handed).toEqual([{ id: 'T1', to: OLD }]);
  const by = Object.fromEntries(db.tables.tournaments.map((t: any) => [t.id, t.created_by]));
  expect([by.T1, by.T1e]).toEqual([OLD, OLD]);
  expect(notifyUsers).toHaveBeenCalledWith([OLD], expect.objectContaining({ type: 'tournament_updated', data: { tournamentId: 'T1' } }));
});
test('with no co-organiser it goes into the admin queue once; a finished one is left alone', async () => {
  const r = await handTournamentsOnDelete(GONE);
  expect(r.queued).toEqual(['T2']);
  expect(db.tables.content_reports).toEqual([expect.objectContaining({ target_type: 'tournament', target_id: 'T2', reporter_id: GONE, reason: ADMIN_QUEUE_REASON })]);
  await handTournamentsOnDelete(GONE);
  expect(db.tables.content_reports.filter((x: any) => x.target_id === 'T2' && !x.resolved)).toHaveLength(1);
  expect(db.tables.tournaments.find((t: any) => t.id === 'T3')?.created_by).toBe(GONE);
});
test('deleteAccount runs it; migration 167 lets the queue hold a tournament; the queue names it', () => {
  expect(fs.readFileSync(path.join(__dirname, '../controllers/account.controller.ts'), 'utf8')).toContain('try { await handTournamentsOnDelete(userId); } catch');
  expect(fs.readFileSync(path.join(__dirname, '../../supabase/migrations/167_admin_queue_tournament.sql'), 'utf8')).toContain("'team', 'tournament'");
  expect(fs.readFileSync(path.join(__dirname, '../controllers/admin.controller.ts'), 'utf8')).toContain("content_preview = t ? `${t.name} · ${t.status}` : null;");
});
