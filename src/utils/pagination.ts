// Shared list-pagination helper.
//
// Before this, the list endpoints (matches, teams, tournaments, admin users,
// admin reports) all hard-capped at `.limit(100)` with no offset and no total
// count — so at scale (10k+ rows) callers could only ever see the first 100
// rows, couldn't page further, and UIs that derived counts from list.length
// under-reported (the sport-hub "100 TEAMS" bug).
//
// This gives every list endpoint one consistent contract:
//   ?limit=  page size (1..maxLimit, default defaultLimit)
//   ?offset= rows to skip (>=0, default 0)
// and pairs with Supabase's `{ count: 'exact' }` so the SAME query returns both
// the page of rows AND the true total — the pattern the admin stats tiles
// already use correctly.

export interface Pagination {
  limit: number;
  offset: number;
  /** Inclusive start index for supabase `.range()`. */
  from: number;
  /** Inclusive end index for supabase `.range()`. */
  to: number;
}

export function parsePagination(
  query: Record<string, unknown>,
  opts: { defaultLimit?: number; maxLimit?: number } = {},
): Pagination {
  const defaultLimit = opts.defaultLimit ?? 100;
  const maxLimit = opts.maxLimit ?? 100;

  let limit = parseInt(String(query.limit ?? defaultLimit), 10);
  if (!Number.isFinite(limit) || limit <= 0) limit = defaultLimit;
  limit = Math.min(limit, maxLimit);

  let offset = parseInt(String(query.offset ?? 0), 10);
  if (!Number.isFinite(offset) || offset < 0) offset = 0;
  // Cap the offset (SC-41): a huge value made Supabase `.range()` throw a
  // Postgres range error → unhandled 500. Beyond this there's nothing to page.
  offset = Math.min(offset, 1_000_000);

  return { limit, offset, from: offset, to: offset + limit - 1 };
}

/** Standard pagination envelope appended to list responses. */
export function pageMeta(total: number | null, p: Pagination) {
  const t = total ?? 0;
  return {
    total: t,
    limit: p.limit,
    offset: p.offset,
    has_more: p.offset + p.limit < t,
  };
}
