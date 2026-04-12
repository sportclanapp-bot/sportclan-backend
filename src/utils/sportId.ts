import { supabase } from './supabase';

// Resolve either a UUID or a slug/name to a real sports.id UUID.
//
// The mobile app has historically passed slug IDs ('cricket', 'badminton')
// as the navigation param for screens like SportHub. Those were added before
// the backend /sports endpoint existed and have never been fully updated.
// The listMatches / listTeams / listTournaments endpoints use .eq('sport_id',
// value) which, against the UUID column, throws 'invalid input syntax for
// type uuid' and returns a 500 to the client.
//
// This helper lets those controllers accept either shape and still filter
// correctly. Unknown slugs return `undefined` so the caller can skip the
// filter (returning all rows) rather than blowing up.

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

// Memoised slug→UUID map. The sports table has 11 rows and changes
// effectively never, so we cache after the first lookup.
let slugMap: Map<string, string> | null = null;
let slugMapAt = 0;
const TTL_MS = 5 * 60 * 1000;

async function loadSlugMap(): Promise<Map<string, string>> {
  if (slugMap && Date.now() - slugMapAt < TTL_MS) return slugMap;
  const { data } = await supabase.from('sports').select('id, name, slug');
  const m = new Map<string, string>();
  for (const row of data ?? []) {
    const id: string = row.id;
    const name: string | null = row.name;
    const slug: string | null = row.slug;
    if (name) m.set(name.toLowerCase(), id);
    if (slug) m.set(slug.toLowerCase(), id);
    // Also accept space-stripped name (e.g. 'tabletennis' for 'Table Tennis')
    if (name) m.set(name.toLowerCase().replace(/\s+/g, ''), id);
  }
  slugMap = m;
  slugMapAt = Date.now();
  return m;
}

export async function resolveSportId(raw: string | undefined): Promise<string | undefined> {
  if (!raw) return undefined;
  if (UUID_RE.test(raw)) return raw;
  const m = await loadSlugMap();
  return m.get(raw.toLowerCase()) ?? undefined;
}
