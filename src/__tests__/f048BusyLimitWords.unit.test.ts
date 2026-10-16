/**
 * F048 (launch test plan, Round 5) · the general request budgets (every request, signed-in
 * scoring writes, the per-address ceiling) answered a 429 with express-rate-limit's default
 * HTML page — no sentence, no wait — so dozens of screens showed 'Request failed with status
 * code 429'. They now answer JSON words with the wait, and no code (an app reads a bare 429
 * as "busy" and keeps using Retry-After).
 */
process.env.JWT_SECRET = process.env.JWT_SECRET || 'test-secret-test-secret-test-secret';
import fs from 'fs';
import path from 'path';
import express from 'express';
import type { AddressInfo } from 'net';
import { MemoryStore } from 'express-rate-limit';
import { makeBudgetLimiters, PER_IP_MAX } from '../utils/budgetLimiters';

it('the browsing budget says it in words with the wait (JSON, no code, Retry-After kept)', async () => {
  const { globalLimiter } = makeBudgetLimiters(() => new MemoryStore());
  const a = express();
  a.set('trust proxy', false);
  a.use(globalLimiter);
  a.use((_q, r) => { r.json({ ok: true }); });
  const s = a.listen(0);
  await new Promise((r) => s.once('listening', r));
  const url = `http://127.0.0.1:${(s.address() as AddressInfo).port}/matches/m1`;
  try {
    for (let i = 0; i < PER_IP_MAX; i++) await fetch(url);
    const r = await fetch(url);
    expect(r.status).toBe(429);
    expect(r.headers.get('content-type')).toMatch(/json/);
    const body = await r.json();
    expect(body.error).toMatch(/^Too many requests from you just now\. Try again in \d+ minutes?\.$/);
    expect(body.code).toBeUndefined();
    expect(Number(r.headers.get('retry-after'))).toBeGreaterThan(0);
  } finally { s.close(); }
}, 60000);

it('the scoring budget and the per-address ceiling use the same words', () => {
  const lim = fs.readFileSync(path.join(__dirname, '../utils/budgetLimiters.ts'), 'utf8');
  expect(lim.match(/handler: limitReply\('busy'\)/g)?.length).toBe(2);
  const idx = fs.readFileSync(path.join(__dirname, '../index.ts'), 'utf8');
  const ceiling = idx.slice(idx.indexOf('const ipCeilingLimiter'), idx.indexOf('app.use(globalLimiter)'));
  expect(ceiling).toMatch(/handler: limitReply\('busy'\)/);
});
