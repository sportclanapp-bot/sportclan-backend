/**
 * N-R3-3 (launch test plan, Round 3, found on the phone): a QR-handed-off result was saved, then answered
 * 500 — completeMatch sets a Server-Timing header after the write, and the in-process response the hand-off
 * uses had no setHeader. The courier saw "Internal server error"; the hub filed it as needing a decision.
 */
import fs from 'fs';
import path from 'path';
import { invokeController } from '../utils/invokeController';

test('a controller that sets a header answers normally', async () => {
  const r = await invokeController<{ ok: boolean }>((_req, res) => { res.setHeader('Server-Timing', 'guards;dur=1'); return res.status(200).json({ ok: true }); }, { userId: 'u' });
  expect(r).toEqual({ status: 200, body: { ok: true } });
});
test('completeMatch does set one (so this matters)', () => {
  expect(fs.readFileSync(path.join(__dirname, '../controllers/matches.controller.ts'), 'utf8')).toContain("res.setHeader('Server-Timing', timer.header());");
});
