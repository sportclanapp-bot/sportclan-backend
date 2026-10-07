/**
 * Stage 8 · F7 / F8 (Oct 2026) · fair-play points from a tournament's cards,
 * FIFA's way: a yellow −1, a second yellow (sent off) −3, a straight red −4,
 * a yellow then a straight red −5 — per player per match, so a second yellow
 * is −3 in all, not −1 −1 −3. A card with no player named counts on its own
 * (yellow −1, red −4). Hockey's green card counts −1 (FIH has no fair-play
 * table; this is the app's choice). 0 is a clean record; less is worse.
 */
export type CardEvent = {
  match_id: string;
  payload: { team_side?: unknown; kind?: unknown; player_id?: unknown; player_name?: unknown; second_yellow?: unknown } | null;
};

/** Fair-play points per team id (only teams with cards appear; others are 0). */
export function fairPlayPoints(cards: CardEvent[], teamsOf: Map<string, { A: string | null; B: string | null }>): Map<string, number> {
  const out = new Map<string, number>();
  const add = (team: string | null, pts: number) => { if (team) out.set(team, (out.get(team) ?? 0) + pts); };
  // per match, per side, per named player: their cards
  const byPlayer = new Map<string, { team: string | null; y: number; g: number; direct: number; second: number }>();
  let anon = 0;
  for (const c of cards) {
    const p = c.payload ?? {};
    const teams = teamsOf.get(c.match_id);
    if (!teams) continue;
    const side = p.team_side === 'B' ? 'B' : 'A';
    const team = teams[side];
    const who = typeof p.player_id === 'string' && p.player_id ? p.player_id : typeof p.player_name === 'string' && p.player_name.trim() ? `n:${p.player_name.trim().toLowerCase()}` : `anon:${anon++}`;
    const k = `${c.match_id}|${side}|${who}`;
    const t = byPlayer.get(k) ?? { team, y: 0, g: 0, direct: 0, second: 0 };
    if (p.kind === 'yellow') t.y += 1;
    else if (p.kind === 'green') t.g += 1;
    else if (p.kind === 'red') { if (p.second_yellow) t.second += 1; else t.direct += 1; }
    byPlayer.set(k, t);
  }
  for (const t of byPlayer.values()) {
    let pts = -t.g;
    if (t.second > 0) pts -= 3 + (t.direct > 0 ? 4 : 0);
    else if (t.direct > 0 && t.y > 0) pts -= 5 + (t.y - 1);
    else if (t.direct > 0) pts -= 4 * t.direct;
    else pts -= t.y;
    add(t.team, pts);
  }
  return out;
}
