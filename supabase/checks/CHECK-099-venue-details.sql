-- ===========================================================================
-- CHECK-099 · after migration 099. Each block runs on its own.
-- ===========================================================================


-- ---------------------------------------------------------------------------
-- BLOCK 1 · READ-ONLY · the columns and their types.
-- Expected 4 rows: address text, image_url text, sport_id uuid, surface text —
-- all nullable (is_nullable = YES).
-- ---------------------------------------------------------------------------
SELECT column_name, data_type, is_nullable
FROM information_schema.columns
WHERE table_schema = 'public' AND table_name = 'venues'
  AND column_name IN ('address', 'sport_id', 'surface', 'image_url')
ORDER BY column_name;


-- ---------------------------------------------------------------------------
-- BLOCK 2 · rolled back · a venue with every detail can be written and read.
-- Expected: ERROR "CHECK-099 PASS · all four details stored"
-- ---------------------------------------------------------------------------
DO $$
DECLARE
  sp uuid := (SELECT id FROM public.sports WHERE slug = 'cricket' LIMIT 1);
  r record;
BEGIN
  INSERT INTO public.venues (name, address, sport_id, surface, image_url)
  VALUES ('CHECK-099 venue', '1 Test Road', sp, 'turf', 'https://example.com/v.jpg')
  RETURNING address, sport_id, surface, image_url INTO r;
  IF r.address = '1 Test Road' AND r.sport_id = sp AND r.surface = 'turf' AND r.image_url = 'https://example.com/v.jpg' THEN
    RAISE EXCEPTION 'CHECK-099 PASS · all four details stored';
  END IF;
  RAISE EXCEPTION 'CHECK-099 FAIL · %', row_to_json(r);
END $$;
