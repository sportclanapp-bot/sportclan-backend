/**
 * N-R7-S115 (OBS-P6-1, Step 2 B8): voiding a rated match takes its delta off the player's
 * rating (matchVoid.applyRecordDeltas) but leaves the later games' rating_history rows as they
 * were written. The rating chart's last bar read 'rating 1253, +10' under a headline of 1242.
 * The chart shows each kept game at the rating it reads now: its stored ratings less every
 * voided game's delta from before it (the delta of the game itself is unchanged).
 */
export interface HistoryRow {
  old_rating: number;
  new_rating: number;
  delta: number;
  created_at: string;
  voided: boolean;
}

export type ShownRow = Omit<HistoryRow, 'voided'>;

const r2 = (x: number) => Math.round(x * 100) / 100;

/** rows oldest → newest (voided ones included); returns the kept rows, shifted, oldest → newest, the last `last`. */
export function shiftForVoided(rows: readonly HistoryRow[], last = 10): ShownRow[] {
  let off = 0;
  const out: ShownRow[] = [];
  for (const r of rows) {
    if (r.voided) { off += Number(r.delta ?? 0); continue; }
    out.push({
      old_rating: off ? Math.max(100, r2(Number(r.old_rating) - off)) : r.old_rating,
      new_rating: off ? Math.max(100, r2(Number(r.new_rating) - off)) : r.new_rating,
      delta: r.delta,
      created_at: r.created_at,
    });
  }
  return out.slice(-last);
}
