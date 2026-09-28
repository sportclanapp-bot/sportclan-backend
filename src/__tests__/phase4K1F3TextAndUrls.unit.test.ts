/**
 * Phase 4 · K1 (backend fix commits) — SC-95 length caps on user text and SC-96
 * URL checks on image/link fields (tournaments, groups, teams, profile). Each
 * refusal is a 400 before anything is written. (SC-96's "well-formed http(s)"
 * rule has since tightened to "an uploaded image URL" for image fields.)
 * Supabase is a recording chain; every query resolves to `mockNext(q)`.
 */
type Q = string[];
let mockLog: Q[] = [];
let mockNext: (q: Q) => { data?: unknown; error?: unknown; count?: number } = () => ({ data: null, error: null });
jest.mock('../utils/supabase', () => {
  const start = (t: string) => {
    const q: string[] = [`from:${t}`];
    mockLog.push(q);
    const chain: any = {};
    for (const m of ['select', 'in', 'not', 'eq', 'neq', 'is', 'limit', 'maybeSingle', 'single', 'update', 'delete', 'order', 'or', 'ilike', 'range', 'gte', 'gt', 'lt', 'upsert']) {
      chain[m] = jest.fn((...a: unknown[]) => { q.push(`${m}:${JSON.stringify(a)}`); return chain; });
    }
    chain.insert = jest.fn((row: unknown) => { q.push(`insert:${JSON.stringify(row)}`); return chain; });
    chain.then = (ok: (v: unknown) => unknown, bad?: (e: unknown) => unknown) => {
      try { return Promise.resolve(ok({ data: null, error: null, ...mockNext(q) })); } catch (e) { return bad ? bad(e) : Promise.reject(e); }
    };
    return chain;
  };
  return { supabase: { from: jest.fn(start), rpc: jest.fn(async () => ({ data: null, error: null })) } };
});
jest.mock('../utils/tournamentAuth', () => ({
  ...jest.requireActual('../utils/tournamentAuth'),
  isTournamentOrganiser: jest.fn(async () => true),
  authorizeCarveout: jest.fn(async () => ({ ok: true, viaAdmin: false })),
  logAdminAction: jest.fn(),
}));
jest.mock('../utils/teamAuth', () => ({ ...jest.requireActual('../utils/teamAuth'), isTeamManager: jest.fn(async () => true) }));
jest.mock('../utils/sports', () => ({ ...jest.requireActual('../utils/sports'), validateSportForCreate: jest.fn(async () => null) }));
jest.mock('../utils/sportId', () => ({ resolveSportId: jest.fn(async () => 'sport-cricket') }));
jest.mock('../utils/tournamentChat', () => ({ syncTournamentChatMembers: jest.fn(), syncAfterSuccess: jest.fn(), canOpenTournamentChat: jest.fn(async () => false) }));
jest.mock('../utils/chatMembership', () => ({
  isActiveMember: jest.fn(async () => true), activeMembership: jest.fn(async () => null),
  joinChat: jest.fn(async () => undefined), leaveChat: jest.fn(async () => undefined), softDeleteChat: jest.fn(async () => undefined),
}));
jest.mock('../utils/notify', () => ({
  notifyUser: jest.fn(), notifyUsers: jest.fn(), notifyUnlessBlocked: jest.fn(), sendPushToUsers: jest.fn(),
  allowedRecipients: jest.fn(async (ids: string[]) => ids), matchAudienceIds: jest.fn(async () => []), matchFollowerIds: jest.fn(async () => []),
}));

// eslint-disable-next-line import/first
import { createTournament, updateTournament } from '../controllers/tournaments.controller';
// eslint-disable-next-line import/first
import { createGroup, updateGroup } from '../controllers/messages.controller';
// eslint-disable-next-line import/first
import { createTeam, updateTeam } from '../controllers/teams.controller';
// eslint-disable-next-line import/first
import { updateMe } from '../controllers/users.controller';

const ME = '11111111-1111-4111-8111-111111111111';
const ID = '22222222-2222-4222-8222-222222222222';
const OTHER = '33333333-3333-4333-8333-333333333333';
const BAD_URL = 'javascript:alert(1)';
const res = () => {
  const r: any = { statusCode: 200, body: null, setHeader: jest.fn(), once: jest.fn() };
  r.status = jest.fn((c: number) => { r.statusCode = c; return r; });
  r.json = jest.fn((b: unknown) => { r.body = b; return r; });
  return r;
};
const call = async (fn: any, req: object) => { const r = res(); await fn({ userId: ME, params: { id: ID }, query: {}, body: {}, ...req }, r); return r; };
const writes = () => mockLog.filter((q) => q.some((c) => /^(insert|update|upsert|delete):/.test(c)));
const refused = async (fn: any, req: object, words: RegExp) => {
  const r = await call(fn, req);
  expect(r.statusCode).toBe(400);
  expect(r.body.error).toMatch(words);
  expect(writes()).toEqual([]);
};

beforeEach(() => {
  mockLog = [];
  mockNext = (q) => {
    if (q[0] === 'from:tournaments') return { data: { id: ID, created_by: ME, status: 'upcoming', name: 'P3 Cup', start_date: null, end_date: null, venue: null } };
    if (q[0] === 'from:chats') return { data: { is_group: true } };
    if (q[0] === 'from:chat_participants') return { data: { role: 'admin' } };
    if (q[0] === 'from:users') return { data: [{ id: OTHER }] };
    return { data: null };
  };
});

const newCup = { sport_id: 'cricket', name: 'P3 Cup', format: 'knockout', max_teams: 4 };

describe('SC-95 · text caps', () => {
  test('K1-77a (e869da6): tournament description over 2000 → 400 (create and edit)', async () => {
    await refused(createTournament, { body: { ...newCup, description: 'x'.repeat(2001) } }, /description must be 2000 characters or fewer/);
    await refused(updateTournament, { body: { description: 'x'.repeat(2001) } }, /description must be 2000 characters or fewer/);
  });
  test('K1-77a (e869da6): group name over 60 → 400 (create and edit)', async () => {
    await refused(createGroup, { body: { name: 'g'.repeat(61), member_ids: [OTHER] } }, /Group name must be 60 characters or fewer/);
    await refused(updateGroup, { body: { name: 'g'.repeat(61) } }, /Group name must be 60 characters or fewer/);
  });
  test('K1-77a (e869da6): team name over 60 on EDIT → 400 (create already had it)', async () => {
    await refused(updateTeam, { body: { name: 't'.repeat(61) } }, /Team name must be 60 characters or fewer/);
  });
});

describe('SC-96 · image and link fields must be real URLs', () => {
  test.each([
    ['tournament banner (create)', createTournament, { ...newCup, banner_url: BAD_URL }, /banner_url must be/],
    ['tournament sponsor logo (edit)', updateTournament, { sponsor_logo_url: BAD_URL }, /sponsor_logo_url must be/],
    ['group icon (create)', createGroup, { name: 'Squad', icon_url: BAD_URL, member_ids: [OTHER] }, /icon_url must be/],
    ['group icon (edit)', updateGroup, { icon_url: BAD_URL }, /icon_url must be/],
    ['team logo (create)', createTeam, { sport_id: 'cricket', name: 'P3 XI', logo_url: BAD_URL }, /logo_url must be/],
    ['team logo (edit)', updateTeam, { logo_url: BAD_URL }, /logo_url must be/],
    ['profile photo', updateMe, { profile_picture_url: BAD_URL }, /profile_picture_url must be/],
    ['profile link', updateMe, { link: 'not a url' }, /link must be a valid URL/],
  ])('K1-77b (e869da6): %s → 400, nothing written', async (_n, fn, body, words) => {
    await refused(fn, { body }, words);
  });
});
