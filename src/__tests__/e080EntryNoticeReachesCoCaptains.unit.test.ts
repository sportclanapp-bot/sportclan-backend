/**
 * E-080 (Round 6) · the approve / reject notice went to role 'captain' only, so a
 * co-captain who entered the team (and a pair's partner) was never told. Now the
 * captain and every co-captain. Same fake database as badmintonG2Pairs.
 */
import { fakeDb, fakeId } from './helpers/fakeSupabase';

const ORG = 'aaaaaaaa-aaaa-4aaa-8aaa-000000000001';
const RAVI = 'aaaaaaaa-aaaa-4aaa-8aaa-000000000002';
const AMIT = 'aaaaaaaa-aaaa-4aaa-8aaa-000000000003';
const PRIYA = 'aaaaaaaa-aaaa-4aaa-8aaa-000000000004';
const SARA = 'aaaaaaaa-aaaa-4aaa-8aaa-000000000009';
const NEHA = 'aaaaaaaa-aaaa-4aaa-8aaa-000000000005';
const SID = 'sport-bd';
const MS = 'aaaaaaaa-aaaa-4aaa-8aaa-000000000006';
const XD = 'aaaaaaaa-aaaa-4aaa-8aaa-000000000007';
const CUP = 'aaaaaaaa-aaaa-4aaa-8aaa-000000000008';
const mkDb = () => fakeDb({
  users: [
    { id: ORG, name: 'Org', username: 'org', gender: 'male', dob: '1980-01-01' },
    { id: RAVI, name: 'Ravi K', username: 'ravi', gender: 'male', dob: '1995-05-01' },
    { id: AMIT, name: 'Amit S', username: 'amit', gender: 'male', dob: '1996-05-01' },
    { id: PRIYA, name: 'Priya', username: 'priya', gender: 'female', dob: '1997-05-01' },
    { id: NEHA, name: 'Neha', username: 'neha', gender: 'female', dob: '2015-05-01' },
  ],
  tournaments: [
    { id: MS, name: 'Open · MS', status: 'upcoming', sport_id: SID, max_teams: 2, created_by: ORG, settings: { v: 1, category: { gender: 'men' } }, start_date: '2026-11-07', parent_id: 'aaaaaaaa-aaaa-4aaa-8aaa-000000000010', entry_kind: 'singles', fixtures_generated: false },
    { id: XD, name: 'Open · XD', status: 'upcoming', sport_id: SID, max_teams: 8, created_by: ORG, settings: { v: 1, category: { gender: 'mixed' }, entry: 'open' }, start_date: '2026-11-07', parent_id: 'aaaaaaaa-aaaa-4aaa-8aaa-000000000010', entry_kind: 'doubles', fixtures_generated: false },
    { id: CUP, name: 'Club Cup', status: 'upcoming', sport_id: SID, max_teams: 8, created_by: ORG, settings: null, start_date: '2026-11-07', entry_kind: 'team', fixtures_generated: false },
    { id: 'aaaaaaaa-aaaa-4aaa-8aaa-000000000010', name: 'Open', status: 'upcoming', sport_id: SID, created_by: ORG, is_parent: true },
  ],
});
let db = mkDb();
jest.mock('../utils/supabase', () => ({ get supabase() { return db.client; } }));
const notified: Array<{ userId: string; type: string; body: string }> = [];
jest.mock('../utils/notify', () => ({
  notifyUnlessBlocked: jest.fn(async (_a: string, n: { userId: string; type: string; body: string }) => { notified.push(n); }),
  notifyUser: jest.fn(), notifyUsers: jest.fn(), matchAudienceIds: jest.fn(async () => []),
}));
let mockBlocked = new Set<string>();
jest.mock('../utils/blocks', () => ({
  isBlockedBetween: jest.fn(async (a: string, b: string) => mockBlocked.has(`${a}|${b}`) || mockBlocked.has(`${b}|${a}`)),
  blockedUserIds: jest.fn(async () => new Set()),
}));
jest.mock('../utils/tournamentChat', () => ({ syncTournamentChatMembers: jest.fn(), syncAfterSuccess: jest.fn(), canOpenTournamentChat: jest.fn(async () => false) }));

// eslint-disable-next-line import/first
import { createPairInvite, answerPairInvite } from '../controllers/pairEntries.controller';
// eslint-disable-next-line import/first
import { updateEntry } from '../controllers/tournaments.controller';

const run = async (fn: any, userId: string, params: object, body: object = {}) => {
  const r: any = { statusCode: 200, body: null, setHeader: jest.fn(), on: jest.fn(), once: jest.fn() };
  r.status = jest.fn((c: number) => { r.statusCode = c; return r; });
  r.json = jest.fn((b: unknown) => { r.body = b; return r; });
  await fn({ userId, params, query: {}, body, headers: {} } as any, r);
  return r;
};
const entriesOf = (tid: string) => db.t('tournament_entries').filter((e) => e.tournament_id === tid);
const rosterOf = (teamId: string) => db.t('team_members').filter((m) => m.team_id === teamId).map((m) => `${m.user_id}:${m.role}`).sort();
beforeEach(() => { db = mkDb(); notified.length = 0; mockBlocked = new Set(); });

const pair = async () => {
  const inv = (await run(createPairInvite, RAVI, { id: XD }, { invitee_id: PRIYA })).body.invite;
  await run(answerPairInvite, PRIYA, { id: XD, inviteId: inv.id, action: 'accept' });
  return entriesOf(XD)[0];
};

describe('E-080 · approve / reject reaches the co-captains too', () => {
  const CLUB = 'aaaaaaaa-aaaa-4aaa-8aaa-000000000011';
  beforeEach(() => {
    db.t('teams').push({ id: CLUB, name: 'Smashers', sport_id: SID, kind: 'club', deleted_at: null });
    db.t('team_members').push({ team_id: CLUB, user_id: RAVI, role: 'captain' }, { team_id: CLUB, user_id: AMIT, role: 'vice_captain' }, { team_id: CLUB, user_id: PRIYA, role: 'player' });
    db.t('tournament_entries').push({ id: 'eeeeeeee-eeee-4eee-8eee-000000000001', tournament_id: CUP, team_id: CLUB, status: 'pending' });
  });
  test.each([['approved', 'entry_approved'], ['rejected', 'entry_rejected']])('%s → the captain and the co-captain, not a plain player', async (status, type) => {
    const r = await run(updateEntry, ORG, { id: CUP, entryId: 'eeeeeeee-eeee-4eee-8eee-000000000001' }, { status });
    expect(r.statusCode).toBe(200);
    expect(notified.filter((n) => n.type === type).map((n) => n.userId).sort()).toEqual([RAVI, AMIT].sort());
  });
  test('a pair entry: both partners hear', async () => {
    db.t('tournaments').find((x) => x.id === XD)!.settings = { v: 1, category: { gender: 'mixed' } }; // approval needed
    const e = await pair();
    expect(e.status).toBe('pending');
    notified.length = 0;
    await run(updateEntry, ORG, { id: XD, entryId: e.id }, { status: 'approved' });
    expect(notified.filter((n) => n.type === 'entry_approved').map((n) => n.userId).sort()).toEqual([RAVI, PRIYA].sort());
  });
});
