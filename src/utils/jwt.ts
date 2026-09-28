import jwt, { SignOptions } from 'jsonwebtoken';

// In production the secrets MUST come from the environment. Falling back to the
// public dev literals there would let anyone forge tokens (full auth bypass),
// so fail fast at boot instead. Local/dev keeps the convenience fallback.
if (
  process.env.NODE_ENV === 'production' &&
  (!process.env.JWT_ACCESS_SECRET || !process.env.JWT_REFRESH_SECRET)
) {
  throw new Error(
    'JWT_ACCESS_SECRET and JWT_REFRESH_SECRET must be set in production — refusing to start with the insecure dev fallback.',
  );
}

const ACCESS_SECRET = process.env.JWT_ACCESS_SECRET || 'dev-access-secret-change-me';
const REFRESH_SECRET = process.env.JWT_REFRESH_SECRET || 'dev-refresh-secret-change-me';
const ACCESS_EXPIRES = (process.env.JWT_ACCESS_EXPIRES_IN || '15m') as SignOptions['expiresIn'];
const REFRESH_EXPIRES = (process.env.JWT_REFRESH_EXPIRES_IN || '30d') as SignOptions['expiresIn'];

export interface TokenPayload {
  userId: string;
  /** Issued-at, seconds since epoch. Signed by jsonwebtoken; SC-384 compares it
   *  against users.sessions_revoked_at to reject pre-revocation tokens. */
  iat?: number;
  /** Decision 15: the sign-in (refresh_tokens.id) this access token belongs to,
   *  so signing out that one device can stop it (utils/sessionDeny). Tokens
   *  minted before this shipped have none and run out their 15 minutes. */
  sid?: string;
}

/** `{ sid }` when there is one — a token never carries `sid: undefined`. */
const sidClaim = (sid?: string | null) => (sid ? { sid } : {});

export function generateAccessToken(userId: string, sid?: string | null): string {
  return jwt.sign({ userId, ...sidClaim(sid) }, ACCESS_SECRET, { expiresIn: ACCESS_EXPIRES });
}

/**
 * How long an access token lives, in seconds — read off a real token so it
 * follows JWT_ACCESS_EXPIRES_IN whatever form it's written in ('15m', '900').
 * A signed-out session has to stay refused at least this long.
 */
export const ACCESS_TOKEN_TTL_SECONDS: number = (() => {
  const d = jwt.decode(jwt.sign({}, ACCESS_SECRET, { expiresIn: ACCESS_EXPIRES })) as { iat: number; exp: number };
  return d.exp - d.iat;
})();

/**
 * SC-384: an access token stamped with an explicit issued-at.
 *
 * Used only when replacing the caller's token during session revocation. The
 * revocation cutoff has millisecond precision but `iat` is whole seconds, so a
 * token minted normally in the same second as the cutoff is ambiguous — it
 * either wrongly survives (if the cutoff is rounded down) or wrongly dies (if it
 * isn't). Stamping the replacement with the NEXT whole second removes the
 * ambiguity in the only direction that is safe: every token from the cutoff
 * second is revoked, and the replacement provably postdates it.
 *
 * `expiresIn` is computed from the supplied iat, so the token's lifetime is
 * unchanged — it simply starts a fraction of a second later.
 */
export function generateAccessTokenAt(userId: string, iatSeconds: number, sid?: string | null): string {
  return jwt.sign({ userId, iat: iatSeconds, ...sidClaim(sid) }, ACCESS_SECRET, { expiresIn: ACCESS_EXPIRES });
}

export function generateRefreshToken(userId: string): string {
  return jwt.sign({ userId }, REFRESH_SECRET, { expiresIn: REFRESH_EXPIRES });
}

export function verifyAccessToken(token: string): TokenPayload {
  return jwt.verify(token, ACCESS_SECRET) as TokenPayload;
}

export function verifyRefreshToken(token: string): TokenPayload {
  return jwt.verify(token, REFRESH_SECRET) as TokenPayload;
}
