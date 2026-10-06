-- 123 · no cap on events per tournament (Oct 2026, Dipak: no app-imposed caps on quantities)
-- 120 bounded tournaments.event_order to 0–99 (and it is a smallint), so a
-- tournament could hold at most 100 ordered events. The bound goes; the column
-- becomes integer. An event's order is still never negative.
ALTER TABLE tournaments DROP CONSTRAINT IF EXISTS tournaments_event_order_range;
ALTER TABLE tournaments ALTER COLUMN event_order TYPE integer;
ALTER TABLE tournaments ADD CONSTRAINT tournaments_event_order_nonneg
  CHECK (event_order IS NULL OR event_order >= 0);
