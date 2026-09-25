/** Server-Timing db rounds: parallel calls are one round, sequential ones are not. */
import { EventEmitter } from 'events';
import { timedFetch, dbTimingMiddleware } from '../utils/dbTiming';

const slowFetch = (ms: number) => (async () => { await new Promise((r) => setTimeout(r, ms)); return new Response('{}'); }) as unknown as typeof fetch;

function runRequest(handler: (f: typeof fetch) => Promise<void>): Promise<string> {
  const f = timedFetch(slowFetch(20));
  const headers: Record<string, string> = {};
  const res = Object.assign(new EventEmitter(), {
    getHeader: (k: string) => headers[k],
    setHeader: (k: string, v: string) => { headers[k] = v; },
    writeHead: () => res,
  }) as any;
  return new Promise((resolve) => {
    dbTimingMiddleware({} as any, res, () => {
      void handler(f).then(() => { res.writeHead(200); resolve(headers['Server-Timing']); });
    });
  });
}

test('sequential calls are separate rounds', async () => {
  const h = await runRequest(async (f) => { await f('a'); await f('b'); await f('c'); });
  expect(h).toContain('db;desc="3 calls, 3 rounds"');
});

test('parallel calls are one round', async () => {
  const h = await runRequest(async (f) => { await Promise.all([f('a'), f('b'), f('c')]); });
  expect(h).toContain('db;desc="3 calls, 1 rounds"');
});

test('appends to a handler\'s own Server-Timing', async () => {
  const f = timedFetch(slowFetch(1));
  const headers: Record<string, string> = { 'Server-Timing': 'load;dur=5' };
  const res = { getHeader: (k: string) => headers[k], setHeader: (k: string, v: string) => { headers[k] = v; }, writeHead: () => res } as any;
  await new Promise<void>((resolve) => dbTimingMiddleware({} as any, res, () => { void f('x').then(() => { res.writeHead(200); resolve(); }); }));
  expect(headers['Server-Timing']).toMatch(/^load;dur=5, db;desc="1 calls, 1 rounds";dur=\d+, app;dur=\d+$/);
});
