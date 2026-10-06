/**
 * Every row of a query, read 1000 at a time.
 *
 * PostgREST answers at most 1000 rows to a query without a range, silently. A
 * count or a list built from one such read stopped at 1000 (Oct 2026 sweep:
 * match history, insights, recaps, story counts…). `page(from, to)` must build
 * a fresh query with a stable order and apply `.range(from, to)`.
 */
export const SELECT_ALL_PAGE = 1000;

export async function selectAll<T>(
  page: (from: number, to: number) => PromiseLike<{ data: T[] | null; error: unknown }>,
  maxRows = Number.POSITIVE_INFINITY, // Oct 2026: every row (it stops at the last page)
): Promise<T[]> {
  const out: T[] = [];
  for (let from = 0; from < maxRows; from += SELECT_ALL_PAGE) {
    const { data, error } = await page(from, from + SELECT_ALL_PAGE - 1);
    if (error) throw error;
    const rows = data ?? [];
    out.push(...rows);
    if (rows.length < SELECT_ALL_PAGE) break;
  }
  return out;
}

/** Ids per `.in()` — keeps the request's URL short (a uuid is 36 characters). */
export const IN_CHUNK = 150;

/**
 * Oct 2026 · every row for a long list of ids: the ids in chunks (a URL can't
 * hold thousands), each chunk read 1000 rows at a time. `page(ids, from, to)`
 * builds a fresh query with `.in(col, ids)`, a stable order and `.range(from, to)`.
 */
export async function selectAllIn<T>(
  ids: readonly string[],
  page: (ids: string[], from: number, to: number) => PromiseLike<{ data: T[] | null; error: unknown }>,
): Promise<T[]> {
  const uniq = [...new Set(ids)];
  const out: T[] = [];
  for (let i = 0; i < uniq.length; i += IN_CHUNK) {
    const chunk = uniq.slice(i, i + IN_CHUNK);
    out.push(...(await selectAll<T>((from, to) => page(chunk, from, to))));
  }
  return out;
}

/**
 * Oct 2026 · every row of a query: `build()` returns a fresh query (no range);
 * pages of 1000 in a stable order (`order` column, default id).
 */
export function allRows<T = any>(build: () => any, order = 'id'): Promise<T[]> {
  return selectAll<T>((from, to) => build().order(order, { ascending: true }).range(from, to));
}
