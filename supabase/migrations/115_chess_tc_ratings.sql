-- 115 · chess ratings per time control (BUILD 3.71).
--
-- user_chess_ratings    a player's chess rating in each time control —
--                       bullet / blitz / rapid / classical (the category the
--                       app works out from the clock, matchRules.chessClockLabel).
-- chess_rating_history  one row per player per rated chess match: the time
--                       control's rating before and after. UNIQUE (user_id,
--                       match_id), so a replayed completion can't apply twice,
--                       and voiding a match reverses exactly what it applied.
--
-- The overall chess rating (user_sport_profiles.rating, written atomically by
-- finalize_match) is untouched: these sit beside it. New tables only — no
-- existing row changes. Everyone starts at 1200 in each time control.
-- Service-role only, like the rest of the rating tables' writes.

CREATE TABLE IF NOT EXISTS public.user_chess_ratings (
  user_id         uuid         NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
  time_control    text         NOT NULL CHECK (time_control IN ('bullet', 'blitz', 'rapid', 'classical')),
  rating          numeric(7,2) NOT NULL DEFAULT 1200,
  matches_played  int          NOT NULL DEFAULT 0,
  wins            int          NOT NULL DEFAULT 0,
  losses          int          NOT NULL DEFAULT 0,
  draws           int          NOT NULL DEFAULT 0,
  updated_at      timestamptz  NOT NULL DEFAULT now(),
  PRIMARY KEY (user_id, time_control)
);

CREATE INDEX IF NOT EXISTS user_chess_ratings_tc_rating_idx
  ON public.user_chess_ratings (time_control, rating DESC);

CREATE TABLE IF NOT EXISTS public.chess_rating_history (
  id            uuid         PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id       uuid         NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
  match_id      uuid         NOT NULL REFERENCES public.matches(id) ON DELETE CASCADE,
  time_control  text         NOT NULL CHECK (time_control IN ('bullet', 'blitz', 'rapid', 'classical')),
  result        text         NOT NULL CHECK (result IN ('win', 'loss', 'draw')),
  old_rating    numeric(7,2) NOT NULL,
  new_rating    numeric(7,2) NOT NULL,
  delta         numeric(7,2) NOT NULL,
  created_at    timestamptz  NOT NULL DEFAULT now(),
  UNIQUE (user_id, match_id)
);

CREATE INDEX IF NOT EXISTS chess_rating_history_user_idx
  ON public.chess_rating_history (user_id, created_at DESC);
CREATE INDEX IF NOT EXISTS chess_rating_history_match_idx
  ON public.chess_rating_history (match_id);

ALTER TABLE public.user_chess_ratings ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.chess_rating_history ENABLE ROW LEVEL SECURITY;

NOTIFY pgrst, 'reload schema';
