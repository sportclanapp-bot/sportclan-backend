import { Request, Response } from 'express';
import { supabase } from '../utils/supabase';
import { sanitizeError } from '../utils/response';
import { LIMITS, ARRAY_LIMITS, tooManyItems } from '../utils/validation';
import { isTeamManager } from '../utils/teamAuth';
import { parsePagination } from '../utils/pagination';
import { summariseLedger, splitExpense } from '../utils/expenseSplit';

// ── Team Expense Manager ────────────────────────────────────────────────────
//
// SC-360: this is a shared MONEY ledger, and until now it had no access control
// of any kind — every endpoint took a team id and served it to whoever asked.
// A stranger could read a squad's spending (with payer identities), write
// expenses into it, and — because delete was scoped to created_by — the team's
// own captain could not remove what the stranger wrote. All four endpoints now
// go through requireLedgerAccess first.

/** Categories the DB CHECK constraint accepts (migration 022). */
const EXPENSE_CATEGORIES = [
  'ground', 'registration', 'food', 'uniform', 'equipment', 'travel', 'other',
] as const;

/**
 * Membership gate for the ledger. Returns null when the caller may proceed, or
 * the {status, body} to send back.
 *
 * A ban (SC-359) is checked as well as membership: a removed member's row is
 * gone so the membership check already covers them, but checking the ban makes
 * the intent explicit and survives any future "ban without removing" path.
 */
async function requireLedgerAccess(
  teamId: string,
  userId: string,
): Promise<{ status: number; body: Record<string, unknown> } | null> {
  const { data: membership } = await supabase
    .from('team_members').select('id')
    .eq('team_id', teamId).eq('user_id', userId).maybeSingle();
  if (!membership) {
    // 404 rather than 403 — a non-member shouldn't learn whether the team even
    // has a ledger, and this is the same shape a bad team id gives.
    return { status: 404, body: { error: 'Team not found', code: 'NOT_A_MEMBER' } };
  }
  const { data: ban } = await supabase
    .from('team_bans').select('id')
    .eq('team_id', teamId).eq('user_id', userId).maybeSingle();
  if (ban) {
    return { status: 404, body: { error: 'Team not found', code: 'NOT_A_MEMBER' } };
  }
  return null;
}

/**
 * SC-360: money in paise, not rupees.
 *
 * `amount` is NUMERIC(10,2), but summing the values as JS floats reintroduced
 * binary error — 0.10 + 0.20 came back to the client as 0.30000000000000004 on
 * a screen that shows rupees. Every total here is accumulated as an integer
 * number of paise and converted back exactly once.
 */
function toPaise(amount: unknown): number {
  return Math.round(Number(amount ?? 0) * 100);
}
function toRupees(paise: number): number {
  return Math.round(paise) / 100;
}

/**
 * SC-361: append one entry to the expense audit trail.
 *
 * Everything the entry needs to stay readable is SNAPSHOTTED here — the actor's
 * name, the expense's title and amount — because the table deliberately has no
 * foreign keys and must survive the deletion of the expense, the team, or the
 * user (see migration 077).
 *
 * Returns the insert error, if any, so callers can decide whether losing the
 * trail should fail the action. For a DELETE it must: that's the case where the
 * evidence would otherwise disappear silently.
 */
async function writeExpenseLog(entry: {
  teamId: string;
  expenseId: string;
  action: 'created' | 'updated' | 'deleted';
  actorId: string;
  expenseTitle?: string | null;
  amount?: number | null;
  changes?: Record<string, { from: unknown; to: unknown }> | null;
}): Promise<{ code?: string; message?: string } | null> {
  const { data: actor } = await supabase
    .from('users').select('name').eq('id', entry.actorId).maybeSingle();

  const { error } = await supabase.from('team_expense_log').insert({
    team_id: entry.teamId,
    expense_id: entry.expenseId,
    action: entry.action,
    actor_user_id: entry.actorId,
    actor_name: actor?.name ?? null,
    expense_title: entry.expenseTitle ?? null,
    amount: entry.amount ?? null,
    changes: entry.changes && Object.keys(entry.changes).length > 0 ? entry.changes : null,
  });
  return (error as { code?: string; message?: string } | null) ?? null;
}

/**
 * True when the log table simply isn't there yet (migration 077 not applied).
 *
 * Deleting an expense refuses to proceed if the trail can't be written — but
 * that guard must not brick a working feature in the window between deploying
 * this code and applying the migration. An absent table is a deploy-ordering
 * fact, not a tampering attempt; a real write failure once the table exists
 * still blocks the delete.
 */
function isLogTableMissing(error: { code?: string; message?: string } | null): boolean {
  if (!error) return false;
  // Two shapes, and the second is the one that actually occurs: Postgres says
  // 42P01 "relation does not exist", but PostgREST answers from its schema
  // cache first and returns PGRST205 "Could not find the table … in the schema
  // cache". Matching only 42P01 meant the guard didn't recognise the pre-migration
  // state and blocked every delete.
  if (error.code === '42P01' || error.code === 'PGRST205' || error.code === 'PGRST202') return true;
  const msg = error.message ?? '';
  return msg.includes('team_expense_log') && /does not exist|schema cache|could not find/i.test(msg);
}

/**
 * GET /teams/:id/expenses/log — the trail, newest first.
 *
 * Visible to EVERY member, not just managers: a log only the person being
 * audited can read is not transparency. Same requireLedgerAccess as the ledger
 * itself, so non-members and banned users get nothing.
 *
 * There is deliberately no POST/PATCH/DELETE counterpart — the table is
 * append-only in the database too (migration 077).
 */
export async function listExpenseLog(req: Request, res: Response) {
  const userId = req.userId;
  if (!userId) return res.status(401).json({ error: 'Unauthorized' });
  try {
    const { id } = req.params;
    const denied = await requireLedgerAccess(id!, userId);
    if (denied) return res.status(denied.status).json(denied.body);

    const { limit, offset } = parsePagination(req.query as Record<string, unknown>, {
      defaultLimit: 30,
      maxLimit: 100,
    });

    const { data, error } = await supabase
      .from('team_expense_log')
      .select('*')
      .eq('team_id', id)
      .order('created_at', { ascending: false })
      .range(offset, offset + limit - 1);
    if (error) return res.status(500).json({ error: sanitizeError(error) });

    const rows = data ?? [];
    // No FK means no PostgREST embed — look the actors up in one query and fall
    // back to the snapshotted name for deleted accounts.
    const actorIds = [...new Set(rows.map((r) => r.actor_user_id).filter(Boolean))];
    const actors: Record<string, { id: string; name: string; profile_picture_url: string | null }> = {};
    if (actorIds.length > 0) {
      const { data: users } = await supabase
        .from('users').select('id, name, profile_picture_url').in('id', actorIds);
      for (const u of users ?? []) actors[u.id] = u;
    }

    // Which expenses still exist — lets the UI mark an entry as referring to a
    // deleted expense without a second round trip.
    const expenseIds = [...new Set(rows.map((r) => r.expense_id).filter(Boolean))];
    const alive = new Set<string>();
    if (expenseIds.length > 0) {
      const { data: live } = await supabase
        .from('team_expenses').select('id').in('id', expenseIds);
      for (const e of live ?? []) alive.add(e.id);
    }

    return res.json({
      entries: rows.map((r) => ({
        ...r,
        actor: r.actor_user_id ? actors[r.actor_user_id] ?? null : null,
        expense_deleted: !alive.has(r.expense_id),
      })),
      has_more: rows.length === limit,
    });
  } catch {
    return res.status(500).json({ error: 'Internal server error' });
  }
}

export async function listExpenses(req: Request, res: Response) {
  const userId = req.userId;
  if (!userId) return res.status(401).json({ error: 'Unauthorized' });
  const { id } = req.params;
  try {
    const denied = await requireLedgerAccess(id!, userId);
    if (denied) return res.status(denied.status).json(denied.body);

    const { data, error } = await supabase
      .from('team_expenses')
      .select('*, payer:users!paid_by(id, name, profile_picture_url), creator:users!created_by(id, name)')
      .eq('team_id', id)
      .order('created_at', { ascending: false });
    if (error) return res.status(500).json({ error: sanitizeError(error) });
    return res.json({ expenses: data ?? [] });
  } catch {
    return res.status(500).json({ error: 'Internal server error' });
  }
}

/** Shared field validation for add + update. Returns an error string or null. */
function validateExpenseFields(body: Record<string, any>, partial: boolean): string | null {
  const { title, amount, category, split_among } = body;

  if (!partial || title !== undefined) {
    const t = typeof title === 'string' ? title.trim() : '';
    // SC-360: "   " used to pass the truthiness check and store a blank title.
    if (t.length < 2) return 'Give the expense a title of at least 2 characters.';
    if (t.length > LIMITS.expenseTitleMax) {
      return `Title must be ${LIMITS.expenseTitleMax} characters or fewer.`;
    }
  }
  if (!partial || amount !== undefined) {
    const amt = Number(amount);
    if (!Number.isFinite(amt)) return 'Enter a valid amount.';
    // Round to paise FIRST, then bound-check: 0.004 used to pass (> 0) and then
    // store as 0.00, leaving a ₹0 expense in the ledger.
    const paise = Math.round(amt * 100);
    if (paise < 1) return 'Amount must be at least ₹0.01.';
    if (paise > Math.round(LIMITS.expenseMaxAmount * 100)) {
      return `Amount must be ₹${LIMITS.expenseMaxAmount.toLocaleString('en-IN')} or less.`;
    }
  }
  if (category !== undefined && category !== null) {
    // SC-360: an unknown category hit the DB CHECK and surfaced as a 500. The
    // FE was sending two slugs ('kit', 'transport') that were never valid.
    if (!(EXPENSE_CATEGORIES as readonly string[]).includes(String(category))) {
      return `category must be one of: ${EXPENSE_CATEGORIES.join(', ')}`;
    }
  }
  if (tooManyItems(split_among, ARRAY_LIMITS.splitAmong)) {
    return `Too many split_among entries (max ${ARRAY_LIMITS.splitAmong})`;
  }
  return null;
}

export async function addExpense(req: Request, res: Response) {
  const userId = req.userId;
  if (!userId) return res.status(401).json({ error: 'Unauthorized' });
  try {
    const { id } = req.params;
    const denied = await requireLedgerAccess(id!, userId);
    if (denied) return res.status(denied.status).json(denied.body);

    const body = req.body || {};
    const invalid = validateExpenseFields(body, false);
    if (invalid) return res.status(400).json({ error: invalid });

    const { title, amount, category, paid_by, split_among, notes, match_id, tournament_id } = body;
    const cleanTitle = String(title).trim();
    const cleanAmount = toRupees(toPaise(amount));

    // SC-360: a double-tapped Add used to create two identical expenses — real
    // money, counted twice. There is no client_key column on this table, so
    // dedupe on the natural key within a short window: the same person filing
    // the same title+amount on the same team seconds apart is one expense being
    // submitted twice, not two ground bookings.
    const since = new Date(Date.now() - 15_000).toISOString();
    const { data: dupe } = await supabase
      .from('team_expenses')
      .select('*')
      .eq('team_id', id).eq('created_by', userId)
      .eq('title', cleanTitle).eq('amount', cleanAmount)
      .gte('created_at', since)
      .limit(1)
      .maybeSingle();
    if (dupe) return res.json({ expense: dupe, deduplicated: true });

    // paid_by must be someone actually on the team — otherwise the ledger can
    // name an arbitrary stranger as the payer.
    let payer = paid_by || userId;
    if (paid_by && paid_by !== userId) {
      const { data: payerMember } = await supabase
        .from('team_members').select('id')
        .eq('team_id', id).eq('user_id', paid_by).maybeSingle();
      if (!payerMember) return res.status(400).json({ error: 'paid_by must be a member of this team' });
      payer = paid_by;
    }

    const { data, error } = await supabase
      .from('team_expenses')
      .insert({
        team_id: id,
        title: cleanTitle,
        amount: cleanAmount,
        category: category || 'other',
        paid_by: payer,
        // SC-417: CAPTURE the split set now. This is what freezes history — the
        // summary reads this array, never the live roster, so a later join or
        // removal cannot change what this expense was split between.
        split_among: (Array.isArray(split_among) && split_among.length > 0)
          ? split_among
          : await currentRoster(id!),
        notes: notes || null,
        match_id: match_id || null,
        tournament_id: tournament_id || null,
        created_by: userId,
      })
      .select('*')
      .single();
    if (error) return res.status(500).json({ error: sanitizeError(error) });

    await writeExpenseLog({
      teamId: id!, expenseId: data.id, action: 'created', actorId: userId,
      expenseTitle: data.title, amount: data.amount,
    });
    return res.json({ expense: data });
  } catch {
    return res.status(500).json({ error: 'Internal server error' });
  }
}

/**
 * SC-360: PATCH /teams/:id/expenses/:expenseId — there was no way to correct a
 * mistyped amount at all; the only remedy was delete-and-retype, and only the
 * creator could delete. Editable by the creator or a team manager, same rules
 * as delete.
 */
export async function updateExpense(req: Request, res: Response) {
  const userId = req.userId;
  if (!userId) return res.status(401).json({ error: 'Unauthorized' });
  try {
    const { id, expenseId } = req.params;
    const denied = await requireLedgerAccess(id!, userId);
    if (denied) return res.status(denied.status).json(denied.body);

    // SC-361: select the WHOLE row — the audit entry records old → new, so the
    // "before" values have to be captured before the update overwrites them.
    const { data: existing } = await supabase
      .from('team_expenses').select('*')
      .eq('id', expenseId).eq('team_id', id).maybeSingle();
    if (!existing) return res.status(404).json({ error: 'Expense not found' });

    if (existing.created_by !== userId && !(await isTeamManager(id, userId))) {
      return res.status(403).json({
        error: 'Only the person who logged this expense or a team captain can edit it.',
        code: 'NOT_EXPENSE_EDITOR',
      });
    }

    const body = req.body || {};
    const invalid = validateExpenseFields(body, true);
    if (invalid) return res.status(400).json({ error: invalid });

    const patch: Record<string, unknown> = {};
    if (body.title !== undefined) patch.title = String(body.title).trim();
    if (body.amount !== undefined) patch.amount = toRupees(toPaise(body.amount));
    if (body.category !== undefined) patch.category = body.category || 'other';
    if (body.notes !== undefined) patch.notes = body.notes || null;
    if (body.paid_by !== undefined && body.paid_by) {
      const { data: payerMember } = await supabase
        .from('team_members').select('id')
        .eq('team_id', id).eq('user_id', body.paid_by).maybeSingle();
      if (!payerMember) return res.status(400).json({ error: 'paid_by must be a member of this team' });
      patch.paid_by = body.paid_by;
    }
    if (Object.keys(patch).length === 0) {
      return res.status(400).json({ error: 'Nothing to update.' });
    }

    const { data, error } = await supabase
      .from('team_expenses')
      .update(patch)
      .eq('id', expenseId).eq('team_id', id)
      .select('*')
      .single();
    if (error) return res.status(500).json({ error: sanitizeError(error) });

    // Record only the fields that actually moved — an edit that retypes the
    // same amount shouldn't read as a change to it.
    const changes: Record<string, { from: unknown; to: unknown }> = {};
    for (const field of Object.keys(patch)) {
      const before = (existing as Record<string, unknown>)[field];
      const after = (data as Record<string, unknown>)[field];
      if (field === 'amount' ? toPaise(before) !== toPaise(after) : before !== after) {
        changes[field] = { from: before ?? null, to: after ?? null };
      }
    }
    if (Object.keys(changes).length > 0) {
      await writeExpenseLog({
        teamId: id!, expenseId: expenseId!, action: 'updated', actorId: userId,
        expenseTitle: data.title, amount: data.amount, changes,
      });
    }
    return res.json({ expense: data });
  } catch {
    return res.status(500).json({ error: 'Internal server error' });
  }
}

export async function deleteExpense(req: Request, res: Response) {
  const userId = req.userId;
  if (!userId) return res.status(401).json({ error: 'Unauthorized' });
  try {
    const { id, expenseId } = req.params;
    const denied = await requireLedgerAccess(id!, userId);
    if (denied) return res.status(denied.status).json(denied.body);

    const { data: existing } = await supabase
      .from('team_expenses').select('id, created_by, title, amount')
      .eq('id', expenseId).eq('team_id', id).maybeSingle();
    // SC-32: a missing row (wrong team or id) still 404s.
    if (!existing) return res.status(404).json({ error: 'Expense not found' });

    // SC-360: delete used to be `.eq('created_by', userId)` only, so a wrong
    // entry could outlive everyone's ability to remove it. Managers can now
    // clean up the ledger they are responsible for.
    if (existing.created_by !== userId && !(await isTeamManager(id, userId))) {
      return res.status(403).json({
        error: 'Only the person who logged this expense or a team captain can delete it.',
        code: 'NOT_EXPENSE_EDITOR',
      });
    }

    // SC-361: write the trail FIRST and refuse the delete if it fails. This is
    // the one action where losing the log erases the evidence entirely — a
    // silently unlogged deletion is exactly the hole the log exists to close.
    const logError = await writeExpenseLog({
      teamId: id!, expenseId: expenseId!, action: 'deleted', actorId: userId,
      expenseTitle: existing.title, amount: existing.amount,
    });
    if (logError && !isLogTableMissing(logError)) {
      return res.status(500).json({
        error: 'Could not record this deletion in the team log, so nothing was deleted.',
        code: 'LOG_WRITE_FAILED',
      });
    }

    const { error } = await supabase
      .from('team_expenses').delete()
      .eq('id', expenseId).eq('team_id', id);
    if (error) return res.status(500).json({ error: sanitizeError(error) });
    return res.json({ success: true });
  } catch {
    return res.status(500).json({ error: 'Internal server error' });
  }
}

/**
 * SC-417 · the team's roster right now, used ONLY at expense-creation time to
 * capture the split set. Never called when reading an existing expense.
 */
async function currentRoster(teamId: string): Promise<string[]> {
  const { data } = await supabase
    .from('team_members')
    .select('user_id')
    .eq('team_id', teamId);
  return (data ?? []).map((m: { user_id: string }) => m.user_id).filter(Boolean);
}

export async function getExpenseSummary(req: Request, res: Response) {
  const userId = req.userId;
  if (!userId) return res.status(401).json({ error: 'Unauthorized' });
  try {
    const { id } = req.params;
    const denied = await requireLedgerAccess(id!, userId);
    if (denied) return res.status(denied.status).json(denied.body);

    const { data: expenses } = await supabase
      .from('team_expenses')
      .select('amount, split_among')
      .eq('team_id', id);

    // SC-417: every figure derives from each expense's CAPTURED split_among, not
    // from the live member count. Removing a member no longer rewrites what an
    // already-recorded expense was split between.
    const rows = (expenses ?? []).map((e: { amount: unknown; split_among: string[] | null }) => ({
      amountPaise: toPaise(e.amount),
      participants: Array.isArray(e.split_among) ? e.split_among : [],
    }));
    const sum = summariseLedger(rows);

    return res.json({
      total: toRupees(sum.totalPaise),
      memberCount: sum.memberCount,
      perMember: toRupees(sum.perMemberPaise),
      remainder: toRupees(sum.remainderPaise),
      splitExact: sum.splitExact,
      // SC-417: false when expenses were recorded under different rosters — no
      // single perMember/memberCount pair can describe a mixed ledger, so the UI
      // must fall back to per-expense figures rather than imply one split.
      uniformSplit: sum.uniformSplit,
    });
  } catch {
    return res.status(500).json({ error: 'Internal server error' });
  }
}
