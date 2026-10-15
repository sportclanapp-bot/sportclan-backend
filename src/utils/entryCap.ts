/**
 * F120 (launch test plan, Round 3): migration 157's trigger refuses an approval past a tournament's
 * maximum with the row lock held (simultaneous approvals queue). Its refusal, as supabase-js reports it.
 */
export function isEntryCapError(err: unknown): boolean {
  const e = err as { message?: unknown; code?: unknown } | null | undefined;
  return !!e && e.code === 'P0001' && typeof e.message === 'string' && e.message.includes('TOURNAMENT_FULL');
}

export const ENTRY_CAP_BODY = { error: 'Tournament is full', code: 'TOURNAMENT_FULL' } as const;
