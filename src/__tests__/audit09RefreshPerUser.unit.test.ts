/**
 * Audit #9 (11 Oct 2026): a token refresh counted against the IP's shared
 * 20-per-15-minutes /auth budget, so ~20 people on one ground Wi-Fi (or a
 * carrier CGNAT address) were refused and signed out. A refresh with a valid
 * refresh token is now budgeted per user; anything else stays per IP.
 */
import { refreshUserId, budgetUserId, rateLimitKey } from '../middleware/rateLimitKey';
import * as jwt from '../utils/jwt';

const req = (path: string, body: object, headers: Record<string, string> = {}) =>
  ({ baseUrl: '', path, originalUrl: path, body, headers, ip: '203.0.113.7' }) as any;

describe('audit #9: refresh is per user', () => {
  const tok = jwt.generateRefreshToken('user-1');

  it('a valid refresh token names its user', () => {
    expect(refreshUserId(req('/auth/refresh', { refreshToken: tok }))).toBe('user-1');
    expect(budgetUserId(req('/auth/refresh', { refreshToken: tok }))).toBe('user-1');
    expect(rateLimitKey(req('/auth/refresh', { refreshToken: tok }))).toBe('u:user-1');
  });
  it('a junk token, or another route, stays per IP', () => {
    expect(refreshUserId(req('/auth/refresh', { refreshToken: 'junk' }))).toBeNull();
    expect(refreshUserId(req('/auth/login', { refreshToken: tok }))).toBeNull();
    expect(rateLimitKey(req('/auth/refresh', { refreshToken: 'junk' }))).toMatch(/^ip:/);
  });
});
