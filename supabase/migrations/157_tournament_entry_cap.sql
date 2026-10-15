-- 157 · F120 (launch test plan, Round 3, 15 Oct 2026): teams added or approved at the same moment
-- could take a tournament past its maximum (4 approved in a tournament of 2): each request counted,
-- then wrote. Approving an entry now takes the tournament's row lock first and counts with it held,
-- so simultaneous approvals queue and the one past the maximum is refused (TOURNAMENT_FULL; the
-- server answers 'Tournament is full'). As before, a team put through automatically isn't capped:
-- a qualifier into the main draw (entry_tag 'Q') and a loser into a consolation draw. Rows already
-- there are untouched. Safe to run twice.
CREATE OR REPLACE FUNCTION public.tournament_entry_cap() RETURNS trigger
LANGUAGE plpgsql SET search_path = public AS $$
DECLARE
  cap integer;
  st jsonb;
  taken integer;
BEGIN
  IF NEW.status IS DISTINCT FROM 'approved' THEN RETURN NEW; END IF;
  IF TG_OP = 'UPDATE' AND OLD.status = 'approved' AND OLD.tournament_id = NEW.tournament_id THEN RETURN NEW; END IF;
  IF NEW.entry_tag = 'Q' THEN RETURN NEW; END IF;
  SELECT t.max_teams, t.settings INTO cap, st FROM tournaments t WHERE t.id = NEW.tournament_id FOR UPDATE;
  IF cap IS NULL OR cap <= 0 THEN RETURN NEW; END IF;
  IF jsonb_typeof(st) = 'object' AND st ? 'consolation' THEN RETURN NEW; END IF;
  SELECT count(*) INTO taken FROM tournament_entries e
   WHERE e.tournament_id = NEW.tournament_id AND e.status = 'approved' AND e.id IS DISTINCT FROM NEW.id;
  IF taken >= cap THEN
    RAISE EXCEPTION 'TOURNAMENT_FULL' USING ERRCODE = 'P0001', DETAIL = 'Tournament is full';
  END IF;
  RETURN NEW;
END $$;

DROP TRIGGER IF EXISTS tournament_entry_cap ON public.tournament_entries;
CREATE TRIGGER tournament_entry_cap
  BEFORE INSERT OR UPDATE OF status, tournament_id ON public.tournament_entries
  FOR EACH ROW EXECUTE FUNCTION public.tournament_entry_cap();
