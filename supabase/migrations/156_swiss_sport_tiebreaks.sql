-- 156 · N-FMT-2 (launch test plan, Round 3, 15 Oct 2026): a Swiss created without its own tie-break
-- order was given chess's (Buchholz, Sonneborn-Berger, wins) in every sport. The server refuses that
-- order for any sport but chess, and the form showed the sport's own standard — so a non-chess Swiss
-- holding exactly it came from that default. It takes the sport's standard (what the form showed):
-- head-to-head, score difference, score scored (cricket: with net run rate). Chess is untouched, and
-- so is any order an organiser chose. Safe to run twice.
UPDATE tournaments t
   SET tiebreaker_rules = CASE WHEN s.slug = 'cricket'
                               THEN '["head_to_head", "nrr", "score_diff", "score_scored"]'::jsonb
                               ELSE '["head_to_head", "score_diff", "score_scored"]'::jsonb END
  FROM sports s
 WHERE s.id = t.sport_id
   AND t.format = 'swiss'
   AND s.slug <> 'chess'
   AND t.tiebreaker_rules = '["buchholz", "sonneborn_berger", "wins"]'::jsonb;
