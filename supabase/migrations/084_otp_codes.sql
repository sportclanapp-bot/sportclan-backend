-- SC-398 · migration 084 · durable OTP storage
--
-- WHY: OTP codes lived ONLY in Upstash Redis, and the Redis client threw when
-- UPSTASH_REDIS_REST_URL/TOKEN were unset. sendOtp had no try/catch, so every
-- phone-OTP login — the app's PRIMARY login path — returned a bare
-- 500 "Internal server error". Email login still worked, which masked it.
--
-- The code fix (utils/otpStore.ts) falls back Redis -> Postgres -> memory and
-- ALREADY WORKS without this table. This migration upgrades the fallback from
-- in-memory (correct for one instance only) to Postgres (correct across
-- instances), so a code issued by one Render instance verifies on another.
--
-- SAFE TO APPLY ANY TIME. The code detects the table's presence at runtime and
-- switches to it automatically; nothing needs redeploying afterwards.

CREATE TABLE IF NOT EXISTS public.otp_codes (
  phone       text PRIMARY KEY,
  code        text        NOT NULL,
  purpose     text        NOT NULL DEFAULT 'login',
  expires_at  timestamptz NOT NULL,
  created_at  timestamptz NOT NULL DEFAULT now()
);

-- Sweep index: the only non-PK access pattern is deleting what has expired.
CREATE INDEX IF NOT EXISTS otp_codes_expires_at_idx
  ON public.otp_codes (expires_at);

-- Service-role only. No end user should ever read this table: a client that
-- could SELECT it could read anyone's OTP and take over their account.
ALTER TABLE public.otp_codes ENABLE ROW LEVEL SECURITY;

COMMENT ON TABLE public.otp_codes IS
  'SC-398 · short-lived login OTPs. Service-role only. Rows expire via expires_at and are swept; expiry is ALSO enforced on read in otpStore.getOtp.';
