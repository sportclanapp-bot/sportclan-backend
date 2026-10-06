/**
 * Oct 2026 (Dipak) · no app-imposed caps on quantities, every sport. A
 * tournament of any size, any number of events, groups, seeds, courts and
 * days; a team or a group chat of any size; and reads that get every row (an
 * unpaged read stops at 1000 — a 50-team league has 1225 matches).
 * Sport rules (players a side, overs…) and organiser-set limits stay.
 */
import { fakeDb } from './helpers/fakeSupabase';

const id = (n: number) => `abababab-abab-4bab-8bab-${String(n).padStart(12, '0')}`;
const T = id(1); const SPORT = id(2);
let db = fakeDb({});
jest.mock('../utils/supabase', () => ({ get supabase() { return db.client; } }));
jest.mock('../utils/sportCache', () => ({ ...jest.requireActual('../utils/sportCache'), getSport: jest.fn(async () => ({ slug: 'badminton' })) }));

// eslint-disable-next-line import/first
import { getTournamentStandings } from '../controllers/features.controller';
// eslint-disable-next-line import/first
import { scheduleRefusal } from '../utils/scheduleFields';
// eslint-disable-next-line import/first
import { eventsListRefusal } from '../utils/tournamentEvents';
// eslint-disable-next-line import/first
import { eventLimitsRefusal } from '../utils/eventLimits';
// eslint-disable-next-line import/first
import { dayWindowsRefusal } from '../utils/tournamentRules';
// eslint-disable-next-line import/first
import { createFieldRefusal } from '../controllers/matches.controller';
// eslint-disable-next-line import/first
import { isCount, LIMITS, ARRAY_LIMITS } from '../utils/validation';
// eslint-disable-next-line import/first
import { allRows, selectAllIn } from '../utils/selectAll';

test('counts: any size from the minimum up — only the int column’s limit', () => {
  expect(isCount(512, 2)).toBe(true);
  expect(isCount(100_000, 2)).toBe(true);
  expect(isCount(1, 2)).toBe(false);
  expect(isCount(2.5, 2)).toBe(false);
  expect(isCount(3_000_000_000, 2)).toBe(false);
  expect('tournamentMaxTeams' in LIMITS).toBe(false);
  expect('participants' in ARRAY_LIMITS).toBe(false);
});

test('events, courts, days, event limits, players needed: no caps', () => {
  expect(eventsListRefusal(Array.from({ length: 150 }, (_, i) => ({ label: `Event ${i + 1}` })))).toBeNull();
  expect(scheduleRefusal({ ground_count: 200, ground_names: Array.from({ length: 200 }, (_, i) => `Court ${i + 1}`) })).toBeNull();
  expect(eventLimitsRefusal({ total: 120, singles: 60 })).toBeNull();
  const days = Array.from({ length: 120 }, (_, i) => ({ day_date: new Date(Date.UTC(2026, 10, 1 + i)).toISOString().slice(0, 10), start_time: '08:00', end_time: '20:00' }));
  expect(dayWindowsRefusal(days)).toBeNull();
  expect(createFieldRefusal({ is_open: true, players_needed: 1000 })).toBeNull();
});

test('a 50-team league (1225 matches): the table counts every match', async () => {
  const teams = Array.from({ length: 50 }, (_, i) => `team-${String(i).padStart(2, '0')}`);
  const matches: object[] = [];
  let n = 0;
  for (let a = 0; a < teams.length; a++) for (let b = a + 1; b < teams.length; b++) {
    matches.push({ id: id(1000 + n++), tournament_id: T, team_a_id: teams[a], team_b_id: teams[b], winner_team_id: teams[a], status: 'completed', voided_at: null, group_label: null, round: 1, score_summary: { A: { score: 2 }, B: { score: 0 } }, overs: null });
  }
  db = fakeDb({
    tournaments: [{ id: T, sport_id: SPORT, format: 'league', tiebreaker_rules: [], qualifiers_per_group: null, settings: { v: 1 } }],
    tournament_entries: teams.map((t, i) => ({ id: id(100 + i), tournament_id: T, team_id: t, status: 'approved', group_label: null })),
    matches,
  }, { maxRows: 1000 });
  const r: any = { statusCode: 200, body: null };
  r.status = jest.fn((c: number) => { r.statusCode = c; return r; });
  r.json = jest.fn((b: unknown) => { r.body = b; return r; });
  await getTournamentStandings({ params: { id: T }, query: {} } as any, r);
  expect(r.body.standings).toHaveLength(50);
  for (const row of r.body.standings) expect(row.played).toBe(49);
  expect(r.body.standings[0]).toMatchObject({ teamId: 'team-00', won: 49 });
});

test('the paging helpers: every row, ids in chunks', async () => {
  db = fakeDb({ things: Array.from({ length: 2500 }, (_, i) => ({ id: id(5000 + i), k: `k${i % 400}` })) }, { maxRows: 1000 });
  expect(await allRows(() => db.client.from('things').select('id'))).toHaveLength(2500);
  const keys = Array.from({ length: 400 }, (_, i) => `k${i}`);
  expect(await selectAllIn(keys, (c, f, to) => db.client.from('things').select('id').in('k', c).order('id').range(f, to))).toHaveLength(2500);
});

test('a team and a group chat have no member cap; a line-up and a split have no size cap', () => {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const fs = require('fs'); const path = require('path');
  const read = (f: string) => fs.readFileSync(path.join(__dirname, '..', 'controllers', f), 'utf8');
  expect(read('teams.controller.ts')).not.toMatch(/TEAM_FULL|isAtCapacity/);
  expect(read('messages.controller.ts')).not.toMatch(/Max 50 members per group/);
  expect(read('matches.controller.ts')).not.toMatch(/Too many participants/);
  expect(read('teamExpenses.controller.ts')).not.toMatch(/Too many split_among/);
});
