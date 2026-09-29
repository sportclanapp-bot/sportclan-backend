/**
 * Phase 4 · K1 · account deletion, sign-in and chat scope.
 *  K1-56 (ea95435) SC-70 — a deleted account can't sign in with a password; the
 *        delete response no longer promises a restore.
 *  K1-60 (d7d3e84) SC-79 — deleting a captain hands the team on (fallback path).
 *  K1-59 (d45f615) SC-75 — chat refuses media; the voice-note upload is off.
 *  K1-64 (74c0210) SC-72 — register refuses a malformed phone before anything.
 * Supabase is mocked: every `from()` is its own query, resolved by mockNext(q).
 */
type Q = string[];
let mockLog: Q[] = [];
let mockNext: (q: Q) => { data?: unknown; error?: unknown; count?: number } = () => ({ data: null, error: null });
let mockRpc: (name: string) => { data?: unknown; error?: unknown } = () => ({ data: null, error: null });
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
  return { supabase: { from: jest.fn(start), rpc: jest.fn(async (n: string) => ({ data: null, error: null, ...mockRpc(n) })) } };
});
jest.mock('../utils/sessionRevocation', () => ({ revokeSessionsNow: jest.fn(async () => Date.now()) }));
jest.mock('../utils/teamVisibility', () => ({ ...jest.requireActual('../utils/teamVisibility'), disbandedTeamIds: jest.fn(async () => new Set()) }));
jest.mock('../utils/otpStore', () => ({
  setOtp: jest.fn(async () => undefined), getOtp: jest.fn(async () => null), deleteOtp: jest.fn(async () => undefined),
  bumpCounter: jest.fn(async () => 1), readCounter: jest.fn(async () => 0), clearCounter: jest.fn(async () => undefined),
}));
jest.mock('bcryptjs', () => ({ hash: jest.fn(async () => 'hash'), compare: jest.fn(async () => true) }));
jest.mock('../utils/r2', () => ({ uploadBuffer: jest.fn(async () => 'https://r2/x') }));

// eslint-disable-next-line import/first
import { deleteAccount } from '../controllers/account.controller';
// eslint-disable-next-line import/first
import { login, register } from '../controllers/auth.controller';
// eslint-disable-next-line import/first
import { sendMessage } from '../controllers/messages.controller';
// eslint-disable-next-line import/first
import { uploadAudio } from '../controllers/uploads.controller';

const ME = '11111111-1111-4111-8111-111111111111';
const VC = '22222222-2222-4222-8222-222222222222';
const OLD = '33333333-3333-4333-8333-333333333333';
const res = () => {
  const r: any = { statusCode: 200, body: null, setHeader: jest.fn() };
  r.status = jest.fn((c: number) => { r.statusCode = c; return r; });
  r.json = jest.fn((b: unknown) => { r.body = b; return r; });
  return r;
};
const call = async (fn: any, req: object) => { const r = res(); await fn({ userId: ME, params: {}, query: {}, body: {}, headers: {}, get: () => undefined, header: () => undefined, ...req }, r); return r; };
const has = (q: Q, s: string) => q.some((c) => c.includes(s));
const writes = () => mockLog.filter((q) => q.some((c) => /^(insert|update|upsert|delete):/.test(c)));

beforeEach(() => {
  mockLog = [];
  mockNext = () => ({ data: null, error: null });
  mockRpc = () => ({ data: null, error: null });
});

describe('K1-56 (ea95435) SC-70 · deletion is final', () => {
  it('K1-56 (ea95435): a deleted account signing in by email + password → 403 ACCOUNT_DELETED, no tokens', async () => {
    mockNext = (q) => {
      if (q[0] === 'from:users' && has(q, 'password_hash')) return { data: { id: ME, email: 'a@b.co', password_hash: 'h', deleted_at: '2026-09-20T00:00:00Z' } };
      if (q[0] === 'from:users' && has(q, 'select:["deleted_at"]')) return { data: { deleted_at: '2026-09-20T00:00:00Z' } };
      return { data: null };
    };
    const r = await call(login, { body: { email: 'a@b.co', password: 'longenough1' } });
    // It failed rarely under load (not reproduced alone): the message carries
    // the response and the users queries, so the next one says why.
    expect({ status: r.statusCode, code: r.body?.code, body: r.statusCode === 403 ? 'ok' : r.body, users: r.statusCode === 403 ? [] : mockLog.filter((q) => q[0] === 'from:users') })
      .toEqual({ status: 403, code: 'ACCOUNT_DELETED', body: 'ok', users: [] });
    expect(r.body.accessToken).toBeUndefined();
    expect(mockLog.some((q) => q[0] === 'from:refresh_tokens')).toBe(false);
  });
  it('K1-56 (ea95435): the delete response says permanent — no "sign in within 30 days to restore"', async () => {
    const r = await call(deleteAccount, { body: { confirmation: 'DELETE' } });
    expect(r.statusCode).toBe(200);
    expect(r.body.message).toMatch(/permanently deleted/);
    expect(r.body.message).toMatch(/cannot be undone/);
    expect(r.body.message).not.toMatch(/restore/i);
  });
});

describe('K1-60 (d7d3e84) SC-79 · a deleted captain hands the team on', () => {
  const teams = (others: unknown[]) => (q: Q) => {
    if (q[0] === 'from:team_members' && has(q, 'select:["team_id"]')) return { data: [{ team_id: 't1' }] };
    if (q[0] === 'from:team_members' && has(q, 'select:["user_id, role, joined_at"]')) return { data: others };
    return { data: null };
  };
  beforeEach(() => { mockRpc = (n) => (n === 'finalize_captaincy_on_delete' ? { error: { code: 'PGRST202', message: 'missing' } } : {}); });
  it('K1-60 (d7d3e84): the vice-captain becomes captain; the leaver drops to player', async () => {
    mockNext = teams([{ user_id: OLD, role: 'player', joined_at: '2026-01-01' }, { user_id: VC, role: 'vice_captain', joined_at: '2026-02-01' }]);
    await call(deleteAccount, { body: { confirmation: 'DELETE' } });
    const tm = writes().filter((q) => q[0] === 'from:team_members');
    expect(tm[0].join(' ')).toContain('update:[{"role":"captain"}]');
    expect(tm[0]).toContain(`eq:["user_id","${VC}"]`);
    expect(tm[1].join(' ')).toContain('update:[{"role":"player"}]');
    expect(tm[1]).toContain(`eq:["user_id","${ME}"]`);
  });
  it('K1-60 (d7d3e84): no vice-captain → the longest-standing member', async () => {
    mockNext = teams([{ user_id: OLD, role: 'player', joined_at: '2026-01-01' }]);
    await call(deleteAccount, { body: { confirmation: 'DELETE' } });
    const tm = writes().filter((q) => q[0] === 'from:team_members');
    expect(tm[0]).toContain(`eq:["user_id","${OLD}"]`);
  });
  it('K1-60 (d7d3e84): the sole member just leaves; the team is not given a captain', async () => {
    mockNext = teams([]);
    await call(deleteAccount, { body: { confirmation: 'DELETE' } });
    const tm = writes().filter((q) => q[0] === 'from:team_members');
    expect(tm).toHaveLength(1);
    expect(tm[0].join(' ')).toContain('delete:[]');
  });
});

describe('K1-59 (d45f615) SC-75 · chat is text + links only', () => {
  it.each([[{ text: 'hi', image_url: 'https://x/a.jpg' }], [{ text: 'hi', audio_url: 'https://x/a.m4a' }], [{ image_url: 'https://x/a.jpg' }]])(
    'K1-59 (d45f615): %j → 400 CHAT_TEXT_ONLY, nothing stored',
    async (body) => {
      const r = await call(sendMessage, { params: { id: 'c1' }, body });
      expect(r.statusCode).toBe(400);
      expect(r.body.code).toBe('CHAT_TEXT_ONLY');
      expect(writes()).toHaveLength(0);
    },
  );
  it('K1-59 (d45f615): the voice-note upload answers 404 VOICE_DISABLED and uploads nothing', async () => {
    const r = await call(uploadAudio, { body: { base64: 'AAAA', mime: 'audio/m4a' } });
    expect(r.statusCode).toBe(404);
    expect(r.body.code).toBe('VOICE_DISABLED');
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    expect(require('../utils/r2').uploadBuffer).not.toHaveBeenCalled();
  });
});

describe('K1-64 (74c0210) SC-72 · register refuses a malformed phone', () => {
  it.each(['12', 'abcdefghij', '98765', '987654321012345', '1234567890'])('K1-64 (74c0210): "%s" → 400 INVALID_PHONE, no account', async (phone) => {
    const r = await call(register, { body: { phone, code: '123456', name: 'Arjun', username: 'arjun_19' } });
    expect(r.statusCode).toBe(400);
    expect(r.body.code).toBe('INVALID_PHONE');
    expect(writes()).toHaveLength(0);
  });
});
