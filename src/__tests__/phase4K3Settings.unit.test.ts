/**
 * Phase 4 · K3 — settings, privacy and session revocation (SC-383/384).
 * Supabase is a recording chain: every from()/rpc() starts its own query and
 * resolves to mockNext(q).
 */
type Q = string[];
let mockLog: Q[] = [];
let mockNext: (q: Q) => { data?: unknown; error?: unknown; count?: number | null } = () => ({ data: null, error: null });
jest.mock('../utils/supabase', () => {
  const start = (head: string) => {
    const q: string[] = [head];
    mockLog.push(q);
    const chain: any = {};
    for (const m of ['select', 'in', 'not', 'eq', 'neq', 'is', 'limit', 'update', 'delete', 'order', 'or', 'ilike', 'range', 'gte', 'gt', 'lt', 'lte', 'upsert', 'insert', 'filter', 'match', 'contains', 'overlaps', 'textSearch', 'returns', 'abortSignal', 'like', 'not', 'csv']) {
      chain[m] = jest.fn((...a: unknown[]) => { q.push(`${m}:${JSON.stringify(a)}`); return chain; });
    }
    const done = () => ({ data: null, error: null, ...mockNext(q) });
    chain.single = jest.fn(async () => { q.push('single'); return done(); });
    chain.maybeSingle = jest.fn(async () => { q.push('maybeSingle'); return done(); });
    chain.then = (ok: (v: unknown) => unknown, bad?: (e: unknown) => unknown) => {
      try { return Promise.resolve(ok(done())); } catch (e) { return bad ? bad(e) : Promise.reject(e); }
    };
    return chain;
  };
  return { supabase: { from: jest.fn((t: string) => start(`from:${t}`)), rpc: jest.fn((n: string, args?: unknown) => start(`rpc:${n}:${JSON.stringify(args ?? null)}`)) } };
});
jest.mock('../utils/coins', () => ({ awardCoins: jest.fn(async () => ({ newBalance: 20 })) }));
jest.mock('../utils/sessionDeny', () => ({ ...jest.requireActual('../utils/sessionDeny'), isSessionDenied: jest.fn(async () => false), denySessions: jest.fn(async () => undefined) }));

// eslint-disable-next-line import/first
import { applyReferral, getStats } from '../controllers/referrals.controller';
// eslint-disable-next-line import/first
import { exportData } from '../controllers/account.controller';
// eslint-disable-next-line import/first
import { updateMe } from '../controllers/users.controller';
// eslint-disable-next-line import/first
import { authenticateToken } from '../middleware/auth.middleware';
// eslint-disable-next-line import/first
import { isTokenRevoked, revokeSessionsNow, invalidateRevocationCache } from '../utils/sessionRevocation';
// eslint-disable-next-line import/first
import { generateAccessTokenAt } from '../utils/jwt';
// eslint-disable-next-line import/first
import { awardCoins } from '../utils/coins';

const ME = '11111111-1111-4111-8111-111111111111';
const REF = '22222222-2222-4222-8222-222222222222';
const res = () => {
  const r: any = { statusCode: 200, body: null, headers: {} as Record<string, string> };
  r.status = jest.fn((c: number) => { r.statusCode = c; return r; });
  r.json = jest.fn((b: unknown) => { r.body = b; return r; });
  r.send = jest.fn((b: unknown) => { r.body = b; return r; });
  r.setHeader = jest.fn((k: string, v: string) => { r.headers[k.toLowerCase()] = v; });
  return r;
};
const call = async (fn: any, req: object) => { const r = res(); await fn({ userId: ME, params: {}, query: {}, body: {}, headers: {}, ...req }, r); return r; };
const has = (q: Q, s: string) => q.some((c) => c.includes(s));

beforeEach(() => { mockLog = []; mockNext = () => ({ data: null, error: null }); (awardCoins as jest.Mock).mockClear(); invalidateRevocationCache(ME); });

describe('SC-383 · Refer a friend', () => {
  it('K3-28a (5a2301e): the claim is an atomic compare-and-set — the loser of a race gets 400 and no coins move', async () => {
    mockNext = (q) => {
      if (q[0] === 'from:users' && has(q, '"referral_code"')) return { data: { id: REF, name: 'Ravi' } };
      if (q[0] === 'from:users' && q.includes('maybeSingle')) return { data: { id: ME, referred_by: null, created_at: new Date().toISOString() } };
      if (q[0] === 'from:users' && has(q, 'update:')) return { data: [] }; // another request already flipped it
      return {};
    };
    const r = await call(applyReferral, { body: { code: 'SCABC123' } });
    expect([r.statusCode, r.body.error]).toEqual([400, 'Referral already applied']);
    expect(awardCoins).not.toHaveBeenCalled();
    const upd = mockLog.find((q) => has(q, 'update:'))!;
    expect(upd.join()).toContain('is:["referred_by",null]');
  });
  it('K3-28b (5a2301e): stats sum every reward page, not the first 1000 rows', async () => {
    mockNext = (q) => {
      if (q[0] === 'from:users' && q.includes('maybeSingle')) return { data: { referral_code: 'SCX', referred_by: null } };
      if (q[0] === 'from:users') return { count: 1005 };
      if (q[0] === 'from:coin_events') return has(q, 'range:[0,999]') ? { data: Array.from({ length: 1000 }, () => ({ coins: 20 })) } : { data: Array.from({ length: 5 }, () => ({ coins: 20 })) };
      return {};
    };
    const r = await call(getStats, {});
    expect(r.body.totalCoinsEarned).toBe(1005 * 20);
    expect(r.body.referralCount).toBe(1005);
  });
  it('K3-28b (5a2301e): a failed count is a 500, not a plausible "0 referred"', async () => {
    mockNext = (q) => (q[0] === 'from:users' && q.includes('maybeSingle') ? { data: { referral_code: 'SCX' } } : q[0] === 'from:users' ? { error: { message: 'down' } } : {});
    const r = await call(getStats, {});
    expect(r.statusCode).toBe(500);
  });
});

describe('SC-383 · Export my data', () => {
  const exportDb = (q: Q) => {
    if (q[0] === 'from:messages') return has(q, 'range:[0,999]') ? { data: Array.from({ length: 1000 }, (_, i) => ({ id: `m${i}` })) } : { data: [{ id: 'm1000' }] };
    if (q[0] === 'from:team_members' && !has(q, 'range:')) return { data: [{ team_id: 'T1' }] };
    if (q[0] === 'from:users') return { data: { id: ME, name: '<script>alert(1)</script> & co' } };
    if (q[0] === 'from:badges' || q[0] === 'from:user_badges') return { error: { message: 'boom' } };
    return { data: [] };
  };
  it('K3-28c (5a2301e): every section pages past 1000 rows (messages were capped at 100)', async () => {
    mockNext = exportDb;
    jest.spyOn(console, 'error').mockImplementation(() => {});
    const r = await call(exportData, {});
    const body = JSON.parse(r.body);
    expect(body.messages).toHaveLength(1001);
  });
  it('K3-28c (5a2301e): the new sections are there; tournament entries resolve through my teams; a failed section is reported', async () => {
    mockNext = exportDb;
    jest.spyOn(console, 'error').mockImplementation(() => {});
    const body = JSON.parse((await call(exportData, {})).body);
    for (const k of ['teams', 'notifications', 'gifts_sent', 'gifts_received', 'badges', 'blocked_users', 'reviews_written', 'coin_ledger', 'rating_history', 'profile_posts', 'sports', 'sessions', 'tournament_entries']) {
      expect(body).toHaveProperty(k);
    }
    expect(mockLog.find((q) => q[0] === 'from:tournament_entries')!.join()).toContain('in:["team_id",["T1"]]');
    expect(body.incompleteSections).toEqual(['badges']);
  });
  it('K3-28c (5a2301e): no credentials — otp_codes / push_tokens never read, sessions never select the token', async () => {
    mockNext = exportDb;
    jest.spyOn(console, 'error').mockImplementation(() => {});
    await call(exportData, {});
    expect(mockLog.some((q) => q[0] === 'from:otp_codes' || q[0] === 'from:push_tokens')).toBe(false);
    const s = mockLog.find((q) => q[0] === 'from:refresh_tokens')!.find((c) => c.startsWith('select:'))!;
    expect(s).not.toMatch(/\btoken\b|\*/);
  });
  it('K3-28c (5a2301e): stored markup is inert in the file, which is sent as a nosniff attachment', async () => {
    mockNext = exportDb;
    jest.spyOn(console, 'error').mockImplementation(() => {});
    const r = await call(exportData, {});
    expect(r.body).not.toContain('<script>');
    expect(r.body).toContain('\\u003cscript\\u003e');
    expect(JSON.parse(r.body).profile.name).toBe('<script>alert(1)</script> & co');
    expect(r.headers['content-disposition']).toMatch(/^attachment/);
    expect(r.headers['x-content-type-options']).toBe('nosniff');
  });
  it('K3-29 (9835af1): profile_posts are read by author_id, and notifications select the real "read" column', async () => {
    mockNext = exportDb;
    jest.spyOn(console, 'error').mockImplementation(() => {});
    await call(exportData, {});
    expect(mockLog.find((q) => q[0] === 'from:profile_posts')!.join()).toContain(`eq:["author_id","${ME}"]`);
    const n = mockLog.find((q) => q[0] === 'from:notifications')!.find((c) => c.startsWith('select:'))!;
    expect(n).toMatch(/\bread\b/);
    expect(n).not.toContain('is_read');
  });
});

describe('SC-383 · privacy settings', () => {
  test.each(['discoverability', 'message_privacy', 'tag_privacy'])('K3-32 (9086c03): %s: "bogus" → 400 INVALID_VISIBILITY, nothing written', async (k) => {
    const r = await call(updateMe, { body: { [k]: 'bogus' } });
    expect([r.statusCode, r.body.code]).toEqual([400, 'INVALID_VISIBILITY']);
    expect(mockLog.some((q) => has(q, 'update:'))).toBe(false);
  });
});

describe('SC-384 · "Sign out other devices" stops their access tokens now', () => {
  const T = 1_800_000_000_000;
  const at = (revokedMs: number | null) => (q: Q) => (q[0] === 'from:users' && has(q, 'sessions_revoked_at') && q.includes('maybeSingle') ? { data: { sessions_revoked_at: revokedMs == null ? null : new Date(revokedMs).toISOString() } } : { data: null });
  const hit = async (iat: number) => {
    const r = res(); const next = jest.fn();
    await authenticateToken({ headers: { authorization: `Bearer ${generateAccessTokenAt(ME, iat)}` } } as any, r, next);
    return { r, next };
  };
  it('K3-30 (5e5f0c9): a token minted before the revocation is refused 401 SESSION_REVOKED, within its 15 minutes', async () => {
    mockNext = at(Date.now() - 1000);
    const { r, next } = await hit(Math.floor(Date.now() / 1000) - 60);
    expect([r.statusCode, r.body?.code]).toEqual([401, 'SESSION_REVOKED']);
    expect(next).not.toHaveBeenCalled();
  });
  it('K3-30 (5e5f0c9): a token minted after it (and any token for a user who never revoked) passes', async () => {
    mockNext = at(Date.now() - 60_000);
    expect((await hit(Math.floor(Date.now() / 1000))).next).toHaveBeenCalled();
    invalidateRevocationCache(ME);
    mockNext = at(null);
    expect((await hit(Math.floor(Date.now() / 1000) - 600)).next).toHaveBeenCalled();
  });
  it('K3-30 (5e5f0c9): revokeSessionsNow stamps users.sessions_revoked_at and takes effect at once on this instance', async () => {
    mockNext = at(null);
    expect(await isTokenRevoked(ME, Math.floor(Date.now() / 1000) - 5)).toBe(false); // cached: never revoked
    const cutoff = await revokeSessionsNow(ME);
    const upd = mockLog.find((q) => has(q, 'update:[{"sessions_revoked_at"'))!;
    expect(upd.join()).toContain(new Date(cutoff).toISOString());
    mockNext = at(cutoff);
    expect(await isTokenRevoked(ME, Math.floor(Date.now() / 1000) - 5)).toBe(true);
  });
  it('K3-33 (1d241ef): a session from the SAME second as the cutoff is revoked; the replacement stamped the next second survives', async () => {
    mockNext = at(T + 750);
    expect(await isTokenRevoked(ME, Math.floor(T / 1000))).toBe(true);
    expect(await isTokenRevoked(ME, Math.floor((T + 750) / 1000) + 1)).toBe(false);
  });
  it('K3-33 (1d241ef): the stored cutoff keeps millisecond precision (not floored to the second)', async () => {
    jest.useFakeTimers({ now: T + 750 });
    try {
      await revokeSessionsNow(ME);
    } finally { jest.useRealTimers(); }
    expect(mockLog.find((q) => has(q, 'sessions_revoked_at'))!.join()).toContain(new Date(T + 750).toISOString());
  });
});
