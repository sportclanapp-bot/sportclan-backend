/**
 * Timeline lines for football, hockey and basketball events (2026-09-26, after
 * MATCH_CREATE_TEST_5). The timeline printed these raw — `card {"kind":"red",
 * "team_side":"B"}`, `period_change {"kind":"halftime"}` — and every goal read
 * "Point to Team B" (an own goal too, against the side that CONCEDED it). Cards
 * now name the player when the scorer said who got it.
 */
export interface CommentaryContext {
  sport: string;
  teamA: string;
  teamB: string;
  /** Periods seen so far, including this one (quarters / halves). */
  period: number;
}

const CARD = { yellow: '🟨 Yellow card', red: '🟥 Red card', green: '🟩 Green card' } as const;

export function sportCommentary(eventType: string, p: Record<string, any>, ctx: CommentaryContext): string | null {
  const side: 'A' | 'B' = p.team_side === 'B' ? 'B' : 'A';
  const team = side === 'A' ? ctx.teamA : ctx.teamB;
  const other = side === 'A' ? ctx.teamB : ctx.teamA;
  const player = typeof p.player_name === 'string' && p.player_name.trim() ? p.player_name.trim() : null;
  const goalSport = ctx.sport === 'football' || ctx.sport === 'hockey';

  if (goalSport && eventType === 'score') {
    if (p.kind === 'own_goal') return `🙈 Own goal by ${team} — goal to ${other}`;
    const ball = ctx.sport === 'hockey' ? '🥅' : '⚽';
    return `${ball} GOAL! ${team}${player ? ` — ${player}` : ''}`;
  }
  if (goalSport && eventType === 'card') {
    const kind = CARD[p.kind as keyof typeof CARD] ?? 'Card';
    return `${kind} — ${player ? `${player} (${team})` : team}`;
  }
  if (eventType === 'period_change') {
    if (ctx.sport === 'football' || p.kind === 'halftime') return 'Half-time';
    const last = ctx.sport === 'basketball' ? 4 : 4;
    return ctx.period <= last ? `End of Q${ctx.period}` : `End of OT${ctx.period - last}`;
  }
  if (goalSport && eventType === 'note' && p.kind === 'pen_corner') return `🏑 Penalty corner — ${team}`;
  if (ctx.sport === 'basketball' && eventType === 'score') {
    const v = Number(p.value ?? 0);
    return `🏀 ${v === 1 ? 'Free throw' : `${v}-pointer`} — ${team}${player ? ` (${player})` : ''}`;
  }
  return null;
}
