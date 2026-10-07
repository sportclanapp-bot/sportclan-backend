/**
 * Stage 8 · F11 / F14 (Oct 2026) · officials and areas in each sport's own
 * words: assistant officials per match (the sport's roles only, soft-removed
 * when replaced), the official's report, server messages and default area
 * names by sport. sportTerms.ts is byte-for-byte the app's.
 */
import fs from 'fs';
import path from 'path';
import { fakeDb } from './helpers/fakeSupabase';

const id = (n: number) => `dddddddd-dddd-4ddd-8ddd-${String(n).padStart(12, '0')}`;
const ORG = id(1); const REF = id(2); const AR1 = id(3); const AR2 = id(4); const PLAYER = id(5); const T = id(6);
const FB = 'sport-football'; const CR = 'sport-cricket'; const CA = 'sport-carrom';
const M = id(100); const MC = id(101); const MCR = id(102);
const mkDb = () => fakeDb({
  sports: [{ id: FB, slug: 'football' }, { id: CR, slug: 'cricket' }, { id: CA, slug: 'carrom' }],
  tournaments: [{ id: T, created_by: ORG, parent_id: null }],
  tournament_organisers: [],
  users: [ORG, REF, AR1, AR2, PLAYER].map((u, i) => ({ id: u, name: `U${i}`, username: `u${i}`, deleted_at: null })),
  matches: [
    { id: M, sport_id: FB, tournament_id: T, created_by: ORG, status: 'scheduled', umpire_id: REF, scorer_id: null, is_ranked: true, team_a_name: 'Lions', team_b_name: 'Tigers', official_report: null },
    { id: MC, sport_id: CA, tournament_id: T, created_by: ORG, status: 'scheduled', umpire_id: null, scorer_id: null, is_ranked: false, team_a_name: 'A', team_b_name: 'B', official_report: null },
    { id: MCR, sport_id: CR, tournament_id: T, created_by: ORG, status: 'completed', umpire_id: REF, scorer_id: null, is_ranked: false, team_a_name: 'A', team_b_name: 'B', official_report: null },
  ],
  match_officials: [],
  match_participants: [{ match_id: M, user_id: PLAYER, team_side: 'A' }],
});
let db = mkDb();
jest.mock('../utils/supabase', () => ({ get supabase() { return db.client; } }));
const sent: Array<{ userId: string; title: string }> = [];
jest.mock('../utils/notify', () => ({ notifyUser: jest.fn(async (n: { userId: string; title: string }) => { sent.push(n); }), notifyUsers: jest.fn() }));

// eslint-disable-next-line import/first
import { getMatchAssistants, setMatchAssistants, setOfficialReport, REPORT_MAX } from '../controllers/matchOfficials.controller';
// eslint-disable-next-line import/first
import { sportTerms, areaLabel, isAssistantRole } from '../utils/sportTerms';
// eslint-disable-next-line import/first
import { courtsOf } from '../controllers/courtBoard.controller';
// eslint-disable-next-line import/first
import { buildTournamentScheduleConfig } from '../controllers/tournaments.controller';

const run = async (fn: any, userId: string, params: object, body: object = {}) => {
  const r: any = { statusCode: 200, body: null };
  r.status = jest.fn((c: number) => { r.statusCode = c; return r; });
  r.json = jest.fn((b: unknown) => { r.body = b; return r; });
  await fn({ userId, params, body, query: {} } as any, r);
  return r;
};
beforeEach(() => { db = mkDb(); sent.length = 0; });

test('sportTerms.ts is byte-for-byte the app’s', () => {
  const be = fs.readFileSync(path.join(__dirname, '..', 'utils', 'sportTerms.ts'), 'utf8');
  const app = fs.readFileSync(path.join(__dirname, '..', '..', '..', 'sportclan-v2', 'src', 'sport', 'sportTerms.ts'), 'utf8');
  expect(be).toBe(app);
});

test('each sport its own words; unknown sports keep cricket’s', () => {
  expect([sportTerms('football').area, sportTerms('football').official]).toEqual(['Pitch', 'Referee']);
  expect([sportTerms('badminton').area, sportTerms('badminton').official]).toEqual(['Court', 'Umpire']);
  expect([sportTerms('chess').area, sportTerms('chess').official]).toEqual(['Board', 'Arbiter']);
  expect([sportTerms('table-tennis').area, sportTerms('cricket').area, sportTerms(null).area]).toEqual(['Table', 'Ground', 'Ground']);
  expect(areaLabel('football', 1)).toBe('Pitch 2');
  expect(isAssistantRole('football', 'fourth_official')).toBe(true);
  expect(isAssistantRole('football', 'line_judge')).toBe(false);
  expect(sportTerms('carrom').assistants).toEqual([]);
});

test('default area names follow the sport: board and schedule', () => {
  expect(courtsOf({ ground_count: 2, ground_names: null }, [], 'football')).toEqual(['Pitch 1', 'Pitch 2']);
  expect(courtsOf({ ground_count: 2, ground_names: null }, [])).toEqual(['Ground 1', 'Ground 2']);
  expect(courtsOf({ ground_count: 2, ground_names: ['Turf A'] }, [], 'football')).toEqual(['Turf A', 'Pitch 2']);
  expect(buildTournamentScheduleConfig({ settings: {} }, '2026-11-20', undefined, 'football').areaWord).toBe('Pitch');
  expect(buildTournamentScheduleConfig({ settings: {} }, '2026-11-20').areaWord).toBeUndefined();
});

test('the organiser names a football match’s assistant referees; replacing one soft-removes the old', async () => {
  const r = await run(setMatchAssistants, ORG, { id: M }, { assignments: [{ role: 'assistant_referee_1', user_id: AR1 }, { role: 'fourth_official', user_id: AR2 }] });
  expect(r.statusCode).toBe(200);
  expect(r.body.official).toBe('Referee');
  expect(r.body.roles.map((x: any) => [x.label, x.user?.id ?? null])).toEqual([['Assistant referee 1', AR1], ['Assistant referee 2', null], ['Fourth official', AR2]]);
  expect(sent.map((s) => s.title)).toEqual(['You’re assistant referee 1', 'You’re fourth official']);
  const r2 = await run(setMatchAssistants, ORG, { id: M }, { assignments: [{ role: 'assistant_referee_1', user_id: AR2 }, { role: 'fourth_official', user_id: null }] });
  expect(r2.body.roles.map((x: any) => x.user?.id ?? null)).toEqual([AR2, null, null]);
  const rows = db.t('match_officials');
  expect(rows).toHaveLength(3); // never deleted
  expect(rows.filter((x) => !x.removed_at).map((x) => [x.role, x.user_id])).toEqual([['assistant_referee_1', AR2]]);
});

test('refusals: not the organiser, a role the sport doesn’t have, a player in a ranked match, a sport with none, a finished match', async () => {
  expect((await run(setMatchAssistants, REF, { id: M }, { assignments: [{ role: 'assistant_referee_1', user_id: AR1 }] })).statusCode).toBe(403);
  const bad = await run(setMatchAssistants, ORG, { id: M }, { assignments: [{ role: 'line_judge', user_id: AR1 }] });
  expect([bad.statusCode, bad.body.code]).toEqual([400, 'BAD_ROLE']);
  expect(bad.body.error).toContain('Assistant referee 1, Assistant referee 2, Fourth official');
  expect((await run(setMatchAssistants, ORG, { id: M }, { assignments: [{ role: 'assistant_referee_1', user_id: PLAYER }] })).body.code).toBe('OFFICIAL_IS_PLAYER');
  const none = await run(setMatchAssistants, ORG, { id: MC }, { assignments: [{ role: 'x', user_id: AR1 }] });
  expect([none.body.code, none.body.error]).toEqual(['NO_ASSISTANTS', 'Umpires work alone in this sport.']);
  expect((await run(setMatchAssistants, ORG, { id: MCR }, { assignments: [{ role: 'umpire_2', user_id: AR1 }] })).body.code).toBe('MATCH_FINISHED');
});

test('the report: the referee or an assistant writes it, also after the match; up to 2000 characters; others can’t', async () => {
  await run(setMatchAssistants, ORG, { id: M }, { assignments: [{ role: 'assistant_referee_2', user_id: AR2 }] });
  const r = await run(setOfficialReport, AR2, { id: M }, { text: '  23’ yellow #7 (dissent). 61’ red #4 (serious foul play).  ' });
  expect(r.statusCode).toBe(200);
  expect(r.body.report.text).toBe('23’ yellow #7 (dissent). 61’ red #4 (serious foul play).');
  expect(r.body.report.by.id).toBe(AR2);
  expect((await run(setOfficialReport, REF, { id: MCR }, { text: 'Bad light at 17:40.' })).statusCode).toBe(200);
  expect((await run(setOfficialReport, PLAYER, { id: M }, { text: 'x' })).statusCode).toBe(403);
  expect((await run(setOfficialReport, REF, { id: M }, { text: 'x'.repeat(REPORT_MAX + 1) })).body.code).toBe('REPORT_TOO_LONG');
  const cleared = await run(setOfficialReport, REF, { id: M }, { text: '' });
  expect(cleared.body.report).toBeNull();
  await run(setOfficialReport, REF, { id: M }, { text: 'All fine.' });
  const g = await run(getMatchAssistants, PLAYER, { id: M });
  expect(g.body.roles.find((x: any) => x.key === 'assistant_referee_2').user.id).toBe(AR2);
  expect([g.body.can_report, g.body.report]).toEqual([false, null]); // a player doesn't see the report
  const o = await run(getMatchAssistants, ORG, { id: M });
  expect([o.body.can_report, o.body.report.text]).toEqual([true, 'All fine.']);
});
