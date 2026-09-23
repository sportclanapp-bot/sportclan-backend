/**
 * B1 · the two user-facing strings on this side of the wire.
 */
import fs from 'fs';
import path from 'path';

const code = (rel: string) =>
  fs.readFileSync(path.join(__dirname, '..', rel), 'utf8')
    .replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');

describe('F-07 · "Invalid OTP" was developer jargon in a user-facing string', () => {
  const auth = code('controllers/auth.controller.ts');

  it('is gone from both places it was returned', () => {
    expect(auth).not.toContain("error: 'Invalid OTP'");
  });

  it('is replaced by something a person can act on', () => {
    // It must say what to check, because the most common cause is a mistyped
    // digit and the old message offered no next step.
    expect(auth.match(/That code isn.u2019t right\. Check the 6 digits and try again\./g)?.length ?? 0)
      .toBeGreaterThanOrEqual(2);
  });
});

describe('F-24 · the refusal contradicted the score on the screen', () => {
  const m = code('controllers/matches.controller.ts');

  it('no longer claims the match is "level"', () => {
    // A scorer read this at 2–1. Nothing was level; the SETS were 0–0 and the
    // real condition is "no winner decided yet".
    expect(m).not.toContain("This sport can't end level");
  });

  it('names the actual condition instead', () => {
    expect(m).toContain('No side has won this match yet');
  });

  it('keeps the code the app branches on', () => {
    expect(m).toContain("code: 'NEEDS_DECISIVE_WINNER'");
  });
});
