-- 165 · Q18 (Step 3, Dipak chose B, 21 Nov 2026): a phone number claims invite coins once, ever —
-- even after the account is deleted and the number is freed 30 days later (a new account on the
-- same number used to be able to use a friend's code again: 20 more coins each). One row per
-- number that has used an invite code, kept by a SHA-256 hash of the number (never the number
-- itself, which is erased with the account): hex sha256 of 'sportclan-referral:' || '+91XXXXXXXXXX'.
-- The server writes the row before any coins move (its primary key makes the claim atomic).
-- Server-only, like refresh_token_orphans: RLS on, no policies. No foreign key on user_id (the
-- claim outlives the account). Backfill: every number on an account that already used a code
-- (referred_by set, or a referral_applied_ coin event — a deleted account still holding its
-- number). Additive, nothing existing changes. Safe to run twice.
CREATE TABLE IF NOT EXISTS referral_phone_claims (
  phone_hash text PRIMARY KEY,
  user_id uuid,
  created_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE referral_phone_claims ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON referral_phone_claims FROM PUBLIC;
DO $$
DECLARE pub_roles text;
BEGIN
  SELECT string_agg(quote_ident(rolname), ', ') INTO pub_roles FROM pg_roles WHERE rolname IN ('anon', 'authenticated');
  IF pub_roles IS NOT NULL THEN EXECUTE 'REVOKE ALL ON referral_phone_claims FROM ' || pub_roles; END IF;
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'service_role') THEN EXECUTE 'GRANT ALL ON referral_phone_claims TO service_role'; END IF;
END
$$;
INSERT INTO referral_phone_claims (phone_hash, user_id)
SELECT DISTINCT ON (u.phone) encode(sha256(convert_to('sportclan-referral:' || u.phone, 'UTF8')), 'hex'), u.id
FROM users u
WHERE u.phone ~ '^\+91[6-9][0-9]{9}$'
  AND (u.referred_by IS NOT NULL
       OR EXISTS (SELECT 1 FROM coin_events c WHERE c.user_id = u.id AND c.event_type LIKE 'referral\_applied\_%'))
ORDER BY u.phone, u.created_at
ON CONFLICT (phone_hash) DO NOTHING;
