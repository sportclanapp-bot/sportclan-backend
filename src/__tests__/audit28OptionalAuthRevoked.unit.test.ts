/** Audit #28 (11 Oct 2026): optionalAuth trusted a revoked token. */
let revoked = false;
jest.mock('../utils/sessionRevocation', () => ({ isTokenRevoked: jest.fn(async () => revoked) }));
jest.mock('../utils/sessionDeny', () => ({ isSessionDenied: jest.fn(async () => false) }));
jest.mock('../utils/supabase', () => ({ supabase: {} }));
// eslint-disable-next-line import/first
import { optionalAuth } from '../middleware/auth.middleware';
// eslint-disable-next-line import/first
import { generateAccessToken } from '../utils/jwt';

const run = async () => {
  const req: any = { headers: { authorization: `Bearer ${generateAccessToken('u28')}` } };
  await optionalAuth(req, {} as any, () => undefined);
  return req.userId;
};
describe('audit #28: optionalAuth honours revocation', () => {
  it('a live token names the viewer', async () => { revoked = false; expect(await run()).toBe('u28'); });
  it('a revoked token is anonymous', async () => { revoked = true; expect(await run()).toBeUndefined(); });
});
