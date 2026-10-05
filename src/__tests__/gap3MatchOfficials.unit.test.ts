/**
 * Cricket gap 3 (5 Oct 2026) · an umpire and a scorer per fixture. The
 * organiser names them (PATCH /matches/:id/officials); the named scorer, and a
 * tournament official with the scorer role, may score like the umpire; voiding
 * stays with the organiser, umpire or an admin; each person named is told.
 */
type Row = Record<string, any>;
const db: Record<string, Row[]> = {};
jest.mock('../utils/supabase', () => {
  const from = (table: string) => {
    const filters: Array<(r: Row) => boolean> = [];
    let patch: Row | null = null;
    let head = false;
    const run = () => {
      const rows = (db[table] ?? []).filter((r) => filters.every((f) => f(r)));
      if (patch) for (const r of rows) Object.assign(r, patch);
      return rows;
    };
    const q: any = {
      select: (_c?: string, o?: { head?: boolean }) => { head = !!o?.head; return q; },
      update: (p: Row) => { patch = p; return q; },
      eq: (c: string, v: unknown) => { filters.push((r) => r[c] === v); return q; },
      is: (c: string, v: null) => { filters.push((r) => (r[c] ?? null) === v); return q; },
      not: (c: string, _op: string, v: null) => { filters.push((r) => (r[c] ?? null) !== v); return q; },
      in: (c: string, v: unknown[]) => { filters.push((r) => v.includes(r[c])); return q; },
      order: () => q,
      limit: () => q,
      maybeSingle: () => Promise.resolve({ data: run()[0] ?? null, error: null }),
      single: () => Promise.resolve({ data: run()[0] ?? null, error: null }),
      then: (resolve: (v: unknown) => unknown) => { const rows = run(); return resolve({ data: head ? null : rows, count: rows.length, error: null }); },
    };
    return q;
  };
  return { supabase: { from } };
});
const mockNotify = jest.fn(async () => undefined);
jest.mock('../utils/notify', () => ({ notifyUser: (...a: unknown[]) => (mockNotify as any)(...a), notifyUsers: jest.fn(), matchAudienceIds: jest.fn(async () => []), matchFollowerIds: jest.fn(async () => []), notifyUnlessBlocked: jest.fn() }));

// eslint-disable-next-line import/first
import { canOfficiateMatch } from '../utils/tournamentAuth';
// eslint-disable-next-line import/first
import { setMatchOfficials } from '../controllers/matches.controller';

const ORG = '11111111-1111-4111-8111-111111111111';
const UMP = '22222222-2222-4222-8222-222222222222';
const SCO = '33333333-3333-4333-8333-333333333333';
const TSCO = '44444444-4444-4444-8444-444444444444';
const OTHER = '55555555-5555-4555-8555-555555555555';
const PLAYER = '66666666-6666-4666-8666-666666666666';
const MID = '77777777-7777-4777-8777-777777777777';

const call = async (userId: string, body: Row) => {
  const res: any = { statusCode: 200, body: null, status(c: number) { this.statusCode = c; return this; }, json(b: unknown) { this.body = b; return this; } };
  await setMatchOfficials({ params: { id: MID }, userId, body } as any, res);
  return res;
};

beforeEach(() => {
  mockNotify.mockClear();
  db.tournaments = [{ id: 't1', created_by: ORG }];
  db.tournament_organisers = [];
  db.tournament_officials = [{ id: 'o1', tournament_id: 't1', user_id: TSCO, role: 'scorer' }, { id: 'o2', tournament_id: 't1', user_id: OTHER, role: 'commentator' }];
  db.matches = [{ id: MID, tournament_id: 't1', created_by: ORG, umpire_id: null, scorer_id: null, status: 'scheduled', is_ranked: false, team_a_id: 'ta', team_b_id: 'tb', team_a_name: 'Sunrisers', team_b_name: 'Royals' }];
  db.users = [ORG, UMP, SCO, TSCO, OTHER, PLAYER].map((id) => ({ id, name: id.slice(0, 4), username: null, deleted_at: null }));
  db.match_participants = [{ match_id: MID, user_id: PLAYER }];
  db.team_members = [];
});

describe('who may score', () => {
  const fixture = (extra: Row = {}) => ({ tournament_id: 't1', created_by: ORG, umpire_id: UMP, scorer_id: SCO, ...extra });
  test('the organiser, the umpire, the named scorer and a tournament scorer; not a commentator or anyone else', async () => {
    expect(await canOfficiateMatch(fixture(), ORG)).toBe(true);
    expect(await canOfficiateMatch(fixture(), UMP)).toBe(true);
    expect(await canOfficiateMatch(fixture(), SCO)).toBe(true);
    expect(await canOfficiateMatch(fixture(), TSCO)).toBe(true);
    expect(await canOfficiateMatch(fixture(), OTHER)).toBe(false);
    expect(await canOfficiateMatch(fixture(), PLAYER)).toBe(false);
  });
  test('a tournament scorer scores only that tournament; a casual match’s named scorer scores it', async () => {
    expect(await canOfficiateMatch(fixture({ tournament_id: 't2' }), TSCO)).toBe(false);
    expect(await canOfficiateMatch({ tournament_id: null, created_by: ORG, umpire_id: null, scorer_id: SCO }, SCO)).toBe(true);
  });
  test('voiding leaves scorers out', async () => {
    expect(await canOfficiateMatch(fixture(), SCO, { scorers: false })).toBe(false);
    expect(await canOfficiateMatch(fixture(), TSCO, { scorers: false })).toBe(false);
    expect(await canOfficiateMatch(fixture(), UMP, { scorers: false })).toBe(true);
  });
});

describe('PATCH /matches/:id/officials', () => {
  test('the organiser names both; each is told; the answer names them', async () => {
    const r = await call(ORG, { umpire_id: UMP, scorer_id: SCO });
    expect(r.statusCode).toBe(200);
    expect(db.matches![0]).toMatchObject({ umpire_id: UMP, scorer_id: SCO });
    expect(r.body.umpire).toMatchObject({ id: UMP });
    expect(r.body.scorer).toMatchObject({ id: SCO });
    expect(mockNotify).toHaveBeenCalledTimes(2);
    expect(mockNotify).toHaveBeenCalledWith(expect.objectContaining({ userId: SCO, type: 'match_official_assigned', title: 'You’re the scorer', data: { matchId: MID, screen: 'MatchDetail' } }));
    expect((mockNotify.mock.calls[0] as any)[0].body).toBe('You’ve been named umpire for Sunrisers vs Royals. You can score it in the app.');
  });
  test('null clears one and leaves the other; naming the same person again tells nobody', async () => {
    db.matches![0]!.umpire_id = UMP; db.matches![0]!.scorer_id = SCO;
    expect((await call(ORG, { scorer_id: null })).statusCode).toBe(200);
    expect(db.matches![0]).toMatchObject({ umpire_id: UMP, scorer_id: null });
    await call(ORG, { umpire_id: UMP });
    expect(mockNotify).not.toHaveBeenCalled();
  });
  test('only the organiser: the umpire, a scorer or anyone else → 403', async () => {
    db.matches![0]!.umpire_id = UMP;
    for (const u of [UMP, TSCO, OTHER]) expect((await call(u, { scorer_id: SCO })).statusCode).toBe(403);
    expect(db.matches![0]!.scorer_id).toBeNull();
  });
  test('refusals: nothing sent, a bad id, someone not on SportClan, a finished match', async () => {
    expect((await call(ORG, {})).body.code).toBe('NOTHING_TO_SET');
    expect((await call(ORG, { scorer_id: 'raju' })).body).toMatchObject({ code: 'BAD_OFFICIAL', field: 'scorer_id' });
    expect((await call(ORG, { umpire_id: '88888888-8888-4888-8888-888888888888' })).body).toMatchObject({ code: 'OFFICIAL_NOT_FOUND', field: 'umpire_id' });
    db.users!.find((u) => u.id === OTHER)!.deleted_at = '2026-10-01';
    expect((await call(ORG, { scorer_id: OTHER })).body.code).toBe('OFFICIAL_NOT_FOUND');
    db.matches![0]!.status = 'completed';
    expect((await call(ORG, { scorer_id: SCO })).body.code).toBe('MATCH_FINISHED');
  });
  test('a ranked match: nobody who plays in it', async () => {
    db.matches![0]!.is_ranked = true;
    expect((await call(ORG, { scorer_id: PLAYER })).body).toMatchObject({ code: 'SCORER_IS_PLAYER' });
    expect((await call(ORG, { umpire_id: PLAYER })).body).toMatchObject({ code: 'UMPIRE_IS_PLAYER' });
    expect((await call(ORG, { scorer_id: SCO })).statusCode).toBe(200);
  });
  test('a live match can change its scorer (the first one went home)', async () => {
    db.matches![0]!.status = 'live';
    expect((await call(ORG, { scorer_id: TSCO })).statusCode).toBe(200);
  });
});
