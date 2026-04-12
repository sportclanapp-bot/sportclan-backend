import { Request, Response } from 'express';
import { supabase } from '../utils/supabase';
import { sanitizeError } from '../utils/response';

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
    const { error } = await supabase
      .from('team_expenses')
      .delete()
      .eq('id', expenseId)
      .eq('team_id', id)
      .eq('created_by', userId);
    if (error) return res.status(500).json({ error: sanitizeError(error) });
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
    // Count unique members across all splits
    const members = new Set<string>();
    for (const e of expenses ?? []) {
      for (const uid of e.split_among ?? []) members.add(uid);
    }
    const memberCount = Math.max(1, members.size);
    const perMember = Math.ceil(total / memberCount);

    return res.json({ total, memberCount, perMember });
  } catch {
    return res.status(500).json({ error: 'Internal server error' });
  }
}
