// SC-237: safe LIKE / ILIKE search helpers.
//
// User search input reaches PostgREST filters in two shapes:
//   1. .ilike('col', pattern)      — pattern is a BOUND value (PostgREST param),
//      so it can't inject filter syntax; the only risk is LIKE wildcards (% _)
//      in the input acting as wildcards instead of literals.
//   2. .or('col.ilike.PATTERN,..') — PATTERN is concatenated into the filter
//      STRING, so a comma / paren / dot in the input can break out of the ilike
//      value and inject additional filter conditions (or just crash with 500).
//
// escapeLike() fixes (1) for every scope. orIlikeContains() fixes (2) by both
// escaping LIKE metacharacters AND wrapping the value in PostgREST double-quotes
// so commas/parens are literal value characters, never filter syntax.

/**
 * Escape the LIKE metacharacters `\ % _` so user input matches LITERALLY.
 * A bare "%" or "_" must NOT behave as a wildcard (SC-237). Backslash is the
 * default LIKE ESCAPE char in Postgres, so `\%` / `\_` / `\\` are literal.
 */
export function escapeLike(s: string): string {
  return s.replace(/[\\%_]/g, (ch) => `\\${ch}`);
}

/**
 * Build an injection-SAFE OR-of-ilike filter string for supabase `.or()` across
 * one or more columns, matching a "contains" (`%q%`) pattern.
 *
 * Safety: the pattern is wrapped in PostgREST double-quotes, so a comma, paren
 * or dot in `q` is treated as a literal character of the value — NOT as PostgREST
 * filter syntax. This closes both the 500-on-comma crash and the `.or()` filter-
 * injection surface. Inside the quotes we escape PostgREST's own escape chars
 * (`\` and `"`); the LIKE-escaping (escapeLike) is applied first so a literal
 * `%`/`_` in the query stays literal.
 *
 * Example: q = 'Smith, John' →
 *   name.ilike."%Smith, John%",username.ilike."%Smith, John%"
 *   (one ilike value with a literal comma — no injected OR condition)
 */
export function orIlikeContains(columns: string[], q: string): string {
  const pattern = `%${escapeLike(q)}%`;
  const quoted = `"${pattern.replace(/\\/g, '\\\\').replace(/"/g, '\\"')}"`;
  return columns.map((c) => `${c}.ilike.${quoted}`).join(',');
}
