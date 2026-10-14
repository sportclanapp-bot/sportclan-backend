-- 155 · N-FMT-5 (launch test plan, Round 2, 14 Oct 2026): a league or group played as best-of-N
-- series (football, hockey, basketball) counted games won as goals in the table. The server now
-- marks such a summary's tie `series: true` and the table sums each game's goals; this marks the
-- series already played the same way (cricket's already are). Only the flag is added — nothing
-- else in the summary changes. Safe to run twice.
UPDATE matches m
   SET score_summary = jsonb_set(m.score_summary, '{tie,series}', 'true'::jsonb, true)
  FROM sports s
 WHERE s.id = m.sport_id
   AND s.slug IN ('football', 'hockey', 'basketball')
   AND (m.rules -> 'tie' ->> 'series') = 'true'
   AND jsonb_typeof(m.score_summary -> 'tie') = 'object'
   AND coalesce(m.score_summary -> 'tie' ->> 'series', '') <> 'true';
