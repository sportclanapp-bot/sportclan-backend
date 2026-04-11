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
): Promise<AwardResult> {
  // Does the event already exist?
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

  const newBalance = currentBalance + coins;
  await supabase.from('users').update({ coin_balance: newBalance }).eq('id', userId);
  await supabase.from('transactions').insert({
    user_id: userId,
    type: 'coins_earned',
    coins,
    description: eventType,
    status: 'completed',
  });
  return { awarded: true, newBalance };
}
