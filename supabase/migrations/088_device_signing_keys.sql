-- SC-432 · signed QR handoff: the keys that make an offline signature verifiable.
--
-- A scorer at a zero-signal venue hands their unsent scoring to any nearby phone
-- that HAS signal, as a QR code. That phone uploads it. The problem this table
-- solves is the obvious one: the courier must not be able to change what they are
-- carrying, and nor must anyone who photographs the screen.
--
-- The scorer's phone generates an Ed25519 key pair ON THE DEVICE. The private key
-- never leaves it (Keychain / EncryptedSharedPreferences via expo-secure-store);
-- only the PUBLIC key is registered here, while the phone still has signal. The
-- server verifies every handoff against it.
--
-- Asymmetric rather than a shared secret, deliberately. A per-tournament HMAC —
-- the first sketch — needs a secret distributed to every phone, cannot cover
-- casual matches outside a tournament, and means a leak of this table would let
-- anyone forge a scorer's results. A public key leaks nothing.
--
-- KEY PER (user, device), not per user: the lease is already held by a
-- (person, device) pair, so a handoff can be checked against the same identity
-- that was entitled to score.
--
-- ROTATION AND REVOCATION are `revoked_at`, not deletion. A revoked key stays so
-- that an old QR is REJECTED with a reason rather than silently failing to match
-- anything, and so the audit trail of who signed what survives. Re-registering
-- the same device (reinstall, new key pair) revokes the previous row and inserts
-- a new one, which is why the unique index is partial on the live rows.

CREATE TABLE IF NOT EXISTS device_signing_keys (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id     uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  device_id   text NOT NULL,
  -- Raw Ed25519 public key, 32 bytes, base64url. Not a secret.
  public_key  text NOT NULL,
  created_at  timestamptz NOT NULL DEFAULT now(),
  last_used_at timestamptz,
  revoked_at  timestamptz,
  revoked_reason text
);

-- One LIVE key per (user, device). Revoked rows are kept and excluded here, so a
-- rotation is insert-new + revoke-old rather than an overwrite that loses history.
CREATE UNIQUE INDEX IF NOT EXISTS uq_device_signing_keys_live
  ON device_signing_keys (user_id, device_id)
  WHERE revoked_at IS NULL;

CREATE INDEX IF NOT EXISTS idx_device_signing_keys_lookup
  ON device_signing_keys (user_id, device_id, revoked_at);

COMMENT ON TABLE device_signing_keys IS
  'SC-432: public halves of per-device Ed25519 keys used to sign offline QR '
  'handoffs. Private keys never leave the phone. Revoked rows are kept so an old '
  'QR is rejected with a reason rather than silently unmatched.';

-- ─────────────────────────────────────────────────────────────────────────────
-- Replay ledger. The ops inside a handoff are already idempotent — they carry the
-- outbox's own client_key, so re-uploading the same QR dedupes to the same events
-- and changes nothing. This table is not what makes replay SAFE; it is what makes
-- replay HONEST: the second scanner is told "already uploaded", with who did it
-- and when, instead of being shown a success that silently did nothing.
CREATE TABLE IF NOT EXISTS qr_handoffs (
  nonce        text PRIMARY KEY,
  match_id     uuid NOT NULL REFERENCES matches(id) ON DELETE CASCADE,
  scorer_id    uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  device_id    text NOT NULL,
  uploaded_by  uuid REFERENCES users(id) ON DELETE SET NULL,
  op_count     integer NOT NULL DEFAULT 0,
  applied_count integer NOT NULL DEFAULT 0,
  issued_at    timestamptz,
  created_at   timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_qr_handoffs_match ON qr_handoffs (match_id, created_at DESC);

COMMENT ON TABLE qr_handoffs IS
  'SC-432: one row per accepted QR handoff, keyed by the payload nonce. Makes a '
  'replay answer "already uploaded" honestly instead of a silent no-op success.';
