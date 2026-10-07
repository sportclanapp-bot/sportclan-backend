/**
 * Stage 8 · F3 / F16 / F5 · squads (any team sport), the organiser's ID checks,
 * team sheets from the squad, and bans read from the cards.
 */
import { fakeDb } from './helpers/fakeSupabase';

const id = (n: number) => `abababab-abab-4bab-8bab-${String(n).padStart(12, '0')}`;
const T = id(1); const ORG = id(2); const CAP = id(3); const P1 = id(4); const P2 = id(5); const P3 = id(6); const OTHER = id(7);
const TA = id(10); const TB = id(11);
const mk = (settings: object = {}, extra: object = {}) => fakeDb({
  tournaments: [{ id: T, created_by: ORG, parent_id: null, settings: { v: 1, ...settings }, fixtures_generated: false, registration_deadline: null, entry_kind: 'team', format: 'league', ...extra }],
  tournament_organisers: [],
  tournament_entries: [{ tournament_id: T, team_id: TA, status: 'approved' }, { tournament_id: T, team_id: TB, status: 'approved' }],
  teams: [{ id: TA, name: 'Lions', created_by: CAP }, { id: TB, name: 'Tigers', created_by: OTHER }],
  team_members: [{ team_id: TA, user_id: CAP, role: 'captain', jersey_number: 1 }, { team_id: TA, user_id: P1, role: 'player', jersey_number: 7 }],
  users: [CAP, P1, P2, P3, ORG, OTHER].map((u, i) => ({ id: u, name: ['Cap', 'Ravi', 'Amit', 'Dev', 'Org', 'Other'][i], deleted_at: null })),
  tournament_squads: [], matches: [], match_events: [],
});
let db = mk();
jest.mock('../utils/supabase', () => ({ get supabase() { return db.client; } }));
// eslint-disable-next-line import/first
import { getSquad, setSquad, checkSquadPlayer, setSquadLock, getDiscipline, teamSheetProblem, squadLocked } from '../controllers/squads.controller';

const run = async (fn: any, userId: string, params: object, body: object = {}) => {
  const r: any = { statusCode: 200, body: null };
  r.status = jest.fn((c: number) => { r.statusCode = c; return r; });
  r.json = jest.fn((b: unknown) => { r.body = b; return r; });
  await fn({ userId, params: { ...params }, body, query: {} } as any, r);
  return r;
};

test('no squad saved: the team’s members are suggested; the captain sets it (names too); size and other squads refused', async () => {
  db = mk({ squad: { size: 3 } });
  const g = await run(getSquad, CAP, { id: T, teamId: TA });
  expect([g.body.saved, g.body.can_edit, g.body.can_check, g.body.players.map((p: any) => [p.name, p.jersey_number])]).toEqual([false, true, false, [['Cap', 1], ['Ravi', 7]]]);
  const s = await run(setSquad, CAP, { id: T, teamId: TA }, { players: [{ user_id: CAP, jersey_number: 1 }, { user_id: P1, jersey_number: 9 }, { guest_name: 'Raju' }] });
  expect([s.statusCode, s.body.saved, s.body.players.map((p: any) => [p.name, p.jersey_number, p.guest])]).toEqual([200, true, [['Cap', 1, false], ['Ravi', 9, false], ['Raju', null, true]]]);
  expect((await run(setSquad, CAP, { id: T, teamId: TA }, { players: [{ user_id: CAP }, { user_id: P1 }, { user_id: P2 }, { user_id: P3 }] })).body.code).toBe('SQUAD_TOO_BIG');
  expect((await run(setSquad, OTHER, { id: T, teamId: TB }, { players: [{ user_id: P1 }] })).body.code).toBe('IN_OTHER_SQUAD');
  expect((await run(setSquad, P2, { id: T, teamId: TA }, { players: [] })).statusCode).toBe(403);
  // removing is a soft delete
  await run(setSquad, CAP, { id: T, teamId: TA }, { players: [{ user_id: CAP }] });
  expect(db.t('tournament_squads').filter((r) => r.removed_at).length).toBe(2);
});

test('locked at the draw (default): only the organiser; by hand; or at the deadline', async () => {
  expect(squadLocked({ settings: {}, fixtures_generated: true, registration_deadline: null })).toBe(true);
  expect(squadLocked({ settings: { squad: { lock: 'never' } }, fixtures_generated: true, registration_deadline: null })).toBe(false);
  expect(squadLocked({ settings: { squad: { lock: 'deadline' } }, fixtures_generated: false, registration_deadline: '2020-01-01' })).toBe(true);
  db = mk({}, { fixtures_generated: true });
  expect((await run(setSquad, CAP, { id: T, teamId: TA }, { players: [{ user_id: CAP }] })).body.code).toBe('SQUAD_LOCKED');
  expect((await run(setSquad, ORG, { id: T, teamId: TA }, { players: [{ user_id: CAP }] })).statusCode).toBe(200);
  db = mk();
  const l = await run(setSquadLock, ORG, { id: T }, { locked: true });
  expect(l.body.locked).toBe(true);
  expect((await run(setSquad, CAP, { id: T, teamId: TA }, { players: [{ user_id: CAP }] })).body.code).toBe('SQUAD_LOCKED');
});

test('F16: the organiser ticks a player’s ID (saving the members as the squad first)', async () => {
  db = mk();
  const r = await run(checkSquadPlayer, ORG, { id: T, teamId: TA }, { player: `member:${P1}`, checked: true, note: 'Birth certificate seen' });
  expect(r.body.saved).toBe(true);
  expect(r.body.players.find((p: any) => p.name === 'Ravi')).toMatchObject({ id_checked: true, id_note: 'Birth certificate seen' });
  expect((await run(checkSquadPlayer, CAP, { id: T, teamId: TA }, { player: `member:${P1}`, checked: true })).statusCode).toBe(403);
});

test('team sheets: from the squad; starters fit the players a side', async () => {
  db = mk();
  await run(setSquad, CAP, { id: T, teamId: TA }, { players: [{ user_id: CAP }, { user_id: P1 }] });
  const m = { tournament_id: T, team_a_id: TA, team_b_id: TB, team_a_name: 'Lions', team_b_name: 'Tigers' };
  expect(await teamSheetProblem(m, [{ user_id: P2, team_side: 'A' }], [], 'football', 7)).toEqual({ error: 'Amit isn’t in Lions’ squad.', code: 'NOT_IN_SQUAD' });
  expect(await teamSheetProblem(m, [{ user_id: CAP, team_side: 'A' }, { user_id: P1, team_side: 'A', role: 'sub' }], [], 'football', 1)).toBeNull();
  expect((await teamSheetProblem(m, [{ user_id: CAP, team_side: 'A' }, { user_id: P1, team_side: 'A' }], [], 'football', 1))!.code).toBe('TOO_MANY_STARTERS');
  expect(await teamSheetProblem(m, [{ user_id: P3, team_side: 'B' }], [], 'football', 7)).toBeNull(); // Tigers have no saved squad
});

test('F5: the discipline table and who is banned', async () => {
  db = mk({ discipline: { yellowsForBan: 2 } });
  db.t('matches').push(
    { id: 'm1', tournament_id: T, team_a_id: TA, team_b_id: TB, status: 'completed', round: 1, group_label: null, scheduled_at: '2026-11-01', match_no: 1, voided_at: null },
    { id: 'm2', tournament_id: T, team_a_id: TB, team_b_id: TA, status: 'completed', round: 2, group_label: null, scheduled_at: '2026-11-08', match_no: 2, voided_at: null },
    { id: 'm3', tournament_id: T, team_a_id: TA, team_b_id: TB, status: 'scheduled', round: 3, group_label: null, scheduled_at: '2026-11-15', match_no: 3, voided_at: null },
  );
  db.t('match_events').push(
    { id: 'e1', match_id: 'm1', event_type: 'card', payload: { team_side: 'A', kind: 'yellow', player_id: P1, player_name: 'Ravi' } },
    { id: 'e2', match_id: 'm2', event_type: 'card', payload: { team_side: 'B', kind: 'yellow', player_id: P1, player_name: 'Ravi' } },
  );
  const d = await run(getDiscipline, CAP, { id: T });
  expect(d.body.cautions).toEqual([{ user_id: P1, name: 'Ravi', team_id: TA, team_name: 'Lions', yellows: 2, reds: 0 }]);
  expect(d.body.banned).toEqual([{ user_id: P1, name: 'Ravi', team_id: TA, team_name: 'Lions', reason: '2 yellow cards', matches_left: 1, next_match_id: 'm3' }]);
  const g = await run(getSquad, CAP, { id: T, teamId: TA });
  expect(g.body.players.find((p: any) => p.name === 'Ravi').banned).toBe('2 yellow cards');
});
