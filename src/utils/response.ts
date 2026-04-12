import { Response } from 'express';

// Standardised response helpers. New endpoints should use these; existing
// endpoints can be migrated incrementally.

export function ok(res: Response, data: unknown, meta?: Record<string, unknown>) {
  return res.json({ success: true, data, ...meta });
}

export function err(res: Response, status: number, message: string, code?: string) {
  return res.status(status).json({ success: false, message, ...(code ? { code } : {}) });
}

// Sanitize Supabase/DB error messages so internals don't leak to clients.
// In development mode we pass the raw message through for debugging.
export function sanitizeError(error: { message?: string } | null | undefined): string {
  if (process.env.NODE_ENV !== 'production') {
    return error?.message ?? 'An unexpected error occurred';
  }
  return 'An unexpected error occurred';
}
