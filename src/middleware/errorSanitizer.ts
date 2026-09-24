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
    // Scrub ONLY 500 Internal Server Error — that's where unhandled DB errors
    // (raw Postgres strings) surface. Intentional 5xx like 503 Service
    // Unavailable carry hand-written, safe, user-facing messages (payments/OAuth
    // "feature unavailable") and must be preserved (SC-45).
    if (res.statusCode === 500 && body && typeof body === 'object') {
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
 * express.json's parser rejects a body it cannot parse with a SyntaxError that
 * carries `type: 'entity.parse.failed'` and `status: 400`.
 */
export function isMalformedBody(err: unknown): boolean {
  return (err as { type?: string } | null)?.type === 'entity.parse.failed';
}

/**
 * True for an error that describes a bad REQUEST rather than a fault in the
 * server: the body parser's own rejections (malformed JSON, oversized body,
 * wrong charset), which arrive with a 4xx status and `expose: true`. These get
 * a 4xx response and must not be reported as crashes — a client, or anyone
 * probing the API, could otherwise spend the error quota at will.
 */
export function isClientError(err: unknown): boolean {
  const e = err as { status?: number; statusCode?: number; expose?: boolean } | null;
  const status = e?.status ?? e?.statusCode;
  return typeof status === 'number' && status >= 400 && status < 500 && e?.expose === true;
}

/**
 * Backstop #2: final Express error handler for uncaught throws / rejected async
 * handlers that bubble up. Logs the detail server-side and returns a generic
 * 500. Mounted AFTER all routes.
 */
// eslint-disable-next-line @typescript-eslint/no-unused-vars
export function globalErrorHandler(err: unknown, req: Request, res: Response, _next: NextFunction) {
  const detail = (err as { message?: string })?.message ?? String(err);
  if (isClientError(err)) {
    // A bad request, not a server fault: one line, not an "unhandled" alarm.
    // eslint-disable-next-line no-console
    console.warn(`[bad request ${req.method} ${req.originalUrl}]`, detail);
  } else {
    // eslint-disable-next-line no-console
    console.error(`[unhandled ${req.method} ${req.originalUrl}]`, detail);
  }
  if (res.headersSent) return;
  // A body that isn't JSON is the caller's mistake, not ours: 400, and it says
  // which part of the request was wrong. It used to fall through to a 500 —
  // and, worse, be reported to Sentry as a server crash (SPORTCLAN-BACKEND-3).
  if (isMalformedBody(err)) {
    return res.status(400).json({ error: 'Request body is not valid JSON.' });
  }
  // SC-109: an oversized request body (the express.json limit) throws a
  // PayloadTooLargeError — return a clean 413 instead of a generic 500. The
  // memory ceiling is already bounded by the body-parser limit.
  const e = err as { type?: string; status?: number; statusCode?: number };
  if (e?.type === 'entity.too.large' || e?.status === 413 || e?.statusCode === 413) {
    // SC-351: on an UPLOAD route say what the user can act on. Raising the body
    // limit to 14mb lets a full 10MB image reach the controller's own check, but
    // a body-parser rejection is still possible for anything far over — and
    // "Request payload too large" tells the user nothing about the actual rule.
    // There is always some outer bound; this makes the MESSAGE the same one at
    // every size, so the limit reads as 10MB whether the controller or the
    // parser did the rejecting.
    if (req.originalUrl.startsWith('/uploads/')) {
      return res.status(413).json({ error: 'Image too large (max 10MB)' });
    }
    return res.status(413).json({ error: 'Request payload too large' });
  }
  res.status(500).json({ error: 'Internal server error' });
}
