/**
 * Audit #99 (11 Oct 2026): a database error in a notice started without waiting
 * (court call-up, a pair entry's organiser notice, and others) was an unhandled
 * rejection, and the crash handler stops the server on one. They run through
 * inBackground now, which logs the failure.
 */
import fs from 'fs';
import path from 'path';
import { inBackground } from '../utils/background';

test('a failing background job is logged, not an unhandled rejection', async () => {
  const seen: unknown[] = [];
  const onUnhandled = (r: unknown) => seen.push(r);
  process.on('unhandledRejection', onUnhandled);
  const err = jest.spyOn(console, 'error').mockImplementation(() => undefined);
  inBackground(Promise.reject(new Error('db down')), 'announceCall');
  await new Promise((r) => setTimeout(r, 20));
  process.off('unhandledRejection', onUnhandled);
  expect(seen).toEqual([]);
  expect(err).toHaveBeenCalledWith('[background] announceCall failed', 'db down');
  err.mockRestore();
});

test('no controller fires a job with a bare `void fn(...)` any more; the two named ones catch', () => {
  const dir = path.join(__dirname, '../controllers');
  for (const f of fs.readdirSync(dir).filter((x) => x.endsWith('.ts'))) {
    const s = fs.readFileSync(path.join(dir, f), 'utf8');
    const bare = s.split('\n').filter((l) => /^\s*void [a-zA-Z]+\(.*\);$/.test(l) && !/notifyUsers?\(|Safe\(|logAdminAction\(/.test(l));
    expect({ f, bare }).toEqual({ f, bare: [] });
  }
  expect(fs.readFileSync(path.join(dir, 'courtBoard.controller.ts'), 'utf8')).toMatch(/void announceCall\([^\n]*\.catch\(/);
  expect(fs.readFileSync(path.join(dir, 'pairEntries.controller.ts'), 'utf8')).toMatch(/void tellOrganiser\([^\n]*\.catch\(/);
});
