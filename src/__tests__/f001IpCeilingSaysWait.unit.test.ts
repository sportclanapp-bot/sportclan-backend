/**
 * F001 (launch test plan) · the per-address ceiling for signed-in users (4000 requests
 * per 15 minutes from one address) had standardHeaders off and no handler, so its 429 was
 * express-rate-limit's default text with no Retry-After, and the app waited its own 30
 * seconds. It now answers like the sign-in limiters (F034): JSON with a code and the
 * wait, and the Retry-After header.
 */
import express from 'express';
import http from 'http';
import fs from 'fs';
import path from 'path';
import { MemoryStore } from 'express-rate-limit';
import { generateAccessToken } from '../utils/jwt';
import * as budget from '../utils/budgetLimiters';

async function hit(n: number, auth: boolean) {
  const make = (budget as unknown as { makeIpCeilingLimiter?: (s: MemoryStore, max?: number) => express.RequestHandler }).makeIpCeilingLimiter;
  expect(typeof make).toBe('function');
  const app = express();
  app.use(make!(new MemoryStore(), 1));
  app.get('/x', (_q, r) => { r.json({ ok: true }); });
  const srv = http.createServer(app).listen(0);
  const port = (srv.address() as { port: number }).port;
  const headers: Record<string, string> = auth ? { Authorization: `Bearer ${generateAccessToken('11111111-1111-1111-1111-111111111111')}` } : {};
  let last: { status: number; body: any; retry: string | null } = { status: 0, body: null, retry: null };
  for (let i = 0; i < n; i++) {
    const r = await fetch(`http://127.0.0.1:${port}/x`, { headers });
    last = { status: r.status, body: await r.json().catch(() => null), retry: r.headers.get('retry-after') };
  }
  srv.close();
  return last;
}

it('a signed-in user over the ceiling gets JSON with a code and the wait', async () => {
  const r = await hit(2, true);
  expect(r.status).toBe(429);
  expect(r.body).toMatchObject({ code: 'IP_LIMIT' });
  expect(r.body.error).toMatch(/^Too many requests from this connection\. Try again in \d+ minutes\.$/);
  expect(r.body.retry_after_seconds).toBeGreaterThan(60);
  expect(Number(r.retry)).toBeGreaterThan(60);
});

it('signed-out traffic is still not counted by this limiter', async () => {
  const r = await hit(3, false);
  expect(r.status).toBe(200);
});

it('the server mounts this limiter, not a copy without the wait', () => {
  const src = fs.readFileSync(path.join(__dirname, '..', 'index.ts'), 'utf8');
  expect(src).toMatch(/const ipCeilingLimiter = makeIpCeilingLimiter\(/);
  expect(src).not.toMatch(/standardHeaders: false/);
});
