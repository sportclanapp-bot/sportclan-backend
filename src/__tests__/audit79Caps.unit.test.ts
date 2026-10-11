/**
 * Audit #79 (11 Oct 2026, Dipak): the fixed tops go — a match can be set more
 * than a year ahead, a sports list isn't capped at 30 (each must be real), a
 * mark-read batch isn't capped at 500, and the tournament sweep reaches every
 * tournament due, not the first 200. Kept (Dipak's choice): 20 mentions, 20
 * forwards, 4 photos a wall post.
 */
import { fakeDb } from './helpers/fakeSupabase';

let db = fakeDb();
jest.mock('../utils/supabase', () => ({ get supabase() { return db.client; } }));
// eslint-disable-next-line import/first
import { scheduleRefusal } from '../controllers/matches.controller';
// eslint-disable-next-line import/first
import { sweepTournamentsDue } from '../controllers/tournaments.controller';
// eslint-disable-next-line import/first
import { ARRAY_LIMITS } from '../utils/validation';

test('a match two years ahead is accepted; the past still isn’t', () => {
  expect(scheduleRefusal(new Date(Date.now() + 2 * 366 * 86_400_000).toISOString())).toBeNull();
  expect(scheduleRefusal(new Date(Date.now() - 86_400_000).toISOString())?.code).toBe('SCHEDULED_IN_PAST');
});

test('the anti-abuse limits Dipak kept are still there; the others are gone', () => {
  expect(ARRAY_LIMITS).toEqual({ mentions: 20, forwardChats: 20 });
});

test('the sweep starts every tournament due — 1,200 of them, read a page at a time', async () => {
  const today = new Date(Date.now() + 330 * 60_000).toISOString().slice(0, 10);
  const ts = Array.from({ length: 1200 }, (_, i) => ({ id: `t${String(i).padStart(4, '0')}`, status: 'upcoming', start_date: today }));
  db = fakeDb({ tournaments: ts, matches: ts.map((t) => ({ id: `m-${t.id}`, tournament_id: t.id })) }, { maxRows: 1000 });
  const r = await sweepTournamentsDue();
  expect(r.started).toBe(1200);
  expect(db.t('tournaments').every((t) => t.status === 'live')).toBe(true);
});
