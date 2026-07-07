import { Request, Response } from 'express';
import { supabase } from '../utils/supabase';

// ─── GET MY AVAILABILITY ────────────────────────────────────────────────────
export async function getAvailability(req: Request, res: Response) {
  const userId = req.userId!;

  const { data, error } = await supabase
    .from('player_availability')
    .select('*')
    .eq('user_id', userId)
    .maybeSingle();

  if (error) return res.status(500).json({ error: error.message });

  // Return defaults if no record exists
  return res.json({
    data: data || {
      status: 'not_available',
      sport_ids: [],
      date_from: null,
      date_to: null,
      hide_stats: false,
      hide_dob: false,
    },
  });
}

// ─── UPDATE AVAILABILITY ────────────────────────────────────────────────────
export async function updateAvailability(req: Request, res: Response) {
  const userId = req.userId!;
  // SC-108: guard against bodyless requests (was throwing 500 on destructure).
  const { status, sport_ids, date_from, date_to, hide_stats, hide_dob } = req.body ?? {};

  // SC-108: validate status against the DB CHECK constraint (see migration 005).
  const VALID_STATUSES = ['looking_to_play', 'available_weekend', 'not_available'];
  if (status !== undefined && status !== null && !VALID_STATUSES.includes(status)) {
    return res.status(400).json({ error: 'Invalid status' });
  }

  const { data, error } = await supabase
    .from('player_availability')
    .upsert(
      {
        user_id: userId,
        status: status || 'not_available',
        sport_ids: sport_ids || [],
        date_from: date_from || null,
        date_to: date_to || null,
        hide_stats: hide_stats ?? false,
        hide_dob: hide_dob ?? false,
        updated_at: new Date().toISOString(),
      },
      { onConflict: 'user_id' }
    )
    .select()
    .single();

  if (error) return res.status(500).json({ error: error.message });
  return res.json({ data });
}
