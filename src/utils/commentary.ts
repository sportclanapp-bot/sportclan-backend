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
  /** Chess: moves so far, including this one. */
  move?: number;
  /** Chess: the mover's clock after the move, in seconds. */
  clockSeconds?: number | null;
}

const CHESS_REASON: Record<string, string> = {
  checkmate: 'checkmate', resignation: 'resignation', timeout: 'timeout',
  draw_agreement: 'by agreement', stalemate: 'stalemate', repetition: 'repetition',
  insufficient_material: 'insufficient material', fifty_move: '50-move rule',
};
const clock = (s: number) => `${Math.floor(s / 60)}:${String(Math.floor(s % 60)).padStart(2, '0')}`;

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
  // Chess: "Move  — game in progress" (no number was ever sent) and a raw
  // result object with a player id in it.
  if (ctx.sport === 'chess' && eventType === 'move') {
    const who = p.side === 'B' ? 'Black' : 'White';
    const left = typeof ctx.clockSeconds === 'number' ? ` · ${clock(ctx.clockSeconds)} left` : '';
    return `♟️ ${who} moved · move ${ctx.move ?? '?'}${left}`;
  }
  if (ctx.sport === 'chess' && eventType === 'result') {
    const why = typeof p.reason === 'string' ? CHESS_REASON[p.reason] ?? p.reason.replace(/_/g, ' ') : null;
    if (p.winner === 'draw') return `🤝 Draw${why ? ` — ${why}` : ''}`;
    const who = p.winner === 'black' ? 'Black' : 'White';
    return `🏁 ${who} wins${why ? ` — ${why}` : ''}${player ? ` (${player})` : ''}`;
  }
  if (eventType === 'serve_swap') return '🔁 Serve changed';
  if (ctx.sport === 'carrom' && eventType === 'score' && p.kind === 'board') {
    const v = Number(p.value ?? 0);
    return `⚪ Board to ${team} · +${v}${player ? ` (${player})` : ''}`;
  }
  if (ctx.sport === 'tennis' && eventType === 'score' && (p.kind === 'ace' || p.kind === 'double_fault')) {
    return p.kind === 'ace' ? `🎾 Ace — point to ${team}` : `Double fault — point to ${team}`;
  }
  if (ctx.sport === 'basketball' && eventType === 'score') {
    const v = Number(p.value ?? 0);
    return `🏀 ${v === 1 ? 'Free throw' : `${v}-pointer`} — ${team}${player ? ` (${player})` : ''}`;
  }
  return null;
}
