/**
 * F-24 (MATCH_CREATE_TEST_PLAN): PATCH /matches/:id/availability had no
 * membership or status check — anyone could answer for any match, including a
 * finished one. Only someone who could be in the line-up may answer (U-13:
 * in it, or on either team's roster, never the umpire), and only before the end.
 */
const db: {
  match: Record<string, unknown> | null;
  parts: Array<{ user_id: string }>;
  members: Array<{ team_id: string; user_id: string }>;
  upserts: unknown[];
} = { match: null, parts: [], members: [], upserts: [] };

jest.mock('../utils/supabase', () => {
  const from = (table: string) => {
    const f: Record<string, unknown> = {};
    const chain: any = {
      select: () => chain,
      eq: (k: string, v: unknown) => { f[k] = v; return chain; },
      in: (k: string, v: unknown) => { f[k] = v; return chain; },
      limit: () => chain,
      upsert: (row: unknown) => { db.upserts.push(row); return chain; },
      single: async () => ({ data: db.upserts[db.upserts.length - 1], error: null }),
      maybeSingle: async () => ({ data: table === 'matches' ? db.match : null, error: null }),
      then: (res: any) => res({
        data: table === 'match_participants'
          ? db.parts
          : table === 'team_members'
            ? db.members.filter((m) => m.user_id === f.user_id && (f.team_id as string[]).includes(m.team_id))
            : [],
        error: null,
      }),
    };
    return chain;
  };
  return { supabase: { from } };
});
jest.mock('../utils/notify', () => ({ notifyUser: jest.fn(async () => undefined), notifyUsers: jest.fn(async () => undefined) }));

import { setMatchAvailability } from '../controllers/matchFeatures.controller';

async function answer(userId: string, status = 'available') {
  const out: { code: number; body: any } = { code: 200, body: null };
  const res: any = { status: (c: number) => { out.code = c; return res; }, json: (b: unknown) => { out.body = b; return res; } };
  await setMatchAvailability({ userId, params: { id: 'm1' }, body: { status } } as any, res);
  return out;
}

beforeEach(() => {
  db.match = { id: 'm1', status: 'scheduled', team_a_id: 'tA', team_b_id: null, umpire_id: 'ump' };
  db.parts = [{ user_id: 'opp' }];
  db.members = [{ team_id: 'tA', user_id: 'squad' }];
  db.upserts = [];
});

describe('F-24 · who may answer "Are you playing?"', () => {
  test('a player in the line-up', async () => { expect((await answer('opp')).code).toBe(200); });
  test('a member of either team', async () => { expect((await answer('squad')).code).toBe(200); });
  test('a spectator is refused, and nothing is written', async () => {
    const r = await answer('stranger');
    expect(r).toMatchObject({ code: 403, body: { code: 'NOT_A_PLAYER' } });
    expect(db.upserts).toEqual([]);
  });
  test('the umpire is refused', async () => { expect((await answer('ump')).code).toBe(403); });
  test.each(['completed', 'cancelled', 'abandoned'])('a %s match takes no answers', async (status) => {
    db.match = { ...db.match, status };
    expect(await answer('opp')).toMatchObject({ code: 409, body: { code: 'MATCH_OVER' } });
    expect(db.upserts).toEqual([]);
  });
  test('an unknown match is 404', async () => { db.match = null; expect((await answer('opp')).code).toBe(404); });
  test('a bad status is still 400 first', async () => { expect((await answer('opp', 'yes')).code).toBe(400); });
});
