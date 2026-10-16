/**
 * F034 (launch test plan, Round 1) · what a sign-in limiter says when it stops someone.
 *
 * express-rate-limit's default answer is an HTML page, 'Too many requests, please try
 * again later.', with no code and no wait, so the app could only show axios' raw
 * 'Request failed with status code 429' (Login, Forgot password) or guess 'wait a few
 * seconds' (the code screen) for a limit that lasts up to an hour.
 */
import type { Request, Response, NextFunction } from 'express';
import type { Options } from 'express-rate-limit';

const WORDS: Record<'otp' | 'auth' | 'busy', { code?: string; text: string }> = {
  otp: { code: 'OTP_IP_LIMIT', text: 'Too many codes asked for from this connection.' },
  auth: { code: 'AUTH_IP_LIMIT', text: 'Too many sign-in tries from this connection.' },
  // F048 (launch test plan, Round 5): the general request budgets (every request, scoring
  // writes, the per-address ceiling) said the same default HTML, and dozens of screens showed
  // 'Request failed with status code 429'. No code on purpose: an app reads a bare 429 as
  // "busy" and words the wait from Retry-After; one that shows the text as is reads this.
  busy: { text: 'Too many requests from you just now.' },
};

export function limitReply(kind: keyof typeof WORDS) {
  return (req: Request, res: Response, _next: NextFunction, options: Options): void => {
    const reset = (req as Request & { rateLimit?: { resetTime?: Date } }).rateLimit?.resetTime;
    const ms = reset instanceof Date ? reset.getTime() - Date.now() : options.windowMs;
    const mins = Math.max(1, Math.ceil(ms / 60_000));
    res.status(options.statusCode).json({
      error: `${WORDS[kind].text} Try again in ${mins} ${mins === 1 ? 'minute' : 'minutes'}.`,
      ...(WORDS[kind].code ? { code: WORDS[kind].code } : {}),
      retry_after_seconds: Math.max(1, Math.ceil(ms / 1000)),
    });
  };
}
