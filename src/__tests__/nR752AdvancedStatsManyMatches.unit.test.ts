/**
 * N-R7-52 (Step 2, Batch 2 R4 · RW-G5-181/177): a player with many ranked matches (QA Device A,
 * 1,363 in cricket) got no splits and no head-to-head — the matches were read with one
 * `.in('id', [all ids])`, a ~50 KB URL the gateway refuses (431/414), so the read came back
 * empty. The ids are read in chunks now (selectAllIn), as every other long list is.
 */
import { fakeDb } from './helpers/fakeSupabase';

let db = fakeDb();
const LIMIT = 300; // ids one request can carry before the gateway refuses the URL
jest.mock('../utils/supabase', () => ({
  get supabase() {
    return {
      ...db.client,
      from: (name: string) => {
        const b: any = db.client.from(name);
        let tooLong = false;
        const realIn = b.in.bind(b);
        b.in = (c: string, vs: unknown[]) => { if (vs.length > LIMIT) tooLong = true; realIn(c, vs); return b; };
        const realThen = b.then.bind(b);
        b.then = (ok: any, bad: any) => (tooLong ? Promise.resolve(ok({ data: null, error: { message: '431 Request Header Fields Too Large' } })) : realThen(ok, bad));
        return b;
      },
    };
  },
}));
jest.mock('../utils/sportId', () => ({ resolveSportId: jest.fn(async () => 's') }));
jest.mock('../utils/sportCache', () => ({ ...jest.requireActual('../utils/sportCache'), getSport: jest.fn(async () => ({ id: 's', slug: 'cricket' })) }));
jest.mock('../utils/blocks', () => ({ ...jest.requireActual('../utils/blocks'), isBlockedBetween: jest.fn(async () => false) }));
// eslint-disable-next-line import/first
import { getAdvancedStats } from '../controllers/advancedStats.controller';

const ME = '11111111-1111-4111-8111-111111111111';
const uuid = (i: number) => `00000000-0000-4000-8000-${String(i).padStart(12, '0')}`;
test('900 ranked matches: splits and the form are worked out over all of them', async () => {
  const N = 900;
  const matches = Array.from({ length: N }, (_, i) => ({ id: uuid(i + 1), team_a_id: 'TA', team_b_id: 'TB', team_a_name: 'Lions', team_b_name: 'Tigers', winner_team_id: i % 2 ? 'TA' : 'TB',
    scheduled_at: '2026-10-24T16:00:00Z' /* Sat 21:30 IST */, format: 'T20', city_id: null, voided_at: null }));
  db = fakeDb({
    users: [{ id: ME, deleted_at: null }],
    rating_history: matches.map((m, i) => ({ id: uuid(5000 + i), user_id: ME, sport_id: 's', match_id: m.id, old_rating: 1200, new_rating: 1200 + (i % 2 ? 5 : -5), delta: i % 2 ? 5 : -5, created_at: new Date(Date.UTC(2026, 9, 1, 0, i)).toISOString(), match: { id: m.id, voided_at: null } })),
    user_sport_profiles: [{ user_id: ME, sport_id: 's', rating: 1200 }],
    matches,
    match_participants: matches.map((m) => ({ match_id: m.id, user_id: ME, team_side: 'A' })),
  });
  const r: any = { statusCode: 200, body: null }; r.status = (c: number) => { r.statusCode = c; return r; }; r.json = (b: unknown) => { r.body = b; return r; }; r.setHeader = () => r; r.set = () => r;
  await getAdvancedStats({ userId: ME, params: {}, query: { sport_id: 'cricket' }, header: () => undefined, headers: {} } as any, r);
  expect(r.statusCode).toBe(200);
  expect(r.body.rankedMatches).toBe(N);
  const tod = r.body.splits?.timeOfDay ?? [];
  expect(tod).toEqual([expect.objectContaining({ label: 'Night', played: N })]);
  expect((r.body.splits?.dayOfWeek ?? [])[0]).toMatchObject({ label: 'Sat', played: N });
  expect(r.body.form.wins + r.body.form.losses).toBe(N);
});
