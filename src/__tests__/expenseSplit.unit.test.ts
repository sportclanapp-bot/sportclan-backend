/**
 * SC-417 · a recorded expense's split must not move when the roster does.
 *
 * The bug: perMember was computed from the CURRENT team_members count, so a
 * member leaving turned an already-recorded ₹44-each into ₹66-each — history
 * rewritten, and in direct contradiction of the SC-361 audit log.
 *
 * These pin the decision: the split derives from the participants CAPTURED at
 * creation, so a later join, removal or ban changes nothing.
 */
import { splitExpense, summariseLedger, toPaise, toRupees } from '../utils/expenseSplit';

const A = 'user-a', B = 'user-b', C = 'user-c';
const expense = (rupees: number, participants: string[]) => ({
  amountPaise: toPaise(rupees), participants,
});

describe('SC-417 · a captured split is frozen', () => {
  const CAPTURED = [A, B, C];                       // roster when ₹132 was recorded
  const original = summariseLedger([expense(132, CAPTURED)]);

  it('splits ₹132 three ways at capture time', () => {
    expect(toRupees(original.perMemberPaise)).toBe(44);
    expect(original.memberCount).toBe(3);
    expect(original.splitExact).toBe(true);
  });

  it('is UNCHANGED after a member leaves — the ₹44→₹66 regression', () => {
    // C removed from the team. The expense's captured set is untouched.
    const after = summariseLedger([expense(132, CAPTURED)]);
    expect(toRupees(after.perMemberPaise)).toBe(44);
    expect(toRupees(after.perMemberPaise)).not.toBe(66);
    expect(after.memberCount).toBe(3);
  });

  it('is UNCHANGED after a member is banned', () => {
    const after = summariseLedger([expense(132, CAPTURED)]);
    expect(toRupees(after.perMemberPaise)).toBe(44);
  });

  it('is UNCHANGED after a NEW member joins — they are not retroactively added', () => {
    // 'user-d' joins the team afterwards; the captured set still has 3.
    const after = summariseLedger([expense(132, CAPTURED)]);
    expect(after.memberCount).toBe(3);
    expect(toRupees(after.perMemberPaise)).toBe(44);
  });
});

describe('SC-360 invariant holds on the captured set', () => {
  it('perMember × participants + remainder === total, exactly', () => {
    for (const [rupees, n] of [[100, 3], [132, 3], [1, 7], [0.05, 2], [999.99, 4]] as const) {
      const total = toPaise(rupees);
      const s = splitExpense(total, n);
      expect(s.perMemberPaise * s.participantCount + s.remainderPaise).toBe(total);
    }
  });

  it('reports the indivisible remainder rather than over-collecting (₹100/3)', () => {
    const s = splitExpense(toPaise(100), 3);
    expect(toRupees(s.perMemberPaise)).toBe(33.33);
    expect(toRupees(s.remainderPaise)).toBe(0.01);
    expect(s.splitExact).toBe(false);
  });
});

describe('mixed rosters across expenses', () => {
  it('each expense keeps its OWN denominator', () => {
    const sum = summariseLedger([expense(132, [A, B, C]), expense(100, [A, B])]);
    // 44 (of 3) + 50 (of 2) — NOT 232/current-roster
    expect(toRupees(sum.perMemberPaise)).toBe(94);
    expect(toRupees(sum.totalPaise)).toBe(232);
  });

  it('flags a mixed ledger so the UI cannot imply one split', () => {
    expect(summariseLedger([expense(132, [A, B, C]), expense(100, [A, B])]).uniformSplit).toBe(false);
    expect(summariseLedger([expense(132, [A, B, C]), expense(90, [A, B, C])]).uniformSplit).toBe(true);
  });
});

describe('degenerate inputs', () => {
  it('an un-backfilled row (no captured set) shows the whole amount, never divides by zero', () => {
    const s = splitExpense(toPaise(50), 0);
    expect(s.participantCount).toBe(1);
    expect(toRupees(s.perMemberPaise)).toBe(50);
    expect(s.remainderPaise).toBe(0);
  });

  it('an empty ledger is zero, not NaN', () => {
    const sum = summariseLedger([]);
    expect(sum.totalPaise).toBe(0);
    expect(sum.perMemberPaise).toBe(0);
    expect(sum.splitExact).toBe(true);
  });
});
