/**
 * SC-441 (P2) · an OTP must never be sent to a deleted account's number.
 *
 * The deleted check existed only on the VERIFY paths. So requesting a code for a
 * deleted number succeeded, the screen said "Code sent by SMS", a real SMS was
 * paid for, and only after the user typed the code did they learn the account
 * was gone. Every retry billed again.
 *
 * This is an ordering property — "refuse BEFORE spending money" — so it is
 * asserted against the source. A behavioural test would need the whole supabase
 * client mocked and would still not prove the check runs before the send, which
 * is the only thing that matters here.
 */
import fs from 'fs';
import path from 'path';

const src = fs.readFileSync(
  path.join(__dirname, '..', 'controllers', 'auth.controller.ts'),
  'utf8',
);
const sendOtpBody = (() => {
  const start = src.indexOf('export async function sendOtp(');
  expect(start).toBeGreaterThan(-1);
  const next = src.indexOf('\nexport ', start + 10);
  return src.slice(start, next === -1 ? undefined : next);
})();

describe('SC-441 · sendOtp refuses a deleted account before sending', () => {
  test('it checks deleted_at at all', () => {
    expect(sendOtpBody).toContain('deleted_at');
    expect(sendOtpBody).toContain('ACCOUNT_DELETED');
  });

  test('the check comes BEFORE the code is generated and sent', () => {
    const check = sendOtpBody.indexOf('deleted_at');
    const generate = sendOtpBody.indexOf('generateOtp()');
    const send = sendOtpBody.indexOf('sendOtpViaChannel(');
    expect(check).toBeGreaterThan(-1);
    expect(generate).toBeGreaterThan(-1);
    expect(send).toBeGreaterThan(-1);
    // The money is spent at sendOtpViaChannel. Refusing after it would be the
    // bug we are fixing.
    expect(check).toBeLessThan(generate);
    expect(check).toBeLessThan(send);
  });

  test('it matches the number the same way the rest of auth does', () => {
    // Not a bare .eq('phone', p) — a number can be stored in several shapes, and
    // missing a variant would let a deleted account through.
    expect(sendOtpBody).toContain('phoneVariants(p)');
  });

  test('it fails OPEN, so a database hiccup cannot block everyone from logging in', () => {
    const check = sendOtpBody.indexOf('deleted_at');
    const tail = sendOtpBody.slice(check);
    expect(tail).toMatch(/catch\s*\{/);
  });

  test('the refusal reuses the wording the verify paths already use', () => {
    expect(sendOtpBody).toContain('This account has been deleted.');
    // Pinned so the two never drift into saying different things about the same
    // account state.
    const occurrences = src.split('This account has been deleted.').length - 1;
    expect(occurrences).toBeGreaterThanOrEqual(4); // 3 verify paths + sendOtp
  });
});
