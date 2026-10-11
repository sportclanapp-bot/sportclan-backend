-- 146 · Audit #19 (11 Oct 2026) · RUN AFTER THE BACKEND DEPLOY THAT INCLUDES 145.
-- The new backend finds sessions by token_hash only, so the plain-text copies
-- can go. (Run before that deploy, the old backend would sign everyone out.)
-- Safe to run twice; hashes any row 145 missed first.
UPDATE refresh_tokens SET token_hash = encode(sha256(convert_to(token, 'UTF8')), 'hex')
 WHERE token_hash IS NULL AND token IS NOT NULL;
UPDATE refresh_tokens SET token = NULL WHERE token IS NOT NULL AND token_hash IS NOT NULL;
