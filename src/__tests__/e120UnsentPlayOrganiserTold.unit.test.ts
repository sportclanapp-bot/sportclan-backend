/**
 * E-120 (Round 6): play offered for a match that is already final is refused with "The organiser has
 * been told there is unsent play for it." — but no notice was ever sent. Now the organisers (a
 * casual match: its creator) are told, once per open argument.
 */
import { mock } from './r6Mock';
jest.mock('../utils/supabase', () => require('./r6Mock').supabaseStandIn());
jest.mock('../utils/notify', () => ({ notifyUsers: jest.fn(async () => undefined) }));
// eslint-disable-next-line import/first
import { recordUnsentPlayForFinalMatch } from '../utils/discrepancy';
// eslint-disable-next-line import/first
import { notifyUsers } from '../utils/notify';

const M = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const T = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
const CREATOR = 'cccccccc-cccc-4ccc-8ccc-cccccccccccc';
const CO = 'dddddddd-dddd-4ddd-8ddd-dddddddddddd';
const MATCH_CREATOR = 'eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee';
let tournamentId: string | null = T; let open = false;
beforeEach(() => {
  mock.log = []; (notifyUsers as jest.Mock).mockClear(); tournamentId = T; open = false;
  mock.next = (q) => {
    if (q[0] === 'from:matches') return { data: { id: M, tournament_id: tournamentId, created_by: MATCH_CREATOR, team_a_id: 'a', team_b_id: 'b', team_a_name: 'Smashers', team_b_name: 'Drop Shots', winner_team_id: 'a', score_summary: {} } };
    if (q[0] === 'from:result_discrepancies') return { data: q.some((c) => c.startsWith('insert')) ? null : (open ? { id: 'd1' } : null) };
    if (q[0] === 'from:tournaments') return { data: { id: T, created_by: CREATOR, parent_id: null } };
    if (q[0] === 'from:tournament_organisers') return { data: [{ user_id: CO }] };
    return { data: null };
  };
});

test('a tournament fixture: the creator and the co-organisers are told, with the match', async () => {
  await recordUnsentPlayForFinalMatch(M, 3);
  expect(notifyUsers).toHaveBeenCalledTimes(1);
  const [ids, n] = (notifyUsers as jest.Mock).mock.calls[0];
  expect(new Set(ids)).toEqual(new Set([CREATOR, CO]));
  expect(n.title).toBe('Smashers vs Drop Shots: play not sent in time');
  expect(n.body).toMatch(/3 actions/);
  expect(n.data).toEqual({ matchId: M, screen: 'MatchDetail' });
});
test('a casual match: its creator is told', async () => {
  tournamentId = null;
  await recordUnsentPlayForFinalMatch(M, 1);
  expect((notifyUsers as jest.Mock).mock.calls[0][0]).toEqual([MATCH_CREATOR]);
  expect((notifyUsers as jest.Mock).mock.calls[0][1].body).toMatch(/1 action for/);
});
test('an argument already open is not told twice', async () => {
  open = true;
  await recordUnsentPlayForFinalMatch(M, 2);
  expect(notifyUsers).not.toHaveBeenCalled();
});
