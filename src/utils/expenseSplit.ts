/**
 * SC-417 · an expense's split is a fact about the past.
 *
 * perMember used to be computed live from the CURRENT team_members count, so a
 * member leaving turned an already-recorded ₹44-each into ₹66-each. That
 * rewrites history, and it contradicts the SC-361 audit log, which says what
 * happened while the split silently changed underneath it.
 *
 * The participant set is now CAPTURED at creation into `team_expenses.split_among`
 * (an existing, previously-unused column — see migration 086) and every figure
 * derives from that captured set, never from the live roster.
 *
 * The SC-360 invariant is preserved exactly, per expense:
 *     perMemberPaise * participantCount + remainderPaise === totalPaise
 */

/** Integer paise — money is never carried as a float. */
export function toPaise(amount: unknown): number {
  return Math.round(Number(amount ?? 0) * 100);
}
export function toRupees(paise: number): number {
  return Math.round(paise) / 100;
}

export interface SplitResult {
  participantCount: number;
  perMemberPaise: number;
  remainderPaise: number;
  splitExact: boolean;
}

/**
 * Split one expense across its CAPTURED participants.
 *
 * `participantCount` comes from the expense's own `split_among`. A count of 0
 * (a pre-migration row that was never backfilled) is treated as 1 so the figure
 * degrades to "the whole amount" rather than dividing by zero — deliberately
 * conservative: it over-states one member's share rather than inventing a
 * denominator the data does not support.
 */
export function splitExpense(totalPaise: number, participantCount: number): SplitResult {
  const n = Math.max(1, Math.floor(participantCount || 0));
  // SC-360: floor share + explicit remainder. Ceil over-collected (₹100/3 showed
  // ₹34 each = ₹102), so the split didn't add back up to what it was splitting.
  const perMemberPaise = Math.floor(totalPaise / n);
  const remainderPaise = totalPaise - perMemberPaise * n;
  return { participantCount: n, perMemberPaise, remainderPaise, splitExact: remainderPaise === 0 };
}

/**
 * Aggregate a team's ledger from each expense's OWN captured split.
 *
 * `perMember` is what a member present in EVERY expense owes — the sum of the
 * per-expense floor shares. It is NOT `total / current members`, which is the
 * whole point: expenses recorded under different rosters keep their own
 * denominators.
 *
 * `memberCount` reports the participant count when every expense shares one
 * (the ordinary case). When rosters differ across expenses there is no single
 * honest denominator, so it reports the size of the union — the set of people
 * the ledger touches — and `uniformSplit:false` flags that `perMember *
 * memberCount + remainder` will not reconcile, because no single pair can
 * describe a mixed ledger. Callers must show per-expense figures in that case.
 */
export function summariseLedger(
  expenses: Array<{ amountPaise: number; participants: string[] }>,
): {
  totalPaise: number;
  memberCount: number;
  perMemberPaise: number;
  remainderPaise: number;
  splitExact: boolean;
  uniformSplit: boolean;
} {
  let totalPaise = 0, perMemberPaise = 0, remainderPaise = 0;
  const union = new Set<string>();
  const counts = new Set<number>();

  for (const e of expenses) {
    const n = e.participants.length;
    const s = splitExpense(e.amountPaise, n);
    totalPaise += e.amountPaise;
    perMemberPaise += s.perMemberPaise;
    remainderPaise += s.remainderPaise;
    counts.add(s.participantCount);
    for (const p of e.participants) union.add(p);
  }

  const uniformSplit = counts.size <= 1;
  const memberCount = uniformSplit
    ? (counts.values().next().value ?? Math.max(1, union.size))
    : Math.max(1, union.size);

  return {
    totalPaise,
    memberCount,
    perMemberPaise,
    remainderPaise,
    splitExact: remainderPaise === 0,
    uniformSplit,
  };
}
