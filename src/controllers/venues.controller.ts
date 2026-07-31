import { Request, Response } from 'express';
import { supabase } from '../utils/supabase';
import { LIMITS, normaliseVenue, VENUE_TOO_LONG } from '../utils/validation';
import { parsePagination } from '../utils/pagination';

// GET /venues?city_id=&q=
// * q present → case-insensitive prefix match on name, ordered by use_count desc
// * q empty   → top 5 most-used venues for the given city
export async function searchVenues(req: Request, res: Response) {
  const { city_id, q } = req.query as Record<string, string | undefined>;
  // SC-368: this was a hardcoded limit of 10 with no offset, so the venues
  // directory could only ever show 10 rows out of 200+ and had no way to reach
  // the rest — the same list-cap class as SC-303..308.
  const { limit, offset } = parsePagination(req.query as Record<string, unknown>, {
    defaultLimit: 30,
    maxLimit: 100,
  });
  let query = supabase
    .from('venues')
    .select('id, name, city_id, use_count, created_at')
    // use_count DESC alone is not a total order — ties (every venue with
    // use_count 1) could shuffle between pages and duplicate/skip rows. id is
    // the tiebreak (the SC-138 rule).
    .order('use_count', { ascending: false })
    .order('id', { ascending: true })
    .range(offset, offset + limit - 1);
  if (city_id) query = query.eq('city_id', city_id);
  if (q && q.trim().length > 0) {
    query = query.ilike('name', `%${q.trim()}%`);
  }
  const { data, error } = await query;
  if (error) return res.status(500).json({ error: error.message });
  const rows = data ?? [];
  return res.json({ venues: rows, has_more: rows.length === limit });
}

// POST /venues  { name, city_id? }
// Creates a venue if it doesn't exist (case insensitive), otherwise returns
// the existing one. createMatch calls this too via upsertVenue below, but
// exposing it as a REST endpoint lets the autocomplete field freshly create.
export async function createVenue(req: Request, res: Response) {
  const userId = req.userId;
  if (!userId) return res.status(401).json({ error: 'Unauthorized' });
  const { name, city_id } = req.body || {};
  // SC-368: the SAME rule the match path uses — this used to be a second,
  // looser implementation (no length cap, and a whitespace-only name returned
  // 200 with a null venue, i.e. "success" having created nothing).
  const clean = normaliseVenue(name);
  if (clean === VENUE_TOO_LONG) {
    return res.status(400).json({
      error: `Venue name must be ${LIMITS.venueMax} characters or fewer.`,
      code: 'VENUE_TOO_LONG',
    });
  }
  if (!clean) return res.status(400).json({ error: 'name is required' });
  const row = await upsertVenue(clean, city_id ?? null, userId);
  if (!row) return res.status(500).json({ error: 'Could not save that venue.' });
  return res.json({ venue: row });
}

// Shared helper used by createMatch to increment use_count on an existing
// venue name or insert a new row. Best-effort — never throws.
export async function upsertVenue(
  name: string,
  cityId: string | null,
  createdBy: string,
): Promise<any | null> {
  try {
    const clean = name.trim();
    if (!clean) return null;
    // SC-369: this was `.ilike('name', clean)` — a case-insensitive EXACT match
    // that no index can serve, on the write path of every match creation. The
    // planner does not rewrite ILIKE into lower(name) = lower($1), so adding a
    // functional index alone would have changed nothing; the query had to move
    // to an equality. PostgREST can't put an expression on the left-hand side,
    // so the equality lives in venue_find_exact() (migration 079), backed by
    // idx_venues_lower_name.
    //
    // Matching semantics are unchanged: case-insensitive, trimmed, and the city
    // filter applies only when a city is supplied.
    const { data: found, error: rpcError } = await supabase
      .rpc('venue_find_exact', { p_name: clean, p_city_id: cityId })
      .limit(1);
    // The temporary ILIKE fallback for the pre-migration window is gone (079 is
    // applied). A failure here is now a real failure, not a missing function.
    if (rpcError) return null;
    const existing: any = Array.isArray(found) ? found[0] ?? null : (found ?? null);
    if (existing) {
      await supabase
        .from('venues')
        .update({ use_count: (existing.use_count ?? 0) + 1 })
        .eq('id', existing.id);
      return { ...existing, use_count: (existing.use_count ?? 0) + 1 };
    }
    const { data: created } = await supabase
      .from('venues')
      .insert({
        name: clean,
        city_id: cityId,
        use_count: 1,
        created_by: createdBy,
      })
      .select('*')
      .single();
    return created ?? null;
  } catch {
    return null;
  }
}
