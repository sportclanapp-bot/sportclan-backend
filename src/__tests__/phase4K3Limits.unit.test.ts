/**
 * Phase 4 · K3 — rate limiting per person, and typing expiry on the server's
 * clock (SC-431). rateLimit.unit.test.ts states the keying rule on a local copy;
 * these call the real key function and read the real limiter wiring.
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
jest.mock('../utils/chatMembership', () => ({ ...jest.requireActual('../utils/chatMembership'), isActiveMember: jest.fn(async () => true) }));

// eslint-disable-next-line import/first
import { readFileSync } from 'fs';
// eslint-disable-next-line import/first
import { join } from 'path';
// eslint-disable-next-line import/first
import { rateLimitKey, verifiedUserId } from '../middleware/rateLimitKey';
// eslint-disable-next-line import/first
import { generateAccessToken } from '../utils/jwt';
// eslint-disable-next-line import/first
import { getMessages } from '../controllers/messages.controller';

const ME = '11111111-1111-4111-8111-111111111111';
const RAVI = '22222222-2222-4222-8222-222222222222';
const CHAT = '33333333-3333-4333-8333-333333333333';
const req = (ip: string, token?: string) => ({ ip, headers: token ? { authorization: `Bearer ${token}` } : {} }) as any;

beforeEach(() => { mockLog = []; mockNext = () => ({ data: null, error: null }); });

describe('SC-431 · rate-limit the person, not the pipe', () => {
  it('K3-54 (43d7da8): two signed-in users behind one address get separate keys; one user on two addresses shares one', () => {
    expect(rateLimitKey(req('1.2.3.4', generateAccessToken(ME)))).toBe(`u:${ME}`);
    expect(rateLimitKey(req('1.2.3.4', generateAccessToken(RAVI)))).toBe(`u:${RAVI}`);
    expect(rateLimitKey(req('5.6.7.8', generateAccessToken(ME)))).toBe(`u:${ME}`);
  });
  it('K3-54 (43d7da8): no token, or a forged one, stays on the IP bucket', () => {
    expect(rateLimitKey(req('1.2.3.4'))).toBe('ip:1.2.3.4');
    const forged = `${generateAccessToken(ME).slice(0, -4)}AAAA`;
    expect(verifiedUserId(req('1.2.3.4', forged))).toBeNull();
    expect(rateLimitKey(req('1.2.3.4', forged))).toBe('ip:1.2.3.4');
  });
  it('K3-54 (43d7da8): the global limiter keys on rateLimitKey with a per-user budget, and a per-IP ceiling still applies to signed-in traffic', () => {
    const idx = readFileSync(join(__dirname, '..', 'index.ts'), 'utf8');
    const g = idx.slice(idx.indexOf('const globalLimiter = rateLimit({'), idx.indexOf('const ipCeilingLimiter'));
    expect(g).toMatch(/keyGenerator: rateLimitKey,/);
    expect(g).toMatch(/max: \(req\) => \(verifiedUserId\(req\) \? PER_USER_MAX : PER_IP_MAX\),/);
    expect(idx).toMatch(/const PER_USER_MAX = 600;/);
    expect(idx).toMatch(/app\.use\(globalLimiter\);\s*app\.use\(ipCeilingLimiter\);/);
  });
});

describe('SC-431 · a lapsed "typing…" does not linger', () => {
  it('K3-54 (43d7da8): the message poll drops a typing row whose typing_until has passed on the server clock', async () => {
    const past = new Date(Date.now() - 5_000).toISOString();
    const future = new Date(Date.now() + 5_000).toISOString();
    mockNext = (q) => {
      if (q[0] === 'from:chats' || q[0] === 'from:chat_participants' && q.includes('maybeSingle')) return { data: null };
      if (q[0] === 'from:chat_participants' && q.some((c) => c.includes('typing_until'))) return { data: [
        { user_id: RAVI, typing_until: past, user: { id: RAVI, name: 'Ravi' } },  // the DB clock still thought it was live
        { user_id: 'u3', typing_until: future, user: { id: 'u3', name: 'Asha' } },
      ] };
      return { data: [] };
    };
    const r: any = { statusCode: 200 };
    r.status = jest.fn((c: number) => { r.statusCode = c; return r; });
    r.json = jest.fn((b: unknown) => { r.body = b; return r; });
    await getMessages({ userId: ME, params: { id: CHAT }, query: {} } as any, r);
    expect(r.body.typing).toEqual([{ user_id: 'u3', name: 'Asha' }]);
  });
});
