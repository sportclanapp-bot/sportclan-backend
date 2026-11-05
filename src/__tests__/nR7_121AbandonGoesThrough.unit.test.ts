/**
 * N-R7-121 (Step 2 B7, SP-TEN-158 / SP-TT-138): a bracket abandon in singles read
 * '🚫 Match abandoned · Rahul go through (walkover)'. One player goes through; a team or a
 * pair (two or more on the side) still go through.
 */
import { fakeDb } from './helpers/fakeSupabase';

let db = fakeDb();
jest.mock('../utils/supabase', () => ({ get supabase() { return db.client; } }));
jest.mock('../utils/notify', () => ({ ...jest.requireActual('../utils/notify'), notifyUser: jest.fn(), notifyUsers: jest.fn(async () => undefined), matchAudienceIds: jest.fn(async () => []) }));
// a knockout bracket fixture (the tournament engine itself is not under test here)
jest.mock('../utils/knockout', () => ({ ...jest.requireActual('../utils/knockout'), isKnockoutBracketMatch: jest.fn(async () => true) }));
// eslint-disable-next-line import/first
import { abandonMatch } from '../controllers/matches.controller';
// eslint-disable-next-line import/first
import { timelineLine } from '../utils/commentary';

const res = () => { const r: any = { statusCode: 200, body: null }; r.status = (c: number) => { r.statusCode = c; return r; }; r.json = (b: unknown) => { r.body = b; return r; }; return r; };
const M = '22222222-2222-4222-8222-222222222222';
const TA = '33333333-3333-4333-8333-333333333333';
const TB = '44444444-4444-4444-8444-444444444444';
const req = (body: Record<string, unknown>) => ({ userId: 'creator', params: { id: M }, body, header: () => undefined }) as any;
const seed = (bMembers: string[]) => fakeDb({
  matches: [{ id: M, created_by: 'creator', umpire_id: null, scorer_id: null, status: 'live', tournament_id: null, team_a_id: TA, team_b_id: TB, team_a_name: 'Lions', team_b_name: 'Rahul', score_summary: {}, next_match_id: null }],
  team_members: [{ id: 'm1', team_id: TA, user_id: 'ua' }, ...bMembers.map((u, i) => ({ id: 'b' + i, team_id: TB, user_id: u }))],
  match_scoring_leases: [],
  match_events: [],
});
const ctx = { sport: 'tennis', teamA: 'Lions', teamB: 'Rahul', period: 0, move: 0, clockSeconds: null } as any;

test('one player goes through; a side of two or more go through', () => {
  expect(timelineLine('note', { kind: 'abandoned', walkover_side: 'B', walkover_one: true }, ctx).text).toBe('🚫 Match abandoned · Rahul goes through (walkover)');
  expect(timelineLine('note', { kind: 'abandoned', walkover_side: 'B' }, ctx).text).toBe('🚫 Match abandoned · Rahul go through (walkover)');
});

test.each([[['ub'], true], [['ub', 'uc'], false]])('the abandon note marks a one-player side (%j → %s)', async (members, one) => {
  db = seed(members as string[]);
  const r = res();
  await abandonMatch(req({ advancing_team_id: TB }), r);
  const notes = db.t('match_events').filter((e: any) => e.event_type === 'note').map((e: any) => e.payload);
  expect(notes).toEqual([{ kind: 'abandoned', walkover_side: 'B', ...(one ? { walkover_one: true } : {}) }]);
});
