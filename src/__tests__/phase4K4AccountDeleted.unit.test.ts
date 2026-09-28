/**
 * Phase 4 · K4-55 (274a35c): every deleted-account refusal carries
 * code ACCOUNT_DELETED, so the app can key on one code. The OTP paths are
 * pinned elsewhere (deletedAccountOtp); these are the two sign-in paths that
 * answered a bare 403: password login by email, and a token refresh.
 */
import bcrypt from 'bcryptjs';

const mockUsersRow: Record<string, unknown> = {};
jest.mock('../utils/supabase', () => {
  const from = (table: string) => {
    const chain: any = {};
    for (const m of ['select', 'eq', 'is', 'in', 'not', 'ilike', 'limit', 'update', 'insert']) chain[m] = jest.fn(() => chain);
    chain.maybeSingle = jest.fn(async () => (
      table === 'refresh_tokens'
        ? { data: { id: 'row-1', revoked: false }, error: null }
        : { data: { ...mockUsersRow }, error: null }
    ));
    chain.single = chain.maybeSingle;
    chain.then = (ok: (v: unknown) => unknown) => ok({ data: null, error: null });
    return chain;
  };
  return { supabase: { from, rpc: jest.fn(async () => ({ data: null, error: null })) } };
});
jest.mock('../utils/jwt', () => ({
  ...jest.requireActual('../utils/jwt'),
  verifyRefreshToken: jest.fn(() => ({ userId: 'u1' })),
  generateAccessToken: jest.fn(() => 'access'),
  generateRefreshToken: jest.fn(() => 'refresh'),
}));

// eslint-disable-next-line import/first
import { login, refresh } from '../controllers/auth.controller';

const res = () => {
  const r: any = { statusCode: 200, body: null };
  r.status = jest.fn((c: number) => { r.statusCode = c; return r; });
  r.json = jest.fn((b: unknown) => { r.body = b; return r; });
  return r;
};

beforeEach(() => {
  for (const k of Object.keys(mockUsersRow)) delete mockUsersRow[k];
});

describe('K4-55 · deleted-account refusals carry ACCOUNT_DELETED', () => {
  it('K4-55 (274a35c): a token refresh for a deleted account is 403 ACCOUNT_DELETED', async () => {
    Object.assign(mockUsersRow, { id: 'u1', suspended_at: null, deleted_at: '2026-09-20T00:00:00Z' });
    const r = res();
    await refresh({ body: { refreshToken: 'rt' }, headers: {} } as never, r);
    expect(r.statusCode).toBe(403);
    expect(r.body).toEqual({ error: 'This account has been deleted.', code: 'ACCOUNT_DELETED' });
  });

  it('K4-55 (274a35c): a password sign-in by email to a deleted account is 403 ACCOUNT_DELETED', async () => {
    Object.assign(mockUsersRow, {
      id: 'u1',
      email: 'a@example.com',
      password_hash: bcrypt.hashSync('right-password', 4),
      suspended_at: null,
      deleted_at: '2026-09-20T00:00:00Z',
    });
    const r = res();
    await login({ body: { email: 'a@example.com', password: 'right-password' }, headers: {} } as never, r);
    expect(r.statusCode).toBe(403);
    expect(r.body).toEqual({ error: 'This account has been deleted.', code: 'ACCOUNT_DELETED' });
  });

  it('control: a live account refreshes', async () => {
    Object.assign(mockUsersRow, { id: 'u1', suspended_at: null, deleted_at: null });
    const r = res();
    await refresh({ body: { refreshToken: 'rt' }, headers: {} } as never, r);
    expect(r.statusCode).toBe(200);
    expect(r.body).toEqual({ accessToken: 'access' });
  });
});
