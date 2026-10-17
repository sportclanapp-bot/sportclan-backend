/** Round 6 · N-R6-5: a team's creator kept the squad after handing over the captaincy and leaving the team. */
import { mock, res } from './r6Mock';
jest.mock('../utils/supabase', () => require('./r6Mock').supabaseStandIn());
jest.mock('../utils/tournamentAuth', () => ({ isTournamentOrganiser: jest.fn(async () => false), canOfficiateMatch: jest.fn(async () => false) }));
jest.mock('../utils/notify', () => ({ notifyUser: jest.fn() }));
// eslint-disable-next-line import/first
import { setSquad } from '../controllers/squads.controller';
const ME = '11111111-1111-4111-8111-111111111111'; const TEAM = '22222222-2222-4222-8222-222222222222'; const T = '33333333-3333-4333-8333-333333333333';
let membership: Array<{ role: string }> = [];
beforeEach(() => {
  mock.log = [];
  mock.next = (q) => {
    if (q[0] === 'from:tournaments') return { data: { id: T, settings: {}, fixtures_generated: false, registration_deadline: null, entry_kind: 'teams', format: 'knockout' } };
    if (q[0] === 'from:tournament_entries') return { data: [{ team_id: TEAM, status: 'approved' }] }; // E-056: the entry's status is read now
    if (q[0] === 'from:team_members') return { data: membership };
    if (q[0] === 'from:teams') return { data: { created_by: ME } }; // ME made the team
    return { data: [] };
  };
});
const call = async () => { const r = res(); await setSquad({ userId: ME, params: { id: T, teamId: TEAM }, body: { players: [] } } as any, r); return r; };

test('the creator who is no longer on the team is refused (403)', async () => {
  membership = [];
  const r = await call();
  expect(r.statusCode).toBe(403);
  expect(r.body.error).toBe('Only the team’s captain or the organiser can set the squad.');
});
test('the current captain or co-captain still passes the check', async () => {
  membership = [{ role: 'vice_captain' }];
  const r = await call();
  expect(r.statusCode).not.toBe(403);
});
