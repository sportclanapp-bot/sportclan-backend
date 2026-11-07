/**
 * N-R7-S115 (OBS-P6-1, Step 2 B8): voiding a rated match takes its delta off the player's
 * rating (matchVoid.applyRecordDeltas) but leaves the later games' rating_history rows as they
 * were written. The rating chart's last bar read 'rating 1253, +10' under a headline of 1242.
 * The chart shows each kept game at the rating it reads now: its stored ratings less the delta
 * of every voided game played before it and voided after it (a game rated after the void was
 * already rated from the lowered rating). The delta of the game itself is unchanged.
 */
export interface HistoryRow {
  old_rating: number;
  new_rating: number;
  delta: number;
  created_at: string;
  /** the match's voided_at (null: not voided) */
  voided_at: string | null;
}

export type ShownRow = Omit<HistoryRow, 'voided_at'>;

const r2 = (x: number) => Math.round(x * 100) / 100;

/** rows oldest → newest (voided ones included); returns the kept rows, shifted, oldest → newest, the last `last`. */
export function shiftForVoided(rows: readonly HistoryRow[], last = 10): ShownRow[] {
  const ms = (t: string) => Date.parse(t);
  const voided = rows.filter((r) => r.voided_at).map((r) => ({ from: ms(r.created_at), to: ms(r.voided_at!), d: Number(r.delta ?? 0) }));
  const out: ShownRow[] = [];
  for (const r of rows) {
    if (r.voided_at) continue;
    const t = ms(r.created_at);
    const off = voided.reduce((s, v) => (v.from < t && t < v.to ? s + v.d : s), 0);
    out.push({
      old_rating: off ? Math.max(100, r2(Number(r.old_rating) - off)) : r.old_rating,
      new_rating: off ? Math.max(100, r2(Number(r.new_rating) - off)) : r.new_rating,
      delta: r.delta,
      created_at: r.created_at,
    });
  }
  return out.slice(-last);
}
