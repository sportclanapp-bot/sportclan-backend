import { conductWords } from './matchRules';
/**
 * Timeline lines for football, hockey and basketball events (2026-09-26, after
 * MATCH_CREATE_TEST_5). The timeline printed these raw — `card {"kind":"red",
 * "team_side":"B"}`, `period_change {"kind":"halftime"}` — and every goal read
 * "Point to Team B" (an own goal too, against the side that CONCEDED it). Cards
 * now name the player when the scorer said who got it.
 */
import { periodLabelOf } from './basketballRules';

export interface CommentaryContext {
  sport: string;
  teamA: string;
  teamB: string;
  /** Periods seen so far, including this one (quarters / halves). */
  period: number;
  /** BUILD 3.22: minutes a period, for the timeline minute (23', 45+2'). */
  periodMinutes?: number | null;
  /** BUILD 3.17: the match's regulation periods, when known (football 1–4). */
  regulation?: number | null;
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

/**
 * BUILD 3.22 · the timeline minute from a football / hockey event's match time:
 * 1' from the first second; past a period's length, "45+2'".
 */
export function matchMinute(seconds: number, periodMinutes: number, period: number): string {
  const base = (Math.max(1, period) - 1) * periodMinutes;
  const minute = Math.floor(seconds / 60) + 1;
  return minute > base + periodMinutes ? `${base + periodMinutes}+${minute - base - periodMinutes}'` : `${minute}'`;
}

export function sportCommentary(eventType: string, p: Record<string, any>, ctx: CommentaryContext): string | null {
  const line = sportLine(eventType, p, ctx);
  // BUILD 3.22: a football / hockey event scored on the match clock says its minute.
  const goalSport = ctx.sport === 'football' || ctx.sport === 'hockey';
  // A shoot-out kick isn't played on the match clock: no minute.
  const shootoutKick = eventType === 'note' && (p.kind === 'shootout_kick' || p.kind === 'shootout_start' || p.kind === 'shootout_cancel');
  if (line && goalSport && !shootoutKick && typeof ctx.clockSeconds === 'number' && ctx.periodMinutes) {
    // ctx.period counts periods ENDED (right for "End of Q3"); a goal is in the next one.
    const periodNow = eventType === 'period_change' ? ctx.period : ctx.period + 1;
    return `${matchMinute(ctx.clockSeconds, ctx.periodMinutes, periodNow)} ${line}`;
  }
  return line;
}

function sportLine(eventType: string, p: Record<string, any>, ctx: CommentaryContext): string | null {
  const side: 'A' | 'B' = p.team_side === 'B' ? 'B' : 'A';
  const team = side === 'A' ? ctx.teamA : ctx.teamB;
  const other = side === 'A' ? ctx.teamB : ctx.teamA;
  const player = typeof p.player_name === 'string' && p.player_name.trim() ? p.player_name.trim() : null;
  const goalSport = ctx.sport === 'football' || ctx.sport === 'hockey';

  if (goalSport && eventType === 'score') {
    if (p.kind === 'own_goal') return `🙈 Own goal by ${team} — goal to ${other}`;
    const ball = ctx.sport === 'hockey' ? '🥅' : '⚽';
    // Stage 8 · F4: a goal from the spot says so.
    return `${ball} GOAL! ${team}${player ? ` — ${player}` : ''}${p.penalty ? ' (penalty)' : ''}`;
  }
  if (goalSport && eventType === 'card') {
    const kind = CARD[p.kind as keyof typeof CARD] ?? 'Card';
    // Stage 8 · F4: the red that follows a second yellow.
    if (p.kind === 'red' && p.second_yellow) return `🟨🟥 Second yellow, sent off — ${player ? `${player} (${team})` : team}`;
    return `${kind} — ${player ? `${player} (${team})` : team}`;
  }
  // Stage 8 · F4: assists and substitutions on the timeline.
  if (goalSport && eventType === 'assist') return `🅰️ Assist — ${player ? `${player} (${team})` : team}`;
  if (goalSport && eventType === 'sub') {
    const off = typeof p.off_name === 'string' && p.off_name.trim() ? p.off_name.trim() : null;
    if (off && player) return `🔁 ${team}: ${player} on for ${off}`;
    return `🔁 Substitution — ${team}${off ? `: ${off} off` : player ? `: ${player} on` : ''}`;
  }
  // Stage 8 · F10: the clock stopped and restarted, and the added time shown.
  if (goalSport && eventType === 'note' && p.kind === 'clock_pause') return '⏸ Clock stopped';
  if (goalSport && eventType === 'note' && p.kind === 'clock_resume') return '▶ Clock restarted';
  if (goalSport && eventType === 'note' && p.kind === 'added_time' && typeof p.minutes === 'number') return `⏱ +${p.minutes} min added time`;
  // Stage 8 · F9: the shoot-out starts (the clock stops), or the scorer backs out to the match.
  if (goalSport && eventType === 'note' && p.kind === 'shootout_start') return ctx.sport === 'hockey' ? '🥅 Shoot-out' : '🥅 Penalty shoot-out';
  if (goalSport && eventType === 'note' && p.kind === 'shootout_cancel') return `↩ Back to the match — no ${ctx.sport === 'hockey' ? 'shoot-out' : 'penalties'} yet`;
  // Stage 8 · F9: the shoot-out, kick by kick.
  if (goalSport && eventType === 'note' && p.kind === 'shootout_kick') {
    return `${p.scored ? '✅ Scored' : '❌ Missed'} — ${ctx.sport === 'hockey' ? 'shoot-out' : 'penalty'} by ${player ? `${player} (${team})` : team}`;
  }
  if (eventType === 'period_change') {
    // BUILD 3.19: football's extra time.
    if (p.kind === 'extra_time') return 'Extra time';
    if (p.kind === 'et_half') return 'Extra time · half-time';
    // BUILD 3.17: half-time only between two halves; else the period that ended.
    const count = ctx.regulation ?? (ctx.sport === 'football' ? 2 : 4);
    if (p.kind === 'halftime' || (ctx.sport === 'football' && count === 2)) return 'Half-time';
    // BUILD 3.30: basketball names its periods from the shared rule (Q, H, P, then OT).
    if (ctx.sport === 'basketball') return `End of ${periodLabelOf(ctx.period, count)}`;
    if (ctx.sport === 'football' || count !== 4) return `End of period ${ctx.period}`;
    const last = count;
    return ctx.period <= last ? `End of Q${ctx.period}` : `End of OT${ctx.period - last}`;
  }
  if (goalSport && eventType === 'note' && p.kind === 'pen_corner') return `🏑 Penalty corner — ${team}`;
  if (goalSport && eventType === 'note' && p.kind === 'kickoff') return '⏱ Kick-off'; // BUILD 3.22
  // BUILD 3.78: a carrom foul — a piece due from that side.
  if (ctx.sport === 'carrom' && eventType === 'foul') return `🚫 Foul — ${team} (a piece due)`;
  // BUILD 3.77: point carrom — the piece, who pocketed it, and what it was worth.
  if (ctx.sport === 'carrom' && eventType === 'score' && p.kind === 'coin') {
    const piece = p.coin === 'queen' ? '👑 Queen' : p.coin === 'white' ? '⚪ White' : '⚫ Black';
    return `${piece} pocketed — ${team}${p.value != null ? ` (+${p.value})` : ''}`;
  }
  // BUILD 3.58: a side-out rally names who won it — it scores only for the server.
  if (eventType === 'score' && p.kind === 'rally') return `Rally to ${team}`;
  // BUILD 3.53: table tennis's expedite rule comes in.
  if (eventType === 'note' && p.kind === 'expedite') return '⏱ Expedite rule — serve alternates; the receiver wins on the 13th return';
  // Stage 9 · T10: the warm-up and a medical time-out (the receiver swap is a scorer's correction — not said).
  // Stage 9 · T9: a code violation and its penalty (the points it gives are their own events).
  if (eventType === 'note' && p.kind === 'violation') {
    const vb = ctx.sport === 'volleyball';
    const OFFENCE: Record<string, string> = { time: vb ? 'delay' : 'time', conduct: 'unsportsmanlike conduct', abuse: vb ? 'ball or equipment abuse' : 'racket or ball abuse', coaching: 'coaching', language: 'language', other: 'conduct' };
    const cw = conductWords(ctx.sport);
    const PENALTY: Record<string, string> = { warning: 'warning', point: 'point penalty', point2: 'two-point penalty', game: 'game penalty', default: cw.out };
    return `⚠️ ${cw.title.charAt(0).toUpperCase()}${cw.title.slice(1)} — ${player ? `${player} (${team})` : team} · ${OFFENCE[String(p.offence)] ?? 'conduct'} · ${PENALTY[String(p.penalty)] ?? 'warning'}`;
  }
  if (eventType === 'note' && p.kind === 'warmup') return '⏱ Warm-up';
  if (eventType === 'note' && p.kind === 'medical_timeout') return `🩺 Medical time-out — ${team}`;
  // BUILD 3.42: a volleyball timeout names the side (it read "Timeout called by team").
  if (eventType === 'timeout') return `⏸ Timeout — ${team}`;
  // BUILD 3.35: a basketball foul names who (it read "Foul by Team A").
  if (ctx.sport === 'basketball' && eventType === 'foul') return `✋ Foul — ${player ? `${player} (${team})` : team}`;
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
