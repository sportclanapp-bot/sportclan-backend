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
  maxRows = 100_000,
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
