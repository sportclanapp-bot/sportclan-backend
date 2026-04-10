-- OTP codes table: replaces in-memory Map for OTP storage
CREATE TABLE IF NOT EXISTS otp_codes (
  phone      TEXT        PRIMARY KEY,
  code       TEXT        NOT NULL,
  purpose    TEXT        NOT NULL,
  expires_at TIMESTAMPTZ NOT NULL,
  created_at TIMESTAMPTZ DEFAULT now()
);
