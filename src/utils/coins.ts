// Award-coins helper. The (user_id, event_type) unique constraint on
// coin_events makes this operation idempotent — pass the same event_type
// twice and the second call is a no-op. Callers are responsible for
// constructing stable event_type strings (e.g. `win_match_${matchId}`).
import { supabase } from './supabase';

export interface AwardResult {
  awarded: boolean;
  newBalance: number;
}

export async function awardCoins(
  userId: string,
  eventType: string,
  coins: number,
  /**
   * SC-434 · what the USER reads in their coin history.
   *
   * `eventType` is an idempotency key — `daily_checkin_2026-09-22`,
   * `kudos_7f3a…` — and it was being written straight into the transaction
   * description, so the history read like a log file. The key still does the
   * deduping; this is the sentence beside it. Omitted falls back to the key, so
   * no existing caller changes behaviour by being left alone.
   */
  description?: string,
  /** V-6: the transaction type; a reversal is 'coins_reversed', not 'earned'. */
  txType: string = 'coins_earned',
): Promise<AwardResult> {
  // V074/V254 (visual review, migration 096): ledger row, balance change and
  // history row in ONE transaction, a clawback clamped to what the user has.
  // Before 096 is applied the function doesn't exist (PostgREST PGRST202 /
  // Postgres 42883) and this falls through to the original three-step path.
  const { data: atomic, error: atomicErr } = await supabase.rpc('award_coin_event', {
    p_user_id: userId,
    p_event_type: eventType,
    p_coins: coins,
    p_description: description ?? eventType,
    p_tx_type: txType,
  });
  if (!atomicErr) {
    const row = (Array.isArray(atomic) ? atomic[0] : atomic) as
      { awarded?: boolean; new_balance?: number } | null;
    return { awarded: !!row?.awarded, newBalance: Number(row?.new_balance ?? 0) };
  }
  const missing = (atomicErr as any)?.code === 'PGRST202' || (atomicErr as any)?.code === '42883';
  if (!missing) {
    // Any other failure: log it and take the original path, which is what ran
    // before 096 — a transient RPC error must not cost anyone their coins.
    // eslint-disable-next-line no-console
    console.warn('[coins] award_coin_event failed, using the legacy path', eventType, atomicErr.message);
  }

  // Pre-096 path. Does the event already exist?
  const { data: existing } = await supabase
    .from('coin_events')
    .select('id')
    .eq('user_id', userId)
    .eq('event_type', eventType)
    .maybeSingle();

  // Fetch the current balance either way so we can return it.
  const { data: usr } = await supabase
    .from('users')
    .select('coin_balance')
    .eq('id', userId)
    .maybeSingle();
  const currentBalance = usr?.coin_balance ?? 0;

  if (existing) {
    return { awarded: false, newBalance: currentBalance };
  }

  // Insert the event row first — the UNIQUE constraint will throw if we
  // race another request, which is the protection we want.
  const { error: insertErr } = await supabase
    .from('coin_events')
    .insert({ user_id: userId, event_type: eventType, coins });
  if (insertErr) {
    // Unique violation (23505) means someone else already awarded — treat
    // as "already done" and return the current balance.
    if ((insertErr as any)?.code === '23505') {
      return { awarded: false, newBalance: currentBalance };
    }
    // Other errors — return un-awarded without throwing.
    // eslint-disable-next-line no-console
    console.warn('[coins] insert failed', eventType, insertErr.message);
    return { awarded: false, newBalance: currentBalance };
  }

  // Atomic increment via the DB function — avoids the read-modify-write drift
  // (A4-006) where concurrent credits clobbered each other against the stored
  // coin_balance column. The returned newBalance is informational only; the
  // authoritative update happens atomically in Postgres.
  const { error: incErr } = await supabase
    .rpc('increment_coins', { target_user_id: userId, amount: coins });
  if (incErr) {
    // eslint-disable-next-line no-console
    console.warn('[coins] increment_coins failed', eventType, incErr.message);
  }
  const newBalance = currentBalance + coins;
  await supabase.from('transactions').insert({
    user_id: userId,
    type: txType,
    coins,
    description: description ?? eventType,
    status: 'completed',
  });
  return { awarded: true, newBalance };
}
