/**
 * N-R7-S63 (Step 2 · Batch 3, RW-G6-028) · a red card with redBanMatches 3: the squad answered only
 * the ban's reason, so the squad screen could only say 'Banned for the next match'. Each squad row
 * now says how many of the team's fixtures the ban still covers (3, then 2 once one is served), the
 * same count as /discipline's matches_left — which also counts a ban's fixtures not drawn yet.
 */
import { fakeDb } from './helpers/fakeSupabase';
import { openBans, disciplineRecords, type DMatch } from '../utils/discipline';

const id = (n: number) => `cdcdcdcd-cdcd-4dcd-8dcd-${String(n).padStart(12, '0')}`;
const T = id(1); const ORG = id(2); const SAM = id(3); const KEN = id(4); const TA = id(10); const TB = id(11); const TC = id(12); const TD = id(13);
const M = [id(20), id(21), id(22), id(23), id(24)];
const fx = (mid: string, a: string, b: string, i: number, status: string) => ({ id: mid, tournament_id: T, team_a_id: a, team_b_id: b, status, round: 1, group_label: null, scheduled_at: `2026-10-2${i}T10:00:00Z`, match_no: i, voided_at: null, result_type: null });
const mk = (secondPlayed: boolean) => fakeDb({
  tournaments: [{ id: T, created_by: ORG, parent_id: null, settings: { v: 1, discipline: { redBanMatches: 3 } }, fixtures_generated: true, registration_deadline: null, entry_kind: 'team', format: 'league' }],
  tournament_organisers: [],
  tournament_entries: [TA, TB, TC, TD].map((t) => ({ tournament_id: T, team_id: t, status: 'approved' })),
  teams: [{ id: TA, name: 'Tigers', created_by: ORG }, { id: TB, name: 'Bears', created_by: ORG }, { id: TC, name: 'Hawks', created_by: ORG }, { id: TD, name: 'Lions', created_by: ORG }],
  team_members: [{ team_id: TA, user_id: SAM, role: 'player', jersey_number: 4 }, { team_id: TA, user_id: KEN, role: 'player', jersey_number: 9 }],
  users: [{ id: SAM, name: 'Sam', deleted_at: null }, { id: KEN, name: 'Ken', deleted_at: null }, { id: ORG, name: 'Org', deleted_at: null }],
  tournament_squads: [],
  matches: [fx(M[0]!, TA, TB, 1, 'completed'), fx(M[1]!, TA, TC, 2, secondPlayed ? 'completed' : 'scheduled'), fx(M[2]!, TA, TD, 3, 'scheduled'), fx(M[3]!, TB, TA, 4, 'scheduled'), fx(M[4]!, TC, TD, 5, 'scheduled')],
  match_events: [{ id: id(30), match_id: M[0], event_type: 'card', payload: { team_side: 'A', kind: 'red', player_id: SAM, player_name: 'Sam' } }],
});
let db = mk(false);
jest.mock('../utils/supabase', () => ({ get supabase() { return db.client; } }));
// eslint-disable-next-line import/first
import { getSquad, getDiscipline } from '../controllers/squads.controller';

const run = async (fn: any, userId: string, params: object) => {
  const r: any = { statusCode: 200, body: null };
  r.status = jest.fn((c: number) => { r.statusCode = c; return r; });
  r.json = jest.fn((b: unknown) => { r.body = b; return r; });
  await fn({ userId, params: { ...params }, body: {}, query: {} } as any, r);
  return r;
};

describe('N-R7-S63 · how long a ban lasts, on the squad', () => {
  test('after the red: 3 matches left on the squad row and on /discipline', async () => {
    db = mk(false);
    const sq = await run(getSquad, ORG, { id: T, teamId: TA });
    const sam = sq.body.players.find((p: any) => p.user_id === SAM);
    expect(sam.banned).toBe('red card');
    expect(sam.ban_matches_left).toBe(3);
    expect(sq.body.players.find((p: any) => p.user_id === KEN).ban_matches_left ?? null).toBeNull();
    const d = await run(getDiscipline, ORG, { id: T });
    expect(d.body.banned[0].matches_left).toBe(3);
  });
  test('one served: 2 left', async () => {
    db = mk(true);
    const sq = await run(getSquad, ORG, { id: T, teamId: TA });
    expect(sq.body.players.find((p: any) => p.user_id === SAM).ban_matches_left).toBe(2);
  });
  test('a ban longer than the fixtures drawn so far still counts the ones owed', () => {
    const ms: DMatch[] = [{ id: 'a', team_a_id: 'X', team_b_id: 'Y', knockout: false, played: true }, { id: 'b', team_a_id: 'X', team_b_id: 'Z', knockout: false, played: false }];
    const recs = disciplineRecords({ redBanMatches: 3 }, ms, [{ match_id: 'a', payload: { team_side: 'A', kind: 'red', player_id: 'p' } }]);
    expect((openBans(recs, new Set(['a']))[0] as any).left).toBe(3);
  });
});
