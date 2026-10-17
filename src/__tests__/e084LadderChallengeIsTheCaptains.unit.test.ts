/**
 * E-084 (Round 6) · on a team ladder any member of a team could make its ladder
 * challenge (and became the match's maker). A challenge is the team's call, like
 * entering and withdrawing: the captain or a co-captain. A plain member still
 * sees the team's rung (`mine`), with `i_manage: false` and nothing to challenge.
 */
import { fakeDb } from './helpers/fakeSupabase';

let db = fakeDb();
jest.mock('../utils/supabase', () => ({ get supabase() { return db.client; } }));
jest.mock('../utils/notify', () => ({ ...jest.requireActual('../utils/notify'), notifyUsers: jest.fn(async () => undefined) }));
// eslint-disable-next-line import/first
import { createLadderChallenge, getLadder } from '../controllers/tournaments.controller';

const run = async (fn: any, userId: string, body: object = {}) => {
  const r: any = { statusCode: 200, body: null };
  r.status = jest.fn((c: number) => { r.statusCode = c; return r; });
  r.json = jest.fn((b: unknown) => { r.body = b; return r; });
  await fn({ userId, params: { id: 'T' }, query: {}, body } as any, r);
  return r;
};

beforeEach(() => {
  db = fakeDb({
    tournaments: [{ id: 'T', name: 'Ladder', format: 'ladder', status: 'live', fixtures_generated: true, sport_id: 's', created_by: 'org', settings: { ladder: { move: 'leapfrog' } }, entry_kind: 'team' }],
    tournament_organisers: [],
    sports: [{ id: 's', slug: 'football', name: 'Football' }],
    tournament_entries: ['A', 'B', 'C'].map((x, i) => ({ id: `e${x}`, tournament_id: 'T', team_id: x, seed: i + 1, status: 'approved', entered_at: '2026-10-01T00:00:00Z', team: { name: x } })),
    team_members: [
      { team_id: 'C', user_id: 'cap', role: 'captain' }, { team_id: 'C', user_id: 'vc', role: 'vice_captain' }, { team_id: 'C', user_id: 'mem', role: 'player' },
      { team_id: 'B', user_id: 'bcap', role: 'captain' },
    ],
    matches: [],
  });
});

describe('E-084 · who makes a team’s ladder challenge', () => {
  test('a plain member is refused, with or without the team named; nothing is made', async () => {
    for (const body of [{ defender_team_id: 'B' }, { defender_team_id: 'B', challenger_team_id: 'C' }]) {
      const r = await run(createLadderChallenge, 'mem', body);
      expect([r.statusCode, r.body.code]).toEqual([403, 'NOT_TEAM_MANAGER']);
    }
    expect(db.t('matches')).toEqual([]);
  });
  test('the captain and the co-captain can', async () => {
    expect((await run(createLadderChallenge, 'cap', { defender_team_id: 'B' })).body.match_id).toBeTruthy();
    db.t('matches').length = 0;
    expect((await run(createLadderChallenge, 'vc', { defender_team_id: 'B', challenger_team_id: 'C' })).body.match_id).toBeTruthy();
  });
  test('someone not on the ladder is still NOT_ON_LADDER', async () => {
    expect((await run(createLadderChallenge, 'nobody', { defender_team_id: 'B' })).body.code).toBe('NOT_ON_LADDER');
  });
  test('the ladder: a member sees the rung but has nothing to challenge', async () => {
    const m = await run(getLadder, 'mem');
    expect(m.body.ladder.find((r: any) => r.team_id === 'C')).toMatchObject({ mine: true, i_manage: false });
    expect(m.body.can_challenge).toEqual({});
    const c = await run(getLadder, 'cap');
    expect(c.body.ladder.find((r: any) => r.team_id === 'C')).toMatchObject({ mine: true, i_manage: true });
    expect(c.body.can_challenge.C).toEqual(expect.arrayContaining(['B']));
  });
});
