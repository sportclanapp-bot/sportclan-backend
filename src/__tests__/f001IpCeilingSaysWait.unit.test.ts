/**
 * F001 (launch test plan) · the per-address ceiling for signed-in users (4000 requests
 * per 15 minutes from one address then; Q50: 60,000 now) had standardHeaders off and no handler, so its 429 was
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

// Q50 (Dipak, 21 Nov 2026, N-R7-S2): ~350 signed-in viewers on one ground Wi-Fi share one address.
// The ceiling is 60,000 per 15 minutes (was 4,000); it still exists and still answers IP_LIMIT.
describe('Q50: the ceiling is 60,000 per 15 minutes', () => {
  it('the constant and the default the server mounts with', () => {
    expect(budget.PER_IP_AUTHED_CEILING).toBe(60000);
    const src = fs.readFileSync(path.join(__dirname, '..', 'index.ts'), 'utf8');
    expect(src).toMatch(/makeIpCeilingLimiter\(new RedisRateLimitStore\('ipc', 'async'\)\);/); // no max → the constant
  });

  it('7,800 signed-in requests from one address are not refused; request 60,001 is', async () => {
    const mem = new MemoryStore();
    const keys = new Set<string>();
    const store = {
      init: (o: any) => mem.init(o),
      get: (k: string) => mem.get(k),
      increment: (k: string) => { keys.add(k); return mem.increment(k); },
      decrement: (k: string) => mem.decrement(k),
      resetKey: (k: string) => mem.resetKey(k),
    } as any;
    const app = express();
    app.use(budget.makeIpCeilingLimiter(store));
    app.get('/x', (_q, r) => { r.json({ ok: true }); });
    const srv = http.createServer(app).listen(0);
    const port = (srv.address() as { port: number }).port;
    const headers = { Authorization: `Bearer ${generateAccessToken('11111111-1111-1111-1111-111111111111')}` };
    const statuses = new Map<number, number>();
    for (let i = 0; i < 7800; i += 100) {
      const rs = await Promise.all(Array.from({ length: 100 }, () => fetch(`http://127.0.0.1:${port}/x`, { headers })));
      for (const r of rs) statuses.set(r.status, (statuses.get(r.status) ?? 0) + 1);
    }
    expect(Object.fromEntries(statuses)).toEqual({ 200: 7800 }); // was refused from request 4,001
    expect(keys.size).toBe(1);
    const [k] = [...keys];
    for (let i = 7800; i < 60000; i++) await mem.increment(k); // fill to the ceiling
    const atLimit = await fetch(`http://127.0.0.1:${port}/x`, { headers });
    const r = await fetch(`http://127.0.0.1:${port}/x`, { headers });
    srv.close();
    expect(atLimit.status).toBe(429); // 60,001st
    expect(r.status).toBe(429);
    expect(await r.json()).toMatchObject({ code: 'IP_LIMIT' });
  }, 60000);
});
