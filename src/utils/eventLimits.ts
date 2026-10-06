/**
 * Badminton gap 3 · a limit on how many events of a tournament a player may
 * enter (BAI Masters: one singles, one doubles, one mixed). Filled in by gap 3.
 */
export async function eventLimitRefusal(
  _t: { id: string; parent_id: string | null }, _userIds: string[], _people: Map<string, unknown>, _except: string | null,
): Promise<{ status: number; body: { error: string; code: string; user_id?: string } } | null> {
  return null;
}
