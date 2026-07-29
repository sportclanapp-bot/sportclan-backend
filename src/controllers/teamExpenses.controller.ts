import { Request, Response } from 'express';
import { supabase } from '../utils/supabase';
import { sanitizeError } from '../utils/response';
import { LIMITS, ARRAY_LIMITS, tooManyItems } from '../utils/validation';
import { isTeamManager } from '../utils/teamAuth';

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
        split_among: split_among ?? [],
        notes: notes || null,
        match_id: match_id || null,
        tournament_id: tournament_id || null,
        created_by: userId,
      })
      .select('*')
      .single();
    if (error) return res.status(500).json({ error: sanitizeError(error) });
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

    const { data: existing } = await supabase
      .from('team_expenses').select('id, created_by')
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
      .from('team_expenses').select('id, created_by')
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

    const { error } = await supabase
      .from('team_expenses').delete()
      .eq('id', expenseId).eq('team_id', id);
    if (error) return res.status(500).json({ error: sanitizeError(error) });
    return res.json({ success: true });
  } catch {
    return res.status(500).json({ error: 'Internal server error' });
  }
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
      .select('amount')
      .eq('team_id', id);

    // Integer paise throughout — see toPaise.
    const totalPaise = (expenses ?? []).reduce((s, e) => s + toPaise(e.amount), 0);

    // Even-split denominator = the team's actual member count, not the union of
    // members who happen to appear in existing expense splits — the old code
    // returned "1 member" for a fully-rostered team with no/narrow expenses (A9-001).
    const { count: teamMemberCount } = await supabase
      .from('team_members')
      .select('id', { count: 'exact', head: true })
      .eq('team_id', id);
    const memberCount = Math.max(1, teamMemberCount ?? 0);

    // SC-360: the old `Math.ceil(total / memberCount)` over-collected — ₹100
    // across 3 showed ₹34 each, and 34×3 = ₹102, so the split didn't add back
    // up to the total it was splitting. Now: each member owes the floor share in
    // paise, and the indivisible remainder is reported separately instead of
    // being silently spread. perMember * memberCount + remainder === total,
    // exactly, always.
    const perMemberPaise = Math.floor(totalPaise / memberCount);
    const remainderPaise = totalPaise - perMemberPaise * memberCount;

    return res.json({
      total: toRupees(totalPaise),
      memberCount,
      perMember: toRupees(perMemberPaise),
      remainder: toRupees(remainderPaise),
      splitExact: remainderPaise === 0,
    });
  } catch {
    return res.status(500).json({ error: 'Internal server error' });
  }
}
