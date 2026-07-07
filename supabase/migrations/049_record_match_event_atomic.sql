-- 049: record_match_event — atomic, race-safe scoring-event insert (SC-113).
-- A rapid double-tap or two concurrent submits of the SAME scoring action both
-- insert into match_events (no dedup), and recomputeSummary tallies EVERY row →
-- the score inflates permanently (corrupts result + downstream ELO/leaderboard).
-- Confirmed live: 1 ball + a concurrent double = 3 events / runs=3.
--
-- This RPC serializes per-match via an advisory xact lock and dedupes an
-- IDENTICAL event from the same scorer within a short window (default 3s): a
-- double-tap/retry maps to the existing event (idempotent), while genuinely
-- distinct scoring (different clock/payload, or the same event > window later)
-- still inserts normally. Mirrors join_open_match / deduct_coins_if_sufficient.

create or replace function record_match_event(
  p_match_id       uuid,
  p_created_by     uuid,
  p_event_type     text,
  p_period         integer,
  p_clock_seconds  integer,
  p_payload        jsonb,
  p_window_seconds integer default 3
) returns match_events
language plpgsql
as $$
declare
  v_row match_events;
begin
  -- serialize concurrent submits for this match (released at xact end)
  perform pg_advisory_xact_lock(hashtext(p_match_id::text));

  -- dedupe an identical event from the same scorer within the window
  select * into v_row
  from match_events
  where match_id = p_match_id
    and created_by = p_created_by
    and event_type = p_event_type
    and coalesce(period, -1) = coalesce(p_period, -1)
    and coalesce(clock_seconds, -1) = coalesce(p_clock_seconds, -1)
    and coalesce(payload, '{}'::jsonb) = coalesce(p_payload, '{}'::jsonb)
    and created_at > now() - (greatest(p_window_seconds, 0) * interval '1 second')
  order by created_at desc
  limit 1;

  if found then
    return v_row;   -- idempotent: double-tap/retry → the existing event
  end if;

  insert into match_events (match_id, event_type, period, clock_seconds, payload, created_by)
  values (p_match_id, p_event_type, p_period, p_clock_seconds, p_payload, p_created_by)
  returning * into v_row;

  return v_row;
end;
$$;
