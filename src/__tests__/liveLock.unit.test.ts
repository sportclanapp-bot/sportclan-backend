/** The live-suite lock: one holder at a time, and a crashed holder does not wedge it. */
import fs from 'fs';
import os from 'os';
import path from 'path';
import { acquireLiveLock } from './liveLock';

const name = `unit-${process.pid}-${Date.now()}`;
const dir = path.join(os.tmpdir(), `sportclan-live-lock-${name}`);
afterAll(() => fs.rmSync(dir, { recursive: true, force: true }));

test('a second holder waits for the first to release', async () => {
  const order: string[] = [];
  const release1 = await acquireLiveLock(name);
  const second = acquireLiveLock(name).then((r) => { order.push('second'); return r; });
  await new Promise((r) => setTimeout(r, 600));
  order.push('first-done');
  release1();
  (await second)();
  expect(order).toEqual(['first-done', 'second']);
});

test('a stale lock (holder crashed) is taken over', async () => {
  fs.mkdirSync(dir);
  const old = new Date(Date.now() - 5 * 60_000);
  fs.utimesSync(dir, old, old);
  const release = await acquireLiveLock(name, 5_000);
  release();
  expect(fs.existsSync(dir)).toBe(false);
});

test('every suite that writes shared QA state takes a lock', () => {
  const shared = ['invites', 'invites.withdraw', 'inviteSportAgnostic', 'follow', 'profileGraphs', 'postLikeState', 'pollMultiChoice', 'readReceipts', 'presenceTyping'];
  for (const f of shared) {
    expect(fs.readFileSync(path.join(__dirname, `${f}.integration.test.ts`), 'utf8')).toMatch(/useLiveLock\('(qa-pair|community|dm)'\);/);
  }
});
