/**
 * Idempotency-key hygiene (SC-179).
 *
 * Every idempotent write (create post/comment, send gift, record match event)
 * forwards the client's `idempotency_key` to a UUID-typed column / RPC param
 * (`client_key uuid` / `p_client_key UUID`). A well-behaved client sends a V4
 * UUID (the app uses expo-crypto `randomUUID()`), but a malformed key — a
 * non-UUID string from a buggy/third-party client — reaches Postgres as text
 * and raises 22P02 "invalid input syntax for type uuid", surfacing as an
 * unhelpful 500 on the core content path.
 *
 * Coerce a non-UUID key to null (best-effort: the write still succeeds, only
 * the per-key dedup is skipped) rather than 400 — a client bug must not block
 * a legitimate post/comment/gift/score. A genuine UUID is passed through
 * unchanged, so real idempotency is unaffected.
 */
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function normalizeClientKey(raw: unknown): string | null {
  return typeof raw === 'string' && UUID_RE.test(raw) ? raw : null;
}
