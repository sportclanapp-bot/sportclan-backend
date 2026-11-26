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
  const chunks: string[][] = [];
  for (let i = 0; i < uniq.length; i += IN_CHUNK) chunks.push(uniq.slice(i, i + IN_CHUNK));
  // Item 23 (25 Nov 2026): the chunks were read one after another (a 1,364-match player's 10). A few at
  // a time now; the rows come back in the same order.
  const got = await inParallel(chunks, (chunk) => selectAll<T>((from, to) => page(chunk, from, to)));
  return got.flat();
}

/** How many reads of one request go at the same time (a long list of chunks must not flood the database). */
export const PARALLEL_READS = 6;
/** `fn` over `items`, at most `limit` at a time, the results in the items' order. The first error is thrown. */
export async function inParallel<A, B>(items: readonly A[], fn: (item: A, index: number) => Promise<B>, limit = PARALLEL_READS): Promise<B[]> {
  const out = new Array<B>(items.length);
  let next = 0;
  let failed = false;
  const worker = async () => {
    while (next < items.length && !failed) {
      const i = next++;
      try { out[i] = await fn(items[i]!, i); } catch (e) { failed = true; throw e; }
    }
  };
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, worker));
  return out;
}

/**
 * Oct 2026 · every row of a query: `build()` returns a fresh query (no range);
 * pages of 1000 in a stable order (`order` column, default id).
 */
export function allRows<T = any>(build: () => any, order = 'id'): Promise<T[]> {
  return selectAll<T>((from, to) => build().order(order, { ascending: true }).range(from, to));
}

/**
 * N-R7-S169 · every row of a query, the pages read at the same time: one count first
 * (`build()` with `{ count: 'exact', head: true }` semantics via `count()`), then every
 * 1000-row page in parallel. For reads that are many pages long (a player's 15k matches
 * took 16 pages one after another). Same rows, same order as allRows; no cap.
 */
export async function allRowsParallel<T = any>(build: () => any, count: () => PromiseLike<{ count: number | null; error: unknown }>, order = 'id'): Promise<T[]> {
  const { count: n, error } = await count();
  if (error) throw error;
  if (n == null) return allRows<T>(build, order); // no count: one page after another, as before
  const pages = Math.max(1, Math.ceil(n / SELECT_ALL_PAGE));
  const got = await Promise.all(Array.from({ length: pages }, (_, i) =>
    Promise.resolve(build().order(order, { ascending: true }).range(i * SELECT_ALL_PAGE, (i + 1) * SELECT_ALL_PAGE - 1)).then((r: { data: T[] | null; error: unknown }) => {
      if (r.error) throw r.error;
      return r.data ?? [];
    })));
  const out = got.flat();
  // rows added between the count and the reads: read on from where the pages stopped
  if (got[got.length - 1].length === SELECT_ALL_PAGE) {
    out.push(...(await selectAll<T>((from, to) => build().order(order, { ascending: true }).range(pages * SELECT_ALL_PAGE + from, pages * SELECT_ALL_PAGE + to))));
  }
  return out;
}
