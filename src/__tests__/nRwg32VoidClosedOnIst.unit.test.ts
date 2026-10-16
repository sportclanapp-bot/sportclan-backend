/**
 * N-RWG3-2 (launch test plan) · the late-void refusal gave the closing date as the
 * server's UTC day in another style ('Tue Oct 20 2026'), so for a match that ended between
 * midnight and 5:30 am IST it named the day before the one the app showed. It is now
 * written by the one shared formatter (utils/voidClosedOn, byte-identical in the app):
 * India time, the app's style — 'Wed, 21 Oct · 2:00 am'.
 */
import fs from 'fs';
import path from 'path';

const load = () => {
  let m: { voidClosedOn?: (d: Date) => string } = {};
  try { m = require('../utils/voidClosedOn'); } catch { /* missing before the fix */ }
  expect(typeof m.voidClosedOn).toBe('function');
  return m.voidClosedOn!;
};

it('ended Wed 14 Oct 2:00 am IST → the window closed Wed, 21 Oct · 2:00 am (not Tue 20)', () => {
  const ended = Date.parse('2026-10-13T20:30:00Z'); // 14 Oct, 02:00 IST
  expect(load()(new Date(ended + 7 * 24 * 3600_000))).toBe('Wed, 21 Oct · 2:00 am');
});

it('the same answer whatever zone the server runs in', () => {
  const tz = process.env.TZ;
  try {
    process.env.TZ = 'UTC';
    expect(load()(new Date('2026-10-20T20:30:00Z'))).toBe('Wed, 21 Oct · 2:00 am');
    expect(load()(new Date('2026-10-21T06:30:00Z'))).toBe('Wed, 21 Oct · 12:00 pm');
  } finally {
    process.env.TZ = tz;
  }
});

it('the refusal uses it', () => {
  const src = fs.readFileSync(path.join(__dirname, '..', 'controllers', 'matches.controller.ts'), 'utf8');
  expect(src).toContain("This one closed on ${deadline ? voidClosedOn(deadline) : 'an earlier date'}.");
  expect(src).not.toContain('toDateString()');
});

it("is the app's own file, byte for byte", () => {
  // The app repo beside this one (a checkout), or the app worktree beside this worktree.
  const candidates = ['../../../sportclan-v2/src/utils/voidClosedOn.ts', '../../../r5-ops-app/src/utils/voidClosedOn.ts']
    .map((p) => path.join(__dirname, p)).filter((p) => fs.existsSync(p));
  expect(candidates.length).toBeGreaterThan(0);
  expect(fs.readFileSync(path.join(__dirname, '../utils/voidClosedOn.ts'), 'utf8')).toBe(fs.readFileSync(candidates[0]!, 'utf8'));
});
