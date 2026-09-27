import { Request, Response } from 'express';
import { supabase } from '../utils/supabase';
import { ARRAY_LIMITS, tooManyItems } from '../utils/validation';
import { isUuid } from '../utils/uuid';

/** A real calendar date as YYYY-MM-DD (2026-02-30 is not one). */
function isYmd(v: unknown): v is string {
  if (typeof v !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(v)) return false;
  const d = new Date(`${v}T00:00:00Z`);
  return !Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === v;
}

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
  if (tooManyItems(sport_ids, ARRAY_LIMITS.sportIds)) {
    return res.status(400).json({ error: `Too many sport_ids (max ${ARRAY_LIMITS.sportIds})` });
  }
  // B02-F3: only the count was checked — a bad date, a non-list or a non-uuid
  // sport, or a non-boolean flag reached Postgres and came back a 500.
  if (sport_ids !== undefined && sport_ids !== null && (!Array.isArray(sport_ids) || !sport_ids.every(isUuid))) {
    return res.status(400).json({ error: 'sport_ids must be a list of sport ids' });
  }
  for (const [name, v] of [['date_from', date_from], ['date_to', date_to]] as const) {
    if (v !== undefined && v !== null && v !== '' && !isYmd(v)) {
      return res.status(400).json({ error: `${name} must be a date (YYYY-MM-DD)` });
    }
  }
  if (date_from && date_to && date_from > date_to) {
    return res.status(400).json({ error: 'date_from must be on or before date_to' });
  }
  for (const [name, v] of [['hide_stats', hide_stats], ['hide_dob', hide_dob]] as const) {
    if (v !== undefined && v !== null && typeof v !== 'boolean') {
      return res.status(400).json({ error: `${name} must be true or false` });
    }
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
