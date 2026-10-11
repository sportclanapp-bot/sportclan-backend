-- 142 · Audit #5 (11 Oct 2026): a stranger can no longer make themselves a
-- match's official. On a casual match they OFFER to officiate and the match's
-- creator accepts or declines; on a tournament fixture only the organiser or the
-- tournament's own officials can take it. Additive and safe on existing rows.
ALTER TABLE matches ADD COLUMN IF NOT EXISTS umpire_offer_by uuid REFERENCES users(id);
ALTER TABLE matches ADD COLUMN IF NOT EXISTS umpire_offer_at timestamptz;
