import { hideTestFor, excludeTest } from '../utils/testContent';
import { Request, Response } from 'express';
import { supabase } from '../utils/supabase';
import { LIMITS, normaliseVenue, VENUE_TOO_LONG } from '../utils/validation';
import { parsePagination } from '../utils/pagination';
import { resolveSportId } from '../utils/sportId';

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
    // B07 (migration 099): the details the Add venue form collects, and the
    // city by name — the directory rows show address, surface and city.
    .select('id, name, city_id, use_count, created_at, address, sport_id, surface, image_url, city:cities!city_id(name), sport:sports!sport_id(slug)')
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
  // B03 (V091/V245, D3): test venues ("S2 probe ground") are hidden from real viewers.
  if (await hideTestFor(req.userId)) query = excludeTest(query);
  const { data, error } = await query;
  if (error) return res.status(500).json({ error: error.message });
  // B16 (V091): the sport by slug, so the row can show its icon.
  const rows = (data ?? []).map(({ city, sport, ...v }: any) => ({ ...v, city: city?.name ?? null, sport_slug: sport?.slug ?? null }));
  return res.json({ venues: rows, has_more: rows.length === limit });
}

/**
 * B07 (migration 099) · the optional details from the Add venue form, cleaned.
 * Returns an error string for the first bad one, else the fields to store
 * (only those given).
 */
export async function venueDetails(body: any): Promise<{ error: string } | { fields: Record<string, string> }> {
  const fields: Record<string, string> = {};
  const text = (v: unknown) => (typeof v === 'string' ? v.trim() : '');
  const address = text(body?.address);
  if (address) {
    if (address.length > 200) return { error: 'Address must be 200 characters or fewer.' };
    fields.address = address;
  }
  const surface = text(body?.surface);
  if (surface) {
    if (surface.length > 40) return { error: 'Surface must be 40 characters or fewer.' };
    fields.surface = surface;
  }
  const image = text(body?.image_url);
  if (image) {
    if (image.length > 500 || !/^https:\/\/\S+$/i.test(image)) return { error: 'The cover photo link is not valid.' };
    fields.image_url = image;
  }
  const sportRaw = text(body?.sport_id);
  if (sportRaw) {
    const sportId = await resolveSportId(sportRaw);
    if (!sportId) return { error: 'Unknown sport.' };
    fields.sport_id = sportId;
  }
  return { fields };
}

// POST /venues  { name, city_id?, address?, sport_id?, surface?, image_url? }
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
  const details = await venueDetails(req.body);
  if ('error' in details) return res.status(400).json({ error: details.error, code: 'BAD_VENUE_DETAIL' });
  const row = await upsertVenue(clean, city_id ?? null, userId);
  if (!row) return res.status(500).json({ error: 'Could not save that venue.' });
  // The same venue may already exist (upsert by name + city). Its details are
  // filled in where empty — never overwritten, since someone else may have
  // added that venue first.
  const fill: Record<string, string> = {};
  for (const [k, v] of Object.entries(details.fields)) if (row[k] == null) fill[k] = v;
  if (Object.keys(fill).length === 0) return res.json({ venue: row });
  const { data: updated, error } = await supabase.from('venues').update(fill).eq('id', row.id).select('*').single();
  if (error || !updated) return res.status(500).json({ error: 'Could not save the venue details.' });
  return res.json({ venue: updated });
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
