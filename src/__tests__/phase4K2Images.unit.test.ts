/**
 * Phase 4 · K2 — regression tests for image-URL and OAuth/OTP hardening
 * (SC-146/147, SC-149/150) — see the app repo's phase4/K2.md. Supabase is
 * mocked: every `from()` starts its own query, resolved by `mockNext(q)`.
 */
process.env.R2_PUBLIC_BASE_URL = 'https://media.sportclan.test';
type Q = string[];
let mockLog: Q[] = [];
let mockNext: (q: Q) => { data?: unknown; error?: unknown; count?: number } = () => ({ data: null, error: null });
jest.mock('../utils/supabase', () => {
  const start = (t: string) => {
    const q: string[] = [`from:${t}`];
    mockLog.push(q);
    const chain: any = {};
    for (const m of ['select', 'in', 'not', 'eq', 'neq', 'is', 'limit', 'maybeSingle', 'single', 'update', 'delete', 'order', 'or', 'ilike', 'range', 'gte', 'gt', 'lt', 'lte', 'upsert', 'contains', 'filter', 'match']) {
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
let mockBlocked = new Set<string>();
jest.mock('../utils/blocks', () => ({ ...jest.requireActual('../utils/blocks'), blockedUserIds: jest.fn(async () => mockBlocked) }));
jest.mock('../utils/testContent', () => ({
  hideTestFor: jest.fn(async () => false), excludeTest: (q: unknown) => q, excludeTestEmbed: (q: unknown) => q, testUserIdSet: jest.fn(async () => new Set()),
}));
jest.mock('../utils/tournamentAuth', () => ({
  ...jest.requireActual('../utils/tournamentAuth'),
  isTournamentOrganiser: jest.fn(async () => true),
  logAdminAction: jest.fn(),
}));
jest.mock('../utils/sports', () => ({ ...jest.requireActual('../utils/sports'), validateSportForCreate: jest.fn(async () => null), isSportInactive: jest.fn(async () => false) }));
jest.mock('../utils/sportId', () => ({ resolveSportId: jest.fn(async (s?: string) => (s ? '99999999-9999-4999-8999-999999999999' : undefined)) }));
jest.mock('../utils/notify', () => ({
  notifyUser: jest.fn(), notifyUsers: jest.fn(), notifyUnlessBlocked: jest.fn(), sendPushToUsers: jest.fn(), allowedRecipients: jest.fn(async () => []),
  matchAudienceIds: jest.fn(async () => []), matchFollowerIds: jest.fn(async () => []),
}));
jest.mock('../utils/tournamentChat', () => ({
  syncTournamentChatMembers: jest.fn(async () => undefined), syncTournamentChatsForTeam: jest.fn(), syncAfterSuccess: jest.fn(), canOpenTournamentChat: jest.fn(async () => false),
}));
jest.mock('../utils/r2', () => ({ uploadBuffer: jest.fn(async () => 'https://cdn.example/x.jpg') }));

jest.mock('../utils/chatMembership', () => ({
  isActiveMember: jest.fn(async () => true), activeMembership: jest.fn(async () => ({ role: 'admin' })),
  joinChat: jest.fn(async () => undefined), leaveChat: jest.fn(async () => undefined), softDeleteChat: jest.fn(async () => undefined),
}));
jest.mock('../utils/teamAuth', () => ({ isTeamManager: jest.fn(async () => true), isTeamCaptain: jest.fn(async () => true), getTeamRole: jest.fn(async () => 'captain') }));
jest.mock('../middleware/admin.middleware', () => ({ isAdminUser: jest.fn(async () => false), requireAdmin: jest.fn() }));

// eslint-disable-next-line import/first
import { isAllowedImageUrl } from '../utils/validation';
// eslint-disable-next-line import/first
import { createPost } from '../controllers/community.controller';
// eslint-disable-next-line import/first
import { createTeam, updateTeam } from '../controllers/teams.controller';
// eslint-disable-next-line import/first
import { createTournament, updateTournament } from '../controllers/tournaments.controller';
// eslint-disable-next-line import/first
import { createGroup, updateGroup } from '../controllers/messages.controller';

const ME = '11111111-1111-4111-8111-111111111111';
const T = '22222222-2222-4222-8222-222222222222';
const CRICKET = '44444444-4444-4444-8444-444444444444';
const res = () => {
  const r: any = { statusCode: 200, body: null, setHeader: jest.fn(), set: jest.fn(), on: jest.fn() };
  r.status = jest.fn((c: number) => { r.statusCode = c; return r; });
  r.json = jest.fn((b: unknown) => { r.body = b; return r; });
  return r;
};
const call = async (fn: any, req: object) => { const r = res(); await fn({ userId: ME, params: { id: T }, query: {}, body: {}, headers: {}, ...req }, r); return r; };
const writes = () => mockLog.filter((q) => q.some((c) => /^(insert|update|upsert|delete):/.test(c)));
const EVIL = 'https://tracker.example.com/pixel.png';

beforeEach(() => {
  mockLog = [];
  mockNext = () => ({ data: null, error: null });
  mockBlocked = new Set();
});

describe('K2-28 · image URLs must point at our own storage (SC-146/147)', () => {
  it('K2-28 (8aabcd8): the allowlist — https + our R2 public host / *.r2.dev / *.googleusercontent.com only', () => {
    expect(isAllowedImageUrl('https://media.sportclan.test/u/a.jpg')).toBe(true);
    expect(isAllowedImageUrl('https://pub-123.r2.dev/a.jpg')).toBe(true);
    expect(isAllowedImageUrl('https://lh3.googleusercontent.com/a')).toBe(true);
    for (const bad of [EVIL, 'http://media.sportclan.test/a.jpg', 'javascript:alert(1)', 'data:image/png;base64,AAAA', 'not a url', `https://media.sportclan.test/${'a'.repeat(2500)}`]) {
      expect(isAllowedImageUrl(bad)).toBe(false);
    }
  });
  it.each([
    ['post image_url', createPost, { body: { content: 'gg', image_url: EVIL } }],
    ['post media_urls', createPost, { body: { content: 'gg', media_urls: ['https://media.sportclan.test/ok.jpg', EVIL] } }],
    ['team logo (create)', createTeam, { body: { sport_id: 'cricket', name: 'P4 XI', logo_url: EVIL } }],
    ['team logo (update)', updateTeam, { body: { logo_url: EVIL } }],
    ['tournament banner (create)', createTournament, { body: { name: 'P4 Cup', sport_id: CRICKET, format: 'knockout', max_teams: 4, banner_url: EVIL } }],
    ['tournament sponsor logo (update)', updateTournament, { body: { sponsor_logo_url: EVIL } }],
    ['group icon (create)', createGroup, { body: { name: 'Gang', icon_url: EVIL, member_ids: [T] } }],
    ['group icon (update)', updateGroup, { body: { icon_url: EVIL } }],
  ])('K2-28 (8aabcd8): %s from another host → 400 INVALID_IMAGE_URL, nothing written', async (_n, fn, req) => {
    mockNext = (q) => (q[0] === 'from:tournaments' ? { data: { created_by: ME, status: 'upcoming', name: 'P4', start_date: '2026-10-05', end_date: '2026-10-07' } }
      : q[0] === 'from:chat_participants' ? { data: { role: 'admin' } } : q[0] === 'from:chats' ? { data: { id: T, is_group: true } } : { data: null });
    const r = await call(fn, req);
    expect([r.statusCode, r.body.code]).toEqual([400, 'INVALID_IMAGE_URL']);
    expect(writes()).toHaveLength(0);
  });
});
