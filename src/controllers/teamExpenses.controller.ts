import { Request, Response } from 'express';
import { supabase } from '../utils/supabase';
import { sanitizeError } from '../utils/response';
import { LIMITS } from '../utils/validation';

// ── Team Expense Manager ────────────────────────────────────────────────────

export async function listExpenses(req: Request, res: Response) {
  const { id } = req.params;
  try {
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

export async function addExpense(req: Request, res: Response) {
  const userId = req.userId;
  if (!userId) return res.status(401).json({ error: 'Unauthorized' });
  try {
    const { id } = req.params;
    const { title, amount, category, paid_by, split_among, notes, match_id, tournament_id } = req.body || {};
    if (!title || amount == null) return res.status(400).json({ error: 'title and amount required' });
    // SC-38: amount must be a sane positive value (negatives corrupted the
    // expense summary; absurd values overflowed the numeric column → 500).
    const amt = Number(amount);
    if (!Number.isFinite(amt) || amt <= 0 || amt > LIMITS.expenseMaxAmount) {
      return res.status(400).json({ error: `amount must be between 1 and ${LIMITS.expenseMaxAmount}` });
    }

    const { data, error } = await supabase
      .from('team_expenses')
      .insert({
        team_id: id, title, amount: Number(amount),
        category: category || 'other',
        paid_by: paid_by || userId,
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

export async function deleteExpense(req: Request, res: Response) {
  const userId = req.userId;
  if (!userId) return res.status(401).json({ error: 'Unauthorized' });
  try {
    const { id, expenseId } = req.params;
    const { data: deleted, error } = await supabase
      .from('team_expenses')
      .delete()
      .eq('id', expenseId)
      .eq('team_id', id)
      .eq('created_by', userId)
      .select('id');
    if (error) return res.status(500).json({ error: sanitizeError(error) });
    // SC-32: a 0-row delete (wrong owner/team or missing) must 404.
    if (!deleted || deleted.length === 0) {
      return res.status(404).json({ error: 'Expense not found or not yours' });
    }
    return res.json({ success: true });
  } catch {
    return res.status(500).json({ error: 'Internal server error' });
  }
}

export async function getExpenseSummary(req: Request, res: Response) {
  try {
    const { id } = req.params;
    const { data: expenses } = await supabase
      .from('team_expenses')
      .select('amount, split_among')
      .eq('team_id', id);

    const total = (expenses ?? []).reduce((s, e) => s + Number(e.amount ?? 0), 0);
    // Even-split denominator = the team's actual member count, not the union of
    // members who happen to appear in existing expense splits — the old code
    // returned "1 member" for a fully-rostered team with no/narrow expenses (A9-001).
    const { count: teamMemberCount } = await supabase
      .from('team_members')
      .select('id', { count: 'exact', head: true })
      .eq('team_id', id);
    const memberCount = Math.max(1, teamMemberCount ?? 0);
    const perMember = Math.ceil(total / memberCount);

    return res.json({ total, memberCount, perMember });
  } catch {
    return res.status(500).json({ error: 'Internal server error' });
  }
}
