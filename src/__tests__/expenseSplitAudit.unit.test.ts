/**
 * SC-418 · a split change belongs in the audit trail.
 *
 * Verified before changing anything: the log recorded title+amount on create and
 * never split_among, and `split_among` was not an accepted edit field at all —
 * so a split could not change and nothing could be logged.
 *
 * The trap this pins: the diff used `before !== after`, which on a UUID[] is a
 * REFERENCE compare. Every edit would have logged a phantom split change.
 */
import { sameMemberSet } from '../controllers/teamExpenses.controller';

const A = '11111111-1111-4111-8111-111111111111';
const B = '22222222-2222-4222-8222-222222222222';
const C = '33333333-3333-4333-8333-333333333333';

describe('sameMemberSet — no phantom split changes', () => {
  it('two distinct arrays with the same members are NOT a change', () => {
    // This is the exact case `before !== after` got wrong.
    expect(sameMemberSet([A, B], [A, B])).toBe(true);
  });

  it('order carries no meaning', () => {
    expect(sameMemberSet([A, B, C], [C, A, B])).toBe(true);
  });

  it('a removed participant IS a change', () => {
    expect(sameMemberSet([A, B, C], [A, B])).toBe(false);
  });

  it('an added participant IS a change', () => {
    expect(sameMemberSet([A], [A, B])).toBe(false);
  });

  it('a swapped participant IS a change (same size)', () => {
    expect(sameMemberSet([A, B], [A, C])).toBe(false);
  });

  it('treats null and empty as equal — an un-backfilled row is not a change', () => {
    expect(sameMemberSet(null, [])).toBe(true);
    expect(sameMemberSet(undefined, [])).toBe(true);
  });

  it('null vs a real set IS a change', () => {
    expect(sameMemberSet(null, [A])).toBe(false);
  });

  it('ignores duplicates within a side', () => {
    expect(sameMemberSet([A, A, B], [A, B])).toBe(true);
  });
});
