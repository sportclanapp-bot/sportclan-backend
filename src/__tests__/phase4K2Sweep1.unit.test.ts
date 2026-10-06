/**
 * Phase 4 · K2 — regression tests for the SWEEP1 low-severity batch (99ffb16)
 * and its follow-ups (see the app repo's phase4/K2.md). Supabase is mocked:
 * every `from()` starts its own query, which resolves to `mockNext(q)`, where
 * `q` lists that query's builder calls.
 */
import fs from 'fs';
import path from 'path';

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

// eslint-disable-next-line import/first
import { evaluateBadges } from '../controllers/badges.controller';
// eslint-disable-next-line import/first
import { createTournament, updateTournament } from '../controllers/tournaments.controller';
// eslint-disable-next-line import/first
import { searchMentions, getSportStoryCounts } from '../controllers/community.controller';
// eslint-disable-next-line import/first
import { getActivityHeatmap, getRatingHistory, getSportProfile } from '../controllers/users.controller';
// eslint-disable-next-line import/first
import { updateAvailability } from '../controllers/availability.controller';
// eslint-disable-next-line import/first
import { uploadProfilePhoto } from '../controllers/uploads.controller';
// eslint-disable-next-line import/first
import { listInvites, withdrawInvite } from '../controllers/invites.controller';
// eslint-disable-next-line import/first
import devRouter from '../routes/dev.routes';
// eslint-disable-next-line import/first
import { requireAdmin } from '../middleware/admin.middleware';
// eslint-disable-next-line import/first
import { authenticateToken } from '../middleware/auth.middleware';

const ME = '11111111-1111-4111-8111-111111111111';
const T = '22222222-2222-4222-8222-222222222222';
const OTHER = '33333333-3333-4333-8333-333333333333';
const CRICKET = '44444444-4444-4444-8444-444444444444';
const res = () => {
  const r: any = { statusCode: 200, body: null, setHeader: jest.fn(), set: jest.fn(), on: jest.fn() };
  r.status = jest.fn((c: number) => { r.statusCode = c; return r; });
  r.json = jest.fn((b: unknown) => { r.body = b; return r; });
  return r;
};
const call = async (fn: any, req: object) => { const r = res(); await fn({ userId: ME, params: { id: T }, query: {}, body: {}, headers: {}, ...req }, r); return r; };
const writes = () => mockLog.filter((q) => q.some((c) => /^(insert|update|upsert|delete):/.test(c)));

beforeEach(() => {
  mockLog = [];
  mockNext = () => ({ data: null, error: null });
  mockBlocked = new Set();
});

describe('K2-2c · evaluateBadges is self-only (SC-101)', () => {
  it('K2-2c (99ffb16): evaluating someone else → 403, no badge query or write', async () => {
    const r = await call(evaluateBadges, { params: { userId: OTHER } });
    expect(r.statusCode).toBe(403);
    expect(mockLog).toHaveLength(0);
  });
});

describe('K2-2b · groups_knockout qualifiers cannot exceed the group (SC-110)', () => {
  it('K2-2b (99ffb16): qualifiers_per_group 4 > group_size 3 → 400, nothing inserted', async () => {
    const r = await call(createTournament, {
      body: { name: 'P4 Cup', sport_id: CRICKET, format: 'groups_knockout', max_teams: 12, group_size: 3, qualifiers_per_group: 4 },
    });
    expect(r.statusCode).toBe(400);
    expect(r.body.error).toBe('qualifiers_per_group cannot exceed group_size');
    expect(writes()).toHaveLength(0);
  });
});

describe('K2-2d · updateTournament validates max_teams and format (SC-102)', () => {
  const current = (q: Q) => (q[0] === 'from:tournaments'
    ? { data: { created_by: ME, status: 'upcoming', name: 'P4', start_date: '2026-10-05', end_date: '2026-10-07' } }
    : { count: 0 });
  it.each([
    [{ max_teams: 1 }, 'max_teams must be a whole number, at least 2'], // Oct 2026: no upper cap
    [{ max_teams: 'lots' }, 'max_teams must be a whole number, at least 2'],
    [{ format: 'battle_royale' }, 'Invalid format'],
  ])('K2-2d (99ffb16): edit %j → 400', async (body, words) => {
    mockNext = current;
    const r = await call(updateTournament, { body });
    expect(r.statusCode).toBe(400);
    expect(r.body.error).toContain(words);
    expect(writes()).toEqual([]);
  });
});

describe('K2-2f · mention search is injection-safe and hides deleted/blocked (SC-104)', () => {
  it('K2-2f (99ffb16): PostgREST metacharacters are stripped from the .or() filter', async () => {
    await call(searchMentions, { query: { q: 'ab),id.eq.x,(c%*' } });
    const q = mockLog.find((x) => x[0] === 'from:users')!;
    const or = q.find((c) => c.startsWith('or:'))!;
    expect(or).toBe('or:["username.ilike.%abid.eq.xc%,name.ilike.%abid.eq.xc%"]');
  });
  it('K2-2f (99ffb16): only punctuation → empty list, no query', async () => {
    const r = await call(searchMentions, { query: { q: ',()%*' } });
    expect(r.body).toEqual({ data: [], candidates: [] });
    expect(mockLog.filter((x) => x[0] === 'from:users')).toHaveLength(0);
  });
  it('K2-2f (99ffb16): the query drops soft-deleted and blocked users', async () => {
    mockBlocked = new Set([OTHER]);
    await call(searchMentions, { query: { q: 'dip' } });
    const q = mockLog.find((x) => x[0] === 'from:users')!.join(' ');
    expect(q).toContain('is:["deleted_at",null]');
    expect(q).toContain(OTHER);
  });
});

describe('K2-2g · /dev/* is admin-only (SC-105)', () => {
  it('K2-2g (99ffb16): the router runs authenticateToken + requireAdmin before any route', () => {
    const stack = (devRouter as any).stack as Array<{ route?: unknown; handle: unknown }>;
    const firstRoute = stack.findIndex((l) => l.route);
    const guards = stack.slice(0, firstRoute).map((l) => l.handle);
    expect(guards).toContain(authenticateToken);
    expect(guards).toContain(requireAdmin);
  });
});

describe('K2-2h · profile sub-reads 404 for a deleted or blocked target (SC-106)', () => {
  // users lookup returns nobody live → hidden.
  it.each([
    ['activity-heatmap', getActivityHeatmap, { params: { id: OTHER } }],
    ['rating-history', getRatingHistory, { params: { id: OTHER }, query: { sport_id: 'cricket' } }],
    ['sport-profile', getSportProfile, { params: { id: OTHER, sportId: 'cricket' } }],
  ])('K2-2h (99ffb16): %s of a deleted user → 404', async (_n, fn, req) => {
    const r = await call(fn, req);
    expect(r.statusCode).toBe(404);
    expect(r.body).toEqual({ error: 'User not found' });
  });
  it('K2-2h (99ffb16): heatmap of a live but blocked user → 404', async () => {
    mockNext = (q) => (q[0] === 'from:users' ? { data: { id: OTHER } } : q[0] === 'from:user_blocks' ? { data: [{ id: 'b1' }] } : { data: [] });
    const r = await call(getActivityHeatmap, { params: { id: OTHER } });
    expect(r.statusCode).toBe(404);
  });
});

describe('K2-2j · SC-108 hardening', () => {
  it('K2-2j (99ffb16): updateAvailability with no body → not a 500', async () => {
    const r = await call(updateAvailability, { body: undefined });
    expect(r.statusCode).not.toBe(500);
  });
  it('K2-2j (99ffb16): updateAvailability status outside the CHECK list → 400', async () => {
    const r = await call(updateAvailability, { body: { status: 'sleeping' } });
    expect([r.statusCode, r.body.error]).toEqual([400, 'Invalid status']);
    expect(writes()).toHaveLength(0);
  });
  it('K2-2j (99ffb16): invite list/withdraw DB errors never echo the raw Postgres message', async () => {
    jest.spyOn(console, 'error').mockImplementation(() => undefined);
    mockNext = () => ({ data: null, error: { message: 'relation "invites" secret detail' } });
    const l = await call(listInvites, {});
    expect([l.statusCode, l.body.error]).toEqual([500, 'Internal server error']);
    mockNext = (q) => (q.some((c) => c.startsWith('delete:'))
      ? { data: null, error: { message: 'permission denied for table invites' } }
      : { data: { id: 'i1', sender_id: ME, receiver_id: OTHER, status: 'pending' } });
    const w = await call(withdrawInvite, { params: { id: 'i1' } });
    expect([w.statusCode, w.body.error]).toEqual([500, 'Internal server error']);
  });
});

describe('K2-2k · profile photo upload is capped at 10MB (SC-109)', () => {
  it('K2-2k (99ffb16): a base64 body over the cap → 413 before decoding', async () => {
    const r = await call(uploadProfilePhoto, { body: { base64: 'A'.repeat(14_000_004), mime: 'image/jpeg' } });
    expect([r.statusCode, r.body.error]).toEqual([413, 'Image too large (max 10MB)']);
  });
  it('K2-2k (99ffb16): the decoded-size check catches a payload just over 10MB', async () => {
    const b64 = Buffer.alloc(10 * 1024 * 1024 + 3).toString('base64'); // under the char cap, over the byte cap
    expect(b64.length).toBeLessThanOrEqual(14_000_000);
    const r = await call(uploadProfilePhoto, { body: { base64: b64, mime: 'image/jpeg' } });
    expect(r.statusCode).toBe(413);
  });
});

describe('K2-2h · story counts skip blocked authors (SC-106)', () => {
  it('K2-2h (99ffb16): getSportStoryCounts excludes authors blocked either way', async () => {
    mockBlocked = new Set([OTHER]);
    await call(getSportStoryCounts, {});
    const q = mockLog.find((x) => x[0] === 'from:community_posts')!.join(' ');
    expect(q).toContain(`not:["author_id","in","(${OTHER})"]`);
  });
});

describe('K2-11 / K2-13 · the temporary fault-injection probes stay removed', () => {
  // G1 (8110e85) and SC-124 (ef769ca) added query-gated probes — ?__g1fault=… /
  // ?__scfault=… — that let ANY caller throw mid-transaction or corrupt a
  // finalize payload. They were reverted (bec695a, 5debf18); nothing in the
  // shipped code may read a double-underscore query probe again.
  const files = (d: string): string[] => fs.readdirSync(d, { withFileTypes: true }).flatMap((e) => {
    const p = path.join(d, e.name);
    if (e.isDirectory()) return e.name === '__tests__' ? [] : files(p);
    return p.endsWith('.ts') ? [p] : [];
  });
  it.each(['__g1fault', '__scfault'])('K2-11 (bec695a) / K2-13 (5debf18): no controller reads req.query.%s', (probe) => {
    const hits = files(path.join(__dirname, '..')).filter((f) => fs.readFileSync(f, 'utf8').includes(probe));
    expect(hits).toEqual([]);
  });
});

describe('K2-56 · /sports is cached for 5 minutes, not a day (SC-269)', () => {
  // index.ts mounts routes at import time with side effects (listen, timers),
  // so the mount line is read rather than executed.
  it('K2-56 (82a6398): the /sports mount uses cacheFor(300)', () => {
    const index = fs.readFileSync(path.join(__dirname, '..', 'index.ts'), 'utf8');
    const mount = index.split('\n').find((l) => /app\.use\('\/sports'/.test(l));
    expect(mount).toMatch(/cacheFor\(300\)/);
  });
});

describe('K2-77b · uploaded photos are auto-oriented from EXIF (SC-350)', () => {
  it('K2-77b (d0d25d3): a 600×300 JPEG tagged orientation=6 is stored upright as 300×600', async () => {
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const sharp = require('sharp');
    const src = await sharp({ create: { width: 600, height: 300, channels: 3, background: { r: 200, g: 50, b: 50 } } })
      .jpeg().withMetadata({ orientation: 6 }).toBuffer();
    const { uploadBuffer } = jest.requireMock('../utils/r2');
    (uploadBuffer as jest.Mock).mockClear();
    const r = await call(uploadProfilePhoto, { body: { base64: src.toString('base64'), mime: 'image/jpeg' } });
    expect(r.statusCode).toBe(200);
    const stored: Buffer = (uploadBuffer as jest.Mock).mock.calls[0][1];
    const meta = await sharp(stored).metadata();
    expect([meta.width, meta.height]).toEqual([300, 600]);
  });
});
