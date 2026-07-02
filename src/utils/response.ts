import { Response } from 'express';

// Standardised response helpers. New endpoints should use these; existing
// endpoints can be migrated incrementally.

export function ok(res: Response, data: unknown, meta?: Record<string, unknown>) {
  return res.json({ success: true, data, ...meta });
}

export function err(res: Response, status: number, message: string, code?: string) {
  return res.status(status).json({ success: false, message, ...(code ? { code } : {}) });
}

// Sanitize Supabase/DB error messages so internals never leak to clients
// (SC-44). Always returns a generic message and logs the real detail
// server-side, regardless of NODE_ENV — relying on the env flag was fragile
// (it isn't set outside prod, so raw Postgres strings were leaking). The 5xx
// response backstop middleware genericizes anything this misses.
export function sanitizeError(error: { message?: string } | null | undefined): string {
  if (error?.message) {
    // eslint-disable-next-line no-console
    console.error('[db/internal error]', error.message);
  }
  return 'Internal server error';
}
