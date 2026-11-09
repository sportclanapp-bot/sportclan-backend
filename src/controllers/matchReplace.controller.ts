/**
 * N-R7-S124 (Step 2 · Batch 10 · SPP2-VOL-050; Dipak chose A, 9 Nov 2026) ·
 * POST /matches/:id/replace — enter the correct result of a voided tournament fixture.
 *
 * A voided match refuses every result path (typed score, complete, decide), and
 * its score, rating rows, coins and badges live under its id — so it is not
 * re-scored in place. Instead the organiser gets a fresh copy of the fixture in
 * the same place (same teams, line-ups, round, match no., where its winner and
 * loser go), the earlier rounds that fed the voided one now feed the copy, and
 * the voided one is marked `replaced_by` (the bracket shows the copy; the voided
 * match stays on everyone's history as voided). The copy is played or typed in
 * as usual, so ratings, coins and the table are written once, under its own id.
 * Refused once a later match the fixture fed has been played. Restoring the
 * voided match (unvoid) still works until the copy is played: the copy is then
 * cancelled and the links go back (see undoReplacement).
 */
import crypto from 'node:crypto';
import { Request, Response } from 'express';
import { supabase } from '../utils/supabase';
import { isUuid } from '../utils/uuid';
import { isTournamentOrganiser } from '../utils/tournamentAuth';

const COPY = ['sport_id', 'tournament_id', 'team_a_id', 'team_b_id', 'team_a_name', 'team_b_name', 'venue', 'city_id', 'format', 'overs',
  'umpire_id', 'scorer_id', 'is_ranked', 'round', 'match_no', 'group_label', 'next_match_id', 'next_slot', 'ground_label', 'rules',
  'third_place', 'loser_next_match_id', 'loser_next_slot', 'bracket', 'is_test_seed'] as const;
const PART_COPY = ['user_id', 'team_side', 'role', 'jersey_number', 'batting_order'] as const;

type Row = Record<string, any>;

/** The later matches this fixture's result decides: its next match, a double elimination's back-draw match, a semi's third-place match. */
export async function laterMatchesFedBy(m: Row): Promise<Row[]> {
  const ids: string[] = [];
  if (m.next_match_id) ids.push(m.next_match_id);
  if (m.loser_next_match_id) ids.push(m.loser_next_match_id);
  if (m.next_match_id && m.tournament_id) {
    const { data: next } = await supabase.from('matches').select('id, next_match_id, third_place').eq('id', m.next_match_id).maybeSingle();
    if (next && !(next as Row).next_match_id && !(next as Row).third_place) {
      const { data: third } = await supabase.from('matches').select('id').eq('tournament_id', m.tournament_id).eq('third_place', true).maybeSingle();
      if ((third as Row | null)?.id) ids.push((third as Row).id);
    }
  }
  const out: Row[] = [];
  for (const id of ids) {
    const { data } = await supabase.from('matches').select('id, status, voided_at').eq('id', id).maybeSingle();
    if (data) out.push(data as Row);
  }
  return out;
}
const played = (c: Row) => c.status !== 'scheduled' && c.status !== 'cancelled' && !c.voided_at;

/** Point every match that fed `from` (as winner or loser) at `to`. */
async function moveFeeders(tournamentId: string, from: string, to: string): Promise<void> {
  await supabase.from('matches').update({ next_match_id: to }).eq('tournament_id', tournamentId).eq('next_match_id', from).neq('id', to);
  await supabase.from('matches').update({ loser_next_match_id: to }).eq('tournament_id', tournamentId).eq('loser_next_match_id', from).neq('id', to);
}

export async function replaceVoidedMatch(req: Request, res: Response) {
  const userId = req.userId;
  if (!userId) return res.status(401).json({ error: 'Unauthorized' });
  try {
    const id = String(req.params.id);
    if (!isUuid(id)) return res.status(404).json({ error: 'Match not found' });
    const { data } = await supabase.from('matches').select('*').eq('id', id).maybeSingle();
    const m = data as Row | null;
    if (!m) return res.status(404).json({ error: 'Match not found' });
    if (!m.tournament_id) return res.status(409).json({ error: 'Only a tournament fixture can be replaced. Restore this match, or create a new one.', code: 'NOT_TOURNAMENT' });
    if (!(await isTournamentOrganiser(m.tournament_id, userId))) return res.status(403).json({ error: 'Only the tournament organiser can enter the correct result.' });
    if (!m.voided_at) return res.status(409).json({ error: 'Void this match first, with the reason, then enter the correct result.', code: 'NOT_VOIDED' });
    if (!('replaced_by' in m)) return res.status(503).json({ error: 'This needs the latest database update. Try again later.', code: 'NEEDS_MIGRATION' });
    if (m.replaced_by) {
      const { data: copy } = await supabase.from('matches').select('*').eq('id', m.replaced_by).maybeSingle();
      return res.json({ success: true, already_replaced: true, match: copy ?? null });
    }
    const later = await laterMatchesFedBy(m);
    if (later.some(played)) {
      return res.status(409).json({ error: 'A later match this fixture decided has been played. Void that one first.', code: 'NEXT_ROUND_PLAYED' });
    }
    const newId = crypto.randomUUID();
    // Claimed first (N-R7-S57 style): of two taps only one makes a copy.
    const { data: claimed, error: cErr } = await supabase.from('matches').update({ replaced_by: newId }).eq('id', id).is('replaced_by', null).not('voided_at', 'is', null).select('id');
    if (cErr) { console.error('replace claim failed:', cErr.message); return res.status(500).json({ error: 'The fixture wasn’t replaced. Try again.' }); }
    if (!(claimed ?? []).length) {
      const { data: now } = await supabase.from('matches').select('replaced_by').eq('id', id).maybeSingle();
      const { data: copy } = (now as Row | null)?.replaced_by ? await supabase.from('matches').select('*').eq('id', (now as Row).replaced_by).maybeSingle() : { data: null };
      return res.json({ success: true, already_replaced: true, match: copy ?? null });
    }
    const now = new Date().toISOString();
    const row: Row = { id: newId, status: 'scheduled', created_by: userId, scheduled_at: now, is_open: false, created_at: now, updated_at: now };
    for (const k of COPY) if (k in m) row[k] = m[k];
    const { data: made, error: iErr } = await supabase.from('matches').insert(row).select('*').single();
    if (iErr || !made) {
      console.error('replace insert failed:', iErr?.message);
      await supabase.from('matches').update({ replaced_by: null }).eq('id', id).eq('replaced_by', newId);
      return res.status(500).json({ error: 'The fixture wasn’t replaced. Try again.' });
    }
    // The line-ups come along (the rating and record go to the same players).
    const { data: parts } = await supabase.from('match_participants').select('*').eq('match_id', id);
    const copies = ((parts ?? []) as Row[]).map((p) => { const r: Row = { match_id: newId }; for (const k of PART_COPY) if (k in p) r[k] = p[k]; return r; });
    if (copies.length) await supabase.from('match_participants').insert(copies);
    await moveFeeders(m.tournament_id, id, newId);
    // A tournament with a fixture to play is live again (the void un-crowned a finished one), so the
    // copy's result crowns and finishes it the usual way.
    await supabase.from('tournaments').update({ status: 'live', updated_at: now }).eq('id', m.tournament_id).eq('status', 'completed');
    return res.json({ success: true, match: made, replaces: id });
  } catch (e) {
    console.error('replaceVoidedMatch error:', e instanceof Error ? e.message : e);
    return res.status(500).json({ error: 'Internal server error' });
  }
}

/**
 * Before a voided match is restored: while its replacement is unplayed, the
 * replacement is cancelled (kept, marked replaced by the original so the
 * bracket hides it) and the earlier rounds feed the original again. Once the
 * replacement has been played the restore is refused.
 */
export async function undoReplacement(match: Row): Promise<{ status: number; body: Row } | null> {
  const copyId = match.replaced_by as string | null | undefined;
  if (!copyId) return null;
  const { data: cancelled } = await supabase.from('matches')
    .update({ status: 'cancelled', replaced_by: match.id, updated_at: new Date().toISOString() })
    .eq('id', copyId).eq('status', 'scheduled').is('voided_at', null).select('id');
  if (!(cancelled ?? []).length) {
    const { data: c } = await supabase.from('matches').select('status').eq('id', copyId).maybeSingle();
    if (c && (c as Row).status !== 'cancelled') {
      return { status: 409, body: { error: 'The corrected fixture has been played. Void that one instead.', code: 'REPLACEMENT_PLAYED' } };
    }
  }
  await supabase.from('matches').update({ replaced_by: null }).eq('id', match.id);
  if (match.tournament_id) await moveFeeders(match.tournament_id, copyId, match.id);
  return null;
}

/** Ids of a tournament's replaced fixtures (hidden from the bracket). Empty before migration 163. */
export async function replacedMatchIds(tournamentId: string): Promise<Set<string>> {
  try {
    const { data, error } = await supabase.from('matches').select('id').eq('tournament_id', tournamentId).not('replaced_by', 'is', null);
    if (error) return new Set();
    return new Set(((data ?? []) as Row[]).map((r) => r.id as string));
  } catch { return new Set(); }
}
