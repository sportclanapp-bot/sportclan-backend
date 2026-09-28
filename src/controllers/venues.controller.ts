import { hideTestFor, excludeTest } from '../utils/testContent';
import { Request, Response } from 'express';
import { supabase } from '../utils/supabase';
import { LIMITS, normaliseVenue, VENUE_TOO_LONG, queryText } from '../utils/validation';
import { isUuid } from '../utils/uuid';
import { escapeLike } from '../utils/likeSearch';
import { parsePagination } from '../utils/pagination';
import { resolveSportId } from '../utils/sportId';
import { isAdminUser } from '../middleware/admin.middleware';

// GET /venues?city_id=&q=
// * q present → case-insensitive prefix match on name, ordered by use_count desc
// * q empty   → top 5 most-used venues for the given city
export async function searchVenues(req: Request, res: Response) {
  // Phase 3 B10-F2: a repeated `q` arrived as an array (`.trim()` 500'd) and a
  // non-uuid city_id reached a uuid column (22P02 → 500).
  const q = queryText(req.query.q);
  const city_id = queryText(req.query.city_id);
  if (city_id && !isUuid(city_id)) return res.status(400).json({ error: 'Unknown city.' });
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
    .select('id, name, city_id, use_count, created_at, created_by, address, sport_id, surface, image_url, city:cities!city_id(name), sport:sports!sport_id(slug)')
    // use_count DESC alone is not a total order — ties (every venue with
    // use_count 1) could shuffle between pages and duplicate/skip rows. id is
    // the tiebreak (the SC-138 rule).
    .order('use_count', { ascending: false })
    .order('id', { ascending: true })
    .range(offset, offset + limit - 1);
  if (city_id) query = query.eq('city_id', city_id);
  if (q && q.trim().length > 0) {
    // Phase 3 B10-F7: `%` and `_` in the search are literal characters.
    query = query.ilike('name', `%${escapeLike(q.trim())}%`);
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
  // Phase 3 B10-F2: an unchecked city_id made the insert fail, answered as a
  // 500 "Could not save that venue." It must be a real city, or not sent.
  if (city_id != null && city_id !== '') {
    if (!isUuid(city_id)) return res.status(400).json({ error: 'Unknown city.' });
    const { data: city } = await supabase.from('cities').select('id').eq('id', city_id).maybeSingle();
    if (!city) return res.status(400).json({ error: 'Unknown city.' });
  }
  const details = await venueDetails(req.body);
  if ('error' in details) return res.status(400).json({ error: details.error, code: 'BAD_VENUE_DETAIL' });
  // Decision 7: adding a venue that already exists is not a use of it — only
  // a match created there counts (createMatch passes countUse).
  const row = await upsertVenue(clean, city_id || null, userId, { countUse: false });
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
  opts: { countUse?: boolean } = {},
): Promise<any | null> {
  // Decision 7: use_count is the venue's rank in the directory, and it counts
  // matches created there. A repeat "Add venue" with a name that exists
  // returns that venue untouched, and a venue added by hand starts at 0.
  const countUse = opts.countUse ?? true;
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
      if (!countUse) return existing;
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
        use_count: countUse ? 1 : 0,
        created_by: createdBy,
      })
      .select('*')
      .single();
    return created ?? null;
  } catch {
    return null;
  }
}

// PATCH /venues/:id  { name?, city_id?, address?, sport_id?, surface?, image_url? }
// Decision 7: the venue's creator, or an admin, may edit it. Present fields
// only; an empty string clears an optional detail. Renaming onto another
// venue's name (in the same city) is refused — it would make a duplicate that
// the "Add venue" upsert could never tell apart.
export async function updateVenue(req: Request, res: Response) {
  const userId = req.userId;
  if (!userId) return res.status(401).json({ error: 'Unauthorized' });
  const { id } = req.params;
  if (!isUuid(id)) return res.status(400).json({ error: 'Unknown venue.', code: 'INVALID_ID' });
  const { data: venue } = await supabase.from('venues').select('id, name, city_id, created_by').eq('id', id).maybeSingle();
  if (!venue) return res.status(404).json({ error: 'Venue not found.' });
  if (venue.created_by !== userId && !(await isAdminUser(userId))) {
    return res.status(403).json({ error: 'Only the person who added this venue (or an admin) can edit it.' });
  }
  const body = req.body || {};
  const update: Record<string, unknown> = {};
  if ('name' in body) {
    const clean = normaliseVenue(body.name);
    if (clean === VENUE_TOO_LONG) {
      return res.status(400).json({ error: `Venue name must be ${LIMITS.venueMax} characters or fewer.`, code: 'VENUE_TOO_LONG' });
    }
    if (!clean) return res.status(400).json({ error: 'A venue needs a name.' });
    update.name = clean;
  }
  if ('city_id' in body) {
    const c = body.city_id;
    if (c === null || c === '') update.city_id = null;
    else {
      if (!isUuid(c)) return res.status(400).json({ error: 'Unknown city.' });
      const { data: city } = await supabase.from('cities').select('id').eq('id', c).maybeSingle();
      if (!city) return res.status(400).json({ error: 'Unknown city.' });
      update.city_id = c;
    }
  }
  const details = await venueDetails(body);
  if ('error' in details) return res.status(400).json({ error: details.error, code: 'BAD_VENUE_DETAIL' });
  Object.assign(update, details.fields);
  for (const k of ['address', 'surface', 'image_url', 'sport_id']) {
    if (k in body && (body[k] === '' || body[k] === null)) update[k] = null;
  }
  if (Object.keys(update).length === 0) return res.status(400).json({ error: 'Nothing to change.' });
  const newName = (update.name as string | undefined) ?? venue.name;
  const newCity = 'city_id' in update ? (update.city_id as string | null) : venue.city_id;
  if (update.name !== undefined || 'city_id' in update) {
    const { data: found } = await supabase.rpc('venue_find_exact', { p_name: newName, p_city_id: newCity }).limit(5);
    const clash = (Array.isArray(found) ? found : found ? [found] : []).some((v: any) => v?.id && v.id !== id);
    if (clash) return res.status(409).json({ error: 'Another venue already has that name here.', code: 'VENUE_NAME_TAKEN' });
  }
  const { data, error } = await supabase.from('venues').update(update).eq('id', id).select('*').single();
  if (error || !data) return res.status(500).json({ error: 'Could not save the venue.' });
  return res.json({ venue: data });
}
