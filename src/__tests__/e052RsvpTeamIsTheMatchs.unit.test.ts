/**
 * E-052 (Round 6) · PATCH /matches/:id/availability stored any team_id sent (a
 * non-id was a 500). It must be one of the match's two teams, or left out.
 * Same mock as f24Availability.
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

async function answer(userId: string, team_id?: unknown) {
  const out: { code: number; body: any } = { code: 200, body: null };
  const res: any = { status: (c: number) => { out.code = c; return res; }, json: (b: unknown) => { out.body = b; return res; } };
  await setMatchAvailability({ userId, params: { id: 'm1' }, body: { status: 'available', team_id } } as any, res);
  return out;
}

beforeEach(() => {
  db.match = { id: 'm1', status: 'scheduled', team_a_id: 'tA', team_b_id: 'tB', umpire_id: 'ump' };
  db.parts = [];
  db.members = [{ team_id: 'tA', user_id: 'squad' }];
  db.upserts = [];
});

describe('E-052 · the team an answer is tagged with', () => {
  test.each([['another team', 'tZ'], ['not an id', 'not-a-uuid']])('%s → 400 BAD_TEAM, nothing written', async (_w, team) => {
    expect(await answer('squad', team)).toMatchObject({ code: 400, body: { code: 'BAD_TEAM' } });
    expect(db.upserts).toEqual([]);
  });
  test('one of the match\u2019s teams, or none, is kept', async () => {
    expect((await answer('squad', 'tA')).code).toBe(200);
    expect((await answer('squad')).code).toBe(200);
    expect(db.upserts).toEqual([expect.objectContaining({ team_id: 'tA' }), expect.objectContaining({ team_id: null })]);
  });
});
