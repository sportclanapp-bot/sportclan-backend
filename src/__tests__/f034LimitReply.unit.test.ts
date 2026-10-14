/**
 * F034 (launch test plan, Round 1) · the sign-in limiters (5 codes an hour, 20 sign-in
 * tries in 15 minutes from one connection) answered with express-rate-limit's default
 * HTML 'Too many requests, please try again later.' — no code, no wait — so the app
 * showed 'Request failed with status code 429'. They now answer a sentence with the wait.
 */
import express from 'express';
import rateLimit from 'express-rate-limit';
import http from 'http';
import { limitReply } from '../utils/limitReply';

async function hit(kind: 'otp' | 'auth', n: number) {
  const app = express();
  app.use(rateLimit({ windowMs: 60 * 60 * 1000, max: 1, standardHeaders: true, legacyHeaders: false, handler: limitReply(kind) }));
  app.post('/x', (_q, r) => { r.json({ ok: true }); });
  const srv = http.createServer(app).listen(0);
  const port = (srv.address() as { port: number }).port;
  let last: { status: number; body: any; retry: string | null } = { status: 0, body: null, retry: null };
  for (let i = 0; i < n; i++) {
    const r = await fetch(`http://127.0.0.1:${port}/x`, { method: 'POST' });
    last = { status: r.status, body: await r.json().catch(() => null), retry: r.headers.get('retry-after') };
  }
  srv.close();
  return last;
}

it('codes: JSON with a code and the wait in minutes', async () => {
  const r = await hit('otp', 2);
  expect(r.status).toBe(429);
  expect(r.body).toMatchObject({ code: 'OTP_IP_LIMIT' });
  expect(r.body.error).toMatch(/^Too many codes asked for from this connection\. Try again in (\d+) minutes\.$/);
  expect(Number(r.retry)).toBeGreaterThan(60);
});
it('sign-in tries: JSON with a code and the wait', async () => {
  const r = await hit('auth', 2);
  expect(r.body).toMatchObject({ code: 'AUTH_IP_LIMIT' });
  expect(r.body.error).toMatch(/^Too many sign-in tries from this connection\. Try again in \d+ minutes\.$/);
});
