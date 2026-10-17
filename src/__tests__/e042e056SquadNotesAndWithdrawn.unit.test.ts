/**
 * E-042 (Round 6) · GET /tournaments/:id/squads/:teamId gave the organiser's
 * ID-check notes to anyone signed in. Now only the organisers and the team's
 * own captain or co-captain read them; others see the tick only.
 * E-056 (Round 6) · a withdrawn team's captain could still change its squad
 * (and so keep players out of other squads). Now 409 TEAM_WITHDRAWN and no Edit;
 * the squad stays readable and the organiser can still change it.
 * Same fake database as stage8F3Squads.
 */
import { fakeDb } from './helpers/fakeSupabase';

const id = (n: number) => `abababab-abab-4bab-8bab-${String(n).padStart(12, '0')}`;
const T = id(1); const ORG = id(2); const CAP = id(3); const P1 = id(4); const VC = id(5); const OUT = id(6); const OTHER = id(7);
const TA = id(10); const TB = id(11);
const mk = (status = 'approved') => fakeDb({
  tournaments: [{ id: T, created_by: ORG, parent_id: null, settings: { v: 1 }, fixtures_generated: false, registration_deadline: null, entry_kind: 'team', format: 'league' }],
  tournament_organisers: [],
  tournament_entries: [{ tournament_id: T, team_id: TA, status }, { tournament_id: T, team_id: TB, status: 'approved' }],
  teams: [{ id: TA, name: 'Lions', created_by: CAP }, { id: TB, name: 'Tigers', created_by: OTHER }],
  team_members: [
    { team_id: TA, user_id: CAP, role: 'captain', jersey_number: 1 }, { team_id: TA, user_id: VC, role: 'vice_captain', jersey_number: 2 },
    { team_id: TA, user_id: P1, role: 'player', jersey_number: 7 }, { team_id: TB, user_id: OTHER, role: 'captain', jersey_number: 1 },
  ],
  users: [CAP, P1, VC, OUT, ORG, OTHER].map((u, i) => ({ id: u, name: ['Cap', 'Ravi', 'Vice', 'Out', 'Org', 'Other'][i], deleted_at: null })),
  tournament_squads: [], matches: [], match_events: [],
});
let db = mk();
jest.mock('../utils/supabase', () => ({ get supabase() { return db.client; } }));
// eslint-disable-next-line import/first
import { getSquad, setSquad, checkSquadPlayer } from '../controllers/squads.controller';

const run = async (fn: any, userId: string, params: object, body: object = {}) => {
  const r: any = { statusCode: 200, body: null };
  r.status = jest.fn((c: number) => { r.statusCode = c; return r; });
  r.json = jest.fn((b: unknown) => { r.body = b; return r; });
  await fn({ userId, params: { ...params }, body, query: {} } as any, r);
  return r;
};
const ravi = (r: any) => r.body.players.find((p: any) => p.name === 'Ravi');

describe('E-042 · who reads the ID-check notes', () => {
  beforeEach(async () => {
    db = mk();
    await run(checkSquadPlayer, ORG, { id: T, teamId: TA }, { player: `member:${P1}`, checked: true, note: 'Aadhaar seen' });
  });
  test('an outsider and the other team’s captain: the tick, not the note', async () => {
    for (const who of [OUT, OTHER]) {
      const r = await run(getSquad, who, { id: T, teamId: TA });
      expect(ravi(r)).toMatchObject({ id_checked: true, id_note: null });
    }
  });
  test('the organiser, the captain and the co-captain read it', async () => {
    for (const who of [ORG, CAP, VC]) {
      expect(ravi(await run(getSquad, who, { id: T, teamId: TA })).id_note).toBe('Aadhaar seen');
    }
  });
});

describe('E-056 · a withdrawn team’s squad', () => {
  beforeEach(() => { db = mk('withdrawn'); });
  test('stays readable, with no Edit for its captain', async () => {
    const r = await run(getSquad, CAP, { id: T, teamId: TA });
    expect(r.statusCode).toBe(200);
    expect(r.body.can_edit).toBe(false);
  });
  test('its captain can’t change it; the organiser can', async () => {
    const c = await run(setSquad, CAP, { id: T, teamId: TA }, { players: [{ user_id: CAP }, { user_id: OTHER }] });
    expect([c.statusCode, c.body.code]).toEqual([409, 'TEAM_WITHDRAWN']);
    expect(db.t('tournament_squads')).toEqual([]);
    const o = await run(setSquad, ORG, { id: T, teamId: TA }, { players: [{ user_id: CAP }] });
    expect(o.statusCode).toBe(200);
  });
});
