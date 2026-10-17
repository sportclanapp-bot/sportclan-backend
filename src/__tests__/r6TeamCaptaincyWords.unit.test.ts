/** Round 6 · N-R6-1: a co-captain asking to become captain was told "You are already the captain". */
jest.mock('../utils/supabase', () => require('./r6Mock').supabaseStandIn());
let mockRole: string | null = 'vice_captain';
jest.mock('../utils/teamAuth', () => ({ isTeamManager: jest.fn(async () => true), isTeamCaptain: jest.fn(async () => mockRole === 'captain'), getTeamRole: jest.fn(async () => mockRole) }));
jest.mock('../utils/tournamentChat', () => ({ syncTournamentChatsForTeam: jest.fn(), syncAfterSuccess: jest.fn() }));
jest.mock('../utils/notify', () => ({ notifyUnlessBlocked: jest.fn(), notifyUsers: jest.fn(), notifyUser: jest.fn() }));
// eslint-disable-next-line import/first
import { updateMemberRole } from '../controllers/teams.controller';
// eslint-disable-next-line import/first
import { res } from './r6Mock';
const ME = '11111111-1111-4111-8111-111111111111'; const TEAM = '22222222-2222-4222-8222-222222222222';
const call = async (role: string, target = ME) => { const r = res(); await updateMemberRole({ userId: ME, params: { id: TEAM, userId: target }, body: { role } } as any, r); return r; };

test('a co-captain naming themselves captain is refused as not the captain (403), not "already the captain"', async () => {
  mockRole = 'vice_captain';
  const r = await call('captain');
  expect(r.statusCode).toBe(403);
  expect(r.body.error).toBe('Only the captain can transfer captaincy');
});
test('the captain naming themselves still hears "You are already the captain" (400)', async () => {
  mockRole = 'captain';
  const r = await call('captain');
  expect(r.statusCode).toBe(400);
  expect(r.body.error).toBe('You are already the captain');
});
