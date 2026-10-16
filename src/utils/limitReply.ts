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

const WORDS: Record<'otp' | 'auth' | 'account' | 'connection' | 'ipc', { code: string; text: string }> = {
  otp: { code: 'OTP_IP_LIMIT', text: 'Too many codes asked for from this connection.' },
  auth: { code: 'AUTH_IP_LIMIT', text: 'Too many sign-in tries from this connection.' },
  // F048 (launch test plan, Round 5): the general request budgets (every request, scoring
  // writes, the per-address ceiling) said the same default HTML, and dozens of screens showed
  // 'Request failed with status code 429'. N-R5-layout-4: in the words of the budget that was
  // spent — a signed-in person's own (per account), or one address's (per connection) — with a
  // code, so the app shows these words rather than guessing ('from this connection' for an account).
  account: { code: 'ACCOUNT_BUSY', text: 'Too many requests from your account just now.' },
  connection: { code: 'CONNECTION_BUSY', text: 'Too many requests from this connection just now.' },
  // F001 (launch test plan): the per-address ceiling for signed-in users answered with no wait at all.
  ipc: { code: 'IP_LIMIT', text: 'Too many requests from this connection.' },
};

export function limitReply(kind: keyof typeof WORDS) {
  return (req: Request, res: Response, _next: NextFunction, options: Options): void => {
    const reset = (req as Request & { rateLimit?: { resetTime?: Date } }).rateLimit?.resetTime;
    const ms = reset instanceof Date ? reset.getTime() - Date.now() : options.windowMs;
    const mins = Math.max(1, Math.ceil(ms / 60_000));
    res.status(options.statusCode).json({
      error: `${WORDS[kind].text} Try again in ${mins} ${mins === 1 ? 'minute' : 'minutes'}.`,
      code: WORDS[kind].code,
      retry_after_seconds: Math.max(1, Math.ceil(ms / 1000)),
    });
  };
}
