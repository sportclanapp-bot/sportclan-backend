/**
 * F052 / N-R3C2-4 / N-RWD3-15/16 (launch test plan, Round 5) · admin lists paged by a
 * stable key instead of an offset.
 *
 * Admin › Feedback and Admin › Reports paged with `offset`. Marking feedback done (or
 * dismissing a report) takes a row out of the list on the server, so the next offset
 * skipped one row per action, and two quick "Load more" taps asked for the same offset
 * and skipped a page. A cursor names the last row the app has — its sort time and id —
 * and the next page starts after it, however many rows moved in the meantime.
 *
 * Order: `col` newest first, then id (ascending) to break ties. Rows with no `col`
 * (null) come last, by id. Cursor: "<iso time>|<uuid>", or "null|<uuid>" for a row with
 * no time. Parsed, never spliced raw: only a real timestamp and a real uuid reach the
 * PostgREST filter.
 */
import { isUuid } from './uuid';
import { pageMeta, type Pagination } from './pagination';

export type KeysetCursor = { ts: string | null; id: string };

const ISO = /^\d{4}-\d{2}-\d{2}T[\d:.]+(Z|[+-]\d{2}:?\d{2})?$/;

/** The cursor after this row. */
export function keysetCursor(ts: string | null | undefined, id: string): string {
  return `${ts ?? 'null'}|${id}`;
}

/** A cursor back to the row it names; null when it isn't one. */
export function parseKeysetCursor(raw: unknown): KeysetCursor | null {
  if (typeof raw !== 'string') return null;
  const parts = raw.split('|');
  if (parts.length !== 2) return null;
  const [ts, id] = parts;
  if (!isUuid(id)) return null;
  if (ts === 'null') return { ts: null, id };
  if (!ISO.test(ts) || Number.isNaN(Date.parse(ts))) return null;
  return { ts, id };
}

/**
 * The PostgREST `.or()` filter for "rows after this cursor", in the order above
 * (`col` desc nulls last, id asc). Quoted, so the timestamp's `+` and `:` are value
 * characters.
 */
export function afterKeysetFilter(col: string, c: KeysetCursor): string {
  if (c.ts === null) return `and(${col}.is.null,id.gt.${c.id})`;
  const t = `"${c.ts}"`;
  return `${col}.lt.${t},and(${col}.eq.${t},id.gt.${c.id}),${col}.is.null`;
}

/**
 * A page's paging fields. Without a cursor (the first page, or an older app):
 * total / limit / offset / has_more as before, plus `next_cursor`. With one, `count`
 * is what is left from the cursor on, so it is sent as `remaining` (this page
 * included) — the app adds what it already has to show the total.
 */
export function keysetPageMeta(
  rows: Array<{ id: string } & Record<string, unknown>>,
  col: string,
  count: number | null,
  p: Pagination,
  cursor: KeysetCursor | null,
) {
  const last = rows[rows.length - 1];
  if (!cursor) {
    const meta = pageMeta(count, p);
    return { ...meta, next_cursor: meta.has_more && last ? keysetCursor(last[col] as string | null, last.id) : null };
  }
  const remaining = count ?? 0;
  const has_more = rows.length > 0 && remaining > rows.length;
  return { remaining, limit: p.limit, has_more, next_cursor: has_more && last ? keysetCursor(last[col] as string | null, last.id) : null };
}
