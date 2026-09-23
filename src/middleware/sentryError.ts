/**
 * Report an unhandled route error, then hand it on untouched.
 *
 * Mounted immediately BEFORE globalErrorHandler. That order matters: the
 * backstop's job is to turn a throw into a sanitised 500 (errorSanitizer strips
 * detail so a stack trace never reaches a caller), and a reporter mounted after
 * it would only ever see the sanitised version. Sentry gets the real error; the
 * caller still gets the safe one.
 *
 * Calls next(err) unconditionally — this middleware must never change the
 * response, only observe it. If reporting itself fails, the request still
 * completes.
 */
import type { Request, Response, NextFunction } from 'express';
import { captureError } from '../utils/sentry';

export function sentryErrorHandler(err: unknown, req: Request, res: Response, next: NextFunction) {
  try {
    captureError(err, {
      method: req.method,
      // The PATH only — never the query string, which carries ids and search
      // terms, and never the body.
      path: req.path,
      userId: (req as Request & { userId?: string }).userId ?? null,
    });
  } catch {
    // A failing error reporter must not become the error.
  }
  next(err);
}
