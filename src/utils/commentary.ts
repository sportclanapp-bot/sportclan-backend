import { BASKETBALL_STATS, conductWords, ladderStepDef, pointHowFor } from './matchRules';
import { FOUL_KINDS } from './basketballRules';
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
  // Stage 14 · VB2: basketball and volleyball subs too, and an injury (exceptional) substitution.
  if ((goalSport || ctx.sport === 'basketball' || ctx.sport === 'volleyball') && eventType === 'sub') {
    const off = typeof p.off_name === 'string' && p.off_name.trim() ? p.off_name.trim() : null;
    const icon = p.injury === true ? '🩹 Injury sub' : '🔁';
    if (off && player) return p.injury === true ? `${icon} — ${team}: ${player} on for ${off}` : `${icon} ${team}: ${player} on for ${off}`;
    return `${p.injury === true ? icon : '🔁 Substitution'} — ${team}${off ? `: ${off} off` : player ? `: ${player} on` : ''}`;
  }
  // Stage 14 · VB1 / VB7 / VB12 · volleyball's court: a set's line-up, the libero, a Super Point, a positional fault, a Super Serve.
  if (ctx.sport === 'volleyball' && eventType === 'note' && p.kind === 'rotation') {
    const names = (Array.isArray(p.slots) ? p.slots : []).map((x: any, i: number) => `${['I', 'II', 'III', 'IV', 'V', 'VI'][i] ?? i + 1} ${String(x?.name ?? '?')}`);
    const libs = (Array.isArray(p.liberos) ? p.liberos : []).map((x: any) => String(x?.name ?? '?'));
    return `📋 ${team} line-up${typeof p.set === 'number' ? ` for set ${p.set}` : ''}: ${names.join(', ')}${libs.length ? ` · libero${libs.length === 1 ? '' : 's'} ${libs.join(', ')}` : ''}`;
  }
  if (ctx.sport === 'volleyball' && eventType === 'note' && p.kind === 'libero') {
    if (p.out === true || p.back === true) return `🔄 Libero off — ${team}`;
    return `🔄 Libero ${String(p.libero?.name ?? '')} in for ${String(p.replaced?.name ?? '')} — ${team}`;
  }
  if (ctx.sport === 'volleyball' && eventType === 'note' && p.kind === 'super_point') return `⚡ Super Point called — ${team}`;
  if (ctx.sport === 'volleyball' && eventType === 'score' && p.kind === 'fault') return `🔢 Positional fault by ${other} — point to ${team}`;
  if (ctx.sport === 'volleyball' && eventType === 'score' && p.super_serve === true) return `🎯 Super Serve — an ace by ${player ? `${player} (${team})` : team}, +2`;
  // Stage 14 · VB8: how a rally point was won, when the scorer said.
  if (eventType === 'score' && p.kind === 'point' && (typeof p.how === 'string' || p.super_point === true)) {
    const how = pointHowFor(ctx.sport).find((h) => h.key === p.how);
    const why = how ? (how.error ? ` — ${other} error` : ` — ${how.label.toLowerCase()}${player ? ` by ${player}` : ''}`) : player ? ` — ${player}` : '';
    return `${p.super_point === true ? '⚡ Super Point won — ' : ''}Point to ${team}${p.super_point === true ? ' (+2)' : ''}${why}`;
  }
  // Stage 14 · VB8: basketball's rebounds, steals and blocks.
  if (ctx.sport === 'basketball' && eventType === 'note' && p.kind === 'stat') {
    const st = BASKETBALL_STATS.find((x) => x.key === p.stat);
    if (st) return `🏀 ${st.board.replace(/s$/, '')} — ${player ? `${player} (${team})` : team}`;
    if (p.stat === 'rebound') return `🏀 Rebound — ${player ? `${player} (${team})` : team}`; // Stage 14's plain rebound
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
    // Stage 11 · PB6: each step in the sport's own words (CONDUCT_STEPS).
    return `⚠️ ${cw.title.charAt(0).toUpperCase()}${cw.title.slice(1)} — ${player ? `${player} (${team})` : team} · ${OFFENCE[String(p.offence)] ?? 'conduct'} · ${ladderStepDef(ctx.sport, String(p.penalty ?? 'warning')).label}`;
  }
  // Stage 11 · PB6: what a technical foul or a game forfeit did to the score.
  if (eventType === 'note' && p.kind === 'point_off') return `➖ A point off ${team}`;
  if (eventType === 'note' && p.kind === 'game_forfeit') return `🏳️ Game forfeited by ${team}`;
  // Stage 10 · TT3: a paper-scored match typed in.
  if (eventType === 'note' && p.kind === 'typed_score') return `📝 Result entered from the score sheet: ${String(p.text ?? '')}`;
  if (eventType === 'note' && p.kind === 'warmup') return '⏱ Warm-up';
  if (eventType === 'note' && p.kind === 'medical_timeout') return `🩺 Medical time-out — ${team}`;
  // BUILD 3.42: a volleyball timeout names the side (it read "Timeout called by team").
  if (eventType === 'timeout') return ctx.sport === 'basketball' ? `⏸ Time-out — ${team}` : `⏸ Timeout — ${team}`; // Stage 15 · BB1: FIBA's word
  // BUILD 3.35: a basketball foul names who (it read "Foul by Team A"). Stage 15 · BB2: and its kind.
  if (ctx.sport === 'basketball' && eventType === 'foul') {
    const k = FOUL_KINDS.find((x) => x.key === p.kind);
    if (k && k.key !== 'personal') return `⚠️ ${k.label} foul — ${k.coach ? `${team} ${k.key === 'coach' ? 'head coach' : 'bench'}` : player ? `${player} (${team})` : team}`;
    return `✋ Foul — ${player ? `${player} (${team})` : team}`;
  }
  // Stage 15 · BB9 / BB6 / BB8 · basketball's arrow, a series game's end, a missed shot.
  if (ctx.sport === 'basketball' && eventType === 'note' && p.kind === 'arrow') return `▶ Possession arrow — ${team}`;
  if (ctx.sport === 'basketball' && eventType === 'note' && p.kind === 'arrow_flip') return '⇄ Possession arrow flipped';
  if (eventType === 'note' && p.kind === 'game_end') return '🏁 End of the game';
  if (ctx.sport === 'basketball' && eventType === 'note' && p.kind === 'stat' && p.stat === 'miss') return `⭕ Missed ${p.shot === 'ft' ? 'free throw' : p.shot === '3' ? '3-pointer' : '2-pointer'} — ${player ? `${player} (${team})` : team}`;
  // Stage 15 · BB2 (cross-sport): a card for a coach or team official.
  if ((ctx.sport === 'football' || ctx.sport === 'hockey') && eventType === 'note' && p.kind === 'official_card') {
    const c = p.colour === 'red' ? '🟥 Red card' : p.colour === 'green' ? '🟩 Green card' : '🟨 Yellow card';
    return `${c} — ${team} team official${p.colour === 'red' ? ' (sent from the bench)' : ''}`;
  }
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
    // Stage 13 · CR6: a slam says so (White: break to finish; Black: all the rest in the first turn).
    const slam = p.slam === 'white' ? '🎯 White slam! ' : p.slam === 'black' ? '🎯 Black slam! ' : '';
    return `${slam}⚪ Board to ${team} · +${v}${player ? ` (${player})` : ''}`;
  }
  // Stage 13 · CR4: the toss — who won it and what they chose; the extra board's toss after the board limit.
  if (ctx.sport === 'carrom' && eventType === 'note' && p.kind === 'toss') {
    const who = p.winner === 'B' ? ctx.teamB : ctx.teamA;
    if (p.extra === true) return `🪙 Toss for the extra board — ${who} breaks`;
    return `🪙 Toss — ${who} won it and chose ${p.choice === 'side' ? 'a side (the other breaks)' : 'to break'}`;
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
