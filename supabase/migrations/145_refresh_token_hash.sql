-- 145 · Audit #19 (11 Oct 2026): refresh tokens were kept in plain text and
-- never changed. From the backend that ships with this: only a SHA-256 hash is
-- looked up (and stored for new sign-ins), and an app that says it can will get
-- a new refresh token on every refresh (prev_token_hash catches a stolen old
-- one being reused). Additive, safe on existing rows and safe to run twice:
-- existing sessions are hashed here so nobody is signed out. The plain-text
-- column is cleared by block 146, which runs AFTER the backend deploy (the old
-- backend still reads it).
ALTER TABLE refresh_tokens ADD COLUMN IF NOT EXISTS token_hash text;
ALTER TABLE refresh_tokens ADD COLUMN IF NOT EXISTS prev_token_hash text;
ALTER TABLE refresh_tokens ADD COLUMN IF NOT EXISTS rotated_at timestamptz;
UPDATE refresh_tokens SET token_hash = encode(sha256(convert_to(token, 'UTF8')), 'hex')
 WHERE token_hash IS NULL AND token IS NOT NULL;
ALTER TABLE refresh_tokens ALTER COLUMN token DROP NOT NULL;
CREATE INDEX IF NOT EXISTS refresh_tokens_token_hash_idx ON refresh_tokens (token_hash);
CREATE INDEX IF NOT EXISTS refresh_tokens_prev_token_hash_idx ON refresh_tokens (prev_token_hash);
