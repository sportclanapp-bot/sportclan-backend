import { Request, Response, NextFunction } from 'express';

/**
 * Backstop #1 (SC-44): no 5xx response may leak internal detail — Postgres
 * table/constraint/column names, stack fragments, driver strings. Wraps
 * res.json so that ANY endpoint which builds a 500 from a raw error.message is
 * scrubbed centrally, regardless of whether it used sanitizeError(). The
 * original detail is logged server-side only.
 *
 * Mounted early (before routes) so it wraps every subsequent res.json.
 */
export function sanitizeErrorResponses(req: Request, res: Response, next: NextFunction) {
  const originalJson = res.json.bind(res);
  (res as unknown as { json: (b: unknown) => Response }).json = (body: unknown) => {
    if (res.statusCode >= 500 && body && typeof body === 'object') {
      const b = body as Record<string, unknown>;
      const detail = b.error ?? b.message;
      if (typeof detail === 'string' && detail !== 'Internal server error') {
        // eslint-disable-next-line no-console
        console.error(`[5xx ${req.method} ${req.originalUrl}]`, detail);
      }
      if ('error' in b) b.error = 'Internal server error';
      if ('message' in b) b.message = 'Internal server error';
    }
    return originalJson(body as never);
  };
  next();
}

/**
 * Backstop #2: final Express error handler for uncaught throws / rejected async
 * handlers that bubble up. Logs the detail server-side and returns a generic
 * 500. Mounted AFTER all routes.
 */
// eslint-disable-next-line @typescript-eslint/no-unused-vars
export function globalErrorHandler(err: unknown, req: Request, res: Response, _next: NextFunction) {
  const detail = (err as { message?: string })?.message ?? String(err);
  // eslint-disable-next-line no-console
  console.error(`[unhandled ${req.method} ${req.originalUrl}]`, detail);
  if (res.headersSent) return;
  res.status(500).json({ error: 'Internal server error' });
}
