/**
 * 2.16.0 rate headroom (11 Oct 2026): scoring writes have their own budget. A
 * user who has spent the whole browsing budget can still score; a script that
 * hammers points is still stopped; browsing still stops at 600.
 */
process.env.JWT_SECRET = process.env.JWT_SECRET || 'test-secret-test-secret-test-secret';
import express from 'express';
import type { AddressInfo } from 'net';
import type { Server } from 'http';
import { MemoryStore } from 'express-rate-limit';
import { makeBudgetLimiters, PER_USER_MAX } from '../utils/budgetLimiters';
import { isScoringWrite, SCORING_PER_USER_MAX } from '../utils/scoringBudget';
import { generateAccessToken } from '../utils/jwt';

const servers: Server[] = [];
afterAll(() => servers.forEach((s) => s.close()));
/** A server with the real budget rules in front of an always-OK route. Returns `call(method, path, auth?)` → status. */
async function app() {
  const { globalLimiter, scoringLimiter } = makeBudgetLimiters(() => new MemoryStore());
  const a = express();
  a.set('trust proxy', false);
  a.use(globalLimiter);
  a.use(scoringLimiter);
  a.use((_req, res) => { res.json({ ok: true }); });
  const s = a.listen(0); servers.push(s);
  await new Promise((r) => s.once('listening', r));
  const base = `http://127.0.0.1:${(s.address() as AddressInfo).port}`;
  return async (method: string, path: string, auth?: Record<string, string>) => (await fetch(base + path, { method, headers: auth })).status;
}

test('which requests are scoring writes', () => {
  const w = (method: string, path: string) => isScoringWrite({ method, path } as never);
  expect([w('POST', '/scoring/m1/event'), w('POST', '/scoring/m1/undo'), w('POST', '/matches/m1/scoring-lease'), w('POST', '/matches/m1/scoring-lease/heartbeat'),
    w('POST', '/matches/m1/typed-score'), w('POST', '/matches/m1/edit-event')]).toEqual([true, true, true, true, true, true]);
  expect([w('GET', '/scoring/m1/events'), w('GET', '/matches/m1'), w('POST', '/matches/m1/complete'), w('POST', '/messages/chats/c/messages')]).toEqual([false, false, false, false]);
});

test('browsing spent to the last request: scoring still goes through; browsing is stopped', async () => {
  const call = await app();
  const auth = { Authorization: `Bearer ${generateAccessToken('11111111-1111-4111-8111-111111111111')}` };
  for (let i = 0; i < PER_USER_MAX; i++) await call('GET', '/matches/m1', auth);
  expect(await call('GET', '/matches/m1', auth)).toBe(429); // browsing: over
  expect(await call('POST', '/scoring/m1/event', auth)).toBe(200); // a point: still in
  expect(await call('POST', '/matches/m1/scoring-lease/heartbeat', auth)).toBe(200);
}, 60000);

test('a script hammering points is still stopped (its own limit), and points never spend the browsing budget', async () => {
  const call = await app();
  const auth = { Authorization: `Bearer ${generateAccessToken('22222222-2222-4222-8222-222222222222')}` };
  for (let i = 0; i < SCORING_PER_USER_MAX; i++) await call('POST', '/scoring/m1/event', auth);
  expect(await call('POST', '/scoring/m1/event', auth)).toBe(429);
  expect(await call('GET', '/matches/m1', auth)).toBe(200); // browsing untouched
}, 60000);

test('not signed in: a scoring write is on the per-IP budget as before', async () => {
  const call = await app();
  for (let i = 0; i < 200; i++) await call('POST', '/scoring/m1/event');
  expect(await call('POST', '/scoring/m1/event')).toBe(429);
}, 60000);
