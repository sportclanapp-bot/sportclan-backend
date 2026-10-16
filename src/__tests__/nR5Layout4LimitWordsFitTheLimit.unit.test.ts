/**
 * N-R5-layout-4 (Round 5, found beside F048): a long wait on the general request limit read
 * 'Too many tries from this connection' even when it was a signed-in person's own (per account)
 * budget. Each limiter now says whose budget it was — 'your account' or 'this connection' — with
 * a code, so the app shows those words instead of guessing.
 */
process.env.JWT_SECRET = process.env.JWT_SECRET || 'test-secret-test-secret-test-secret';
import express from 'express';
import type { AddressInfo } from 'net';
import { MemoryStore } from 'express-rate-limit';
import { makeBudgetLimiters, PER_USER_MAX, PER_IP_MAX } from '../utils/budgetLimiters';
import { SCORING_PER_USER_MAX } from '../utils/scoringBudget';
import { generateAccessToken } from '../utils/jwt';

async function spend(method: string, path: string, n: number, auth?: Record<string, string>) {
  const { globalLimiter, scoringLimiter } = makeBudgetLimiters(() => new MemoryStore());
  const a = express();
  a.set('trust proxy', false);
  a.use(globalLimiter);
  a.use(scoringLimiter);
  a.use((_q, r) => { r.json({ ok: true }); });
  const s = a.listen(0);
  await new Promise((r) => s.once('listening', r));
  const url = `http://127.0.0.1:${(s.address() as AddressInfo).port}${path}`;
  try {
    for (let i = 0; i < n; i++) await fetch(url, { method, headers: auth });
    const r = await fetch(url, { method, headers: auth });
    return { status: r.status, body: await r.json() };
  } finally { s.close(); }
}

it("signed in, browsing: 'your account'", async () => {
  const auth = { Authorization: `Bearer ${generateAccessToken('33333333-3333-4333-8333-333333333333')}` };
  const r = await spend('GET', '/matches/m1', PER_USER_MAX, auth);
  expect(r.status).toBe(429);
  expect(r.body).toMatchObject({ code: 'ACCOUNT_BUSY' });
  expect(r.body.error).toMatch(/^Too many requests from your account just now\. Try again in \d+ minutes?\.$/);
}, 60000);

it("signed in, scoring: 'your account'", async () => {
  const auth = { Authorization: `Bearer ${generateAccessToken('44444444-4444-4444-8444-444444444444')}` };
  const r = await spend('POST', '/scoring/m1/event', SCORING_PER_USER_MAX, auth);
  expect(r.status).toBe(429);
  expect(r.body).toMatchObject({ code: 'ACCOUNT_BUSY' });
}, 60000);

it("not signed in: 'this connection'", async () => {
  const r = await spend('GET', '/matches/m1', PER_IP_MAX);
  expect(r.body).toMatchObject({ code: 'CONNECTION_BUSY' });
  expect(r.body.error).toMatch(/^Too many requests from this connection just now\./);
}, 60000);
