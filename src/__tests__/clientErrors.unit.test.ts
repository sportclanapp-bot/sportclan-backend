/**
 * A bad request is the caller's mistake: it gets a 4xx and is not a crash.
 *
 * SPORTCLAN-BACKEND-3 was "SyntaxError: Unterminated string in JSON" on
 * POST /community/posts — a deliberately malformed body from a QA probe. The
 * body parser threw, sentryErrorHandler reported it, and globalErrorHandler
 * answered 500. So a malformed request both lied to the caller ("our fault")
 * and spent the error quota, and anyone could repeat it at will.
 *
 * These run the real middleware in the real order, on a real socket.
 */
import express from 'express';
import type { AddressInfo } from 'net';
import type { Server } from 'http';

const captured: unknown[] = [];
jest.mock('../utils/sentry', () => ({
  captureError: (err: unknown) => captured.push(err),
}));

import { sentryErrorHandler } from '../middleware/sentryError';
import { globalErrorHandler } from '../middleware/errorSanitizer';

let server: Server;
let base: string;

beforeAll(async () => {
  const app = express();
  app.use(express.json({ limit: '1kb' }));
  app.post('/echo', (req, res) => res.json({ ok: true, got: req.body }));
  app.post('/boom', () => {
    throw new Error('a genuine server fault');
  });
  app.use(sentryErrorHandler);
  app.use(globalErrorHandler);
  await new Promise<void>((r) => {
    server = app.listen(0, () => r());
  });
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});

afterAll(() => new Promise<void>((r) => server.close(() => r())));
beforeEach(() => {
  captured.length = 0;
});

const post = (path: string, body: string) =>
  fetch(`${base}${path}`, { method: 'POST', headers: { 'content-type': 'application/json' }, body });

describe('malformed JSON', () => {
  it('is a 400 that says the body is not JSON', async () => {
    const res = await post('/echo', '{"content": "unterminated');
    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({ error: 'Request body is not valid JSON.' });
  });

  it('is not reported to Sentry', async () => {
    await post('/echo', '{"content": "unterminated');
    expect(captured).toHaveLength(0);
  });
});

describe('an oversized body', () => {
  it('stays a 413 and is not reported either', async () => {
    const res = await post('/echo', JSON.stringify({ x: 'y'.repeat(4096) }));
    expect(res.status).toBe(413);
    expect(captured).toHaveLength(0);
  });
});

describe('the reporter still does its job', () => {
  it('a valid request is untouched', async () => {
    const res = await post('/echo', '{"a":1}');
    expect(res.status).toBe(200);
    expect(captured).toHaveLength(0);
  });

  it('a genuine throw is a sanitised 500 AND is reported', async () => {
    const res = await post('/boom', '{}');
    expect(res.status).toBe(500);
    expect(await res.json()).toEqual({ error: 'Internal server error' });
    expect(captured).toHaveLength(1);
    expect((captured[0] as Error).message).toBe('a genuine server fault');
  });
});
