-- SC-384 · make "sign out other devices" actually sign them out.
--
-- THE PROBLEM: revoking sessions deleted the other devices' rows from
-- refresh_tokens, which correctly stops them REFRESHING — but the access token
-- is a stateless JWT with a 900s lifetime, and nothing checked it against
-- anything. So a device the user had just signed out kept full API access for
-- up to fifteen minutes. That is precisely the window that matters, because the
-- reason someone taps "sign out other devices" is that a device is lost,
-- stolen, or shared.
--
-- THE FIX: record WHEN the user last revoked their sessions. Any access token
-- issued before that moment is refused, so revocation takes effect on the very
-- next request instead of whenever the token happens to expire. The device the
-- user is holding is kept signed in by issuing it a fresh token at revoke time,
-- so this cuts off every OTHER device without logging them out of this one.
--
-- Nullable with no default and no backfill: NULL means "never revoked", which
-- is how every existing account already behaves, so no one is signed out by
-- this migration being applied.

ALTER TABLE users
  ADD COLUMN IF NOT EXISTS sessions_revoked_at timestamptz;

COMMENT ON COLUMN users.sessions_revoked_at IS
  'SC-384: access tokens issued before this instant are rejected by authenticateToken. Set by DELETE /account/sessions/all (and account deletion) so a revoked device loses API access immediately rather than after the 15-minute JWT lifetime. NULL = never revoked.';
