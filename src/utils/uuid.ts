// Shared UUID guard. Several controllers take :id / user_id params that flow
// straight into `.eq()` filters on uuid columns; a non-UUID value makes
// PostgREST raise 22P02 → a raw 500. Validate first so callers can return a
// clean 400/404 instead (SC-244 class).
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function isUuid(value: unknown): value is string {
  return typeof value === 'string' && UUID_RE.test(value);
}
