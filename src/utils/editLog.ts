/**
 * The scoring edit log, in plain words (27 Sep 2026).
 *
 * match_event_audit records every edit, delete and undo of a scoring event
 * (#7, migrations 107 / 109). This turns a row into a line an organiser can
 * read — "Priya undid: Lions point, 3–1 → 2–1", "Rahul edited ball 4.3: 1 run
 * → 4 runs" — for every sport's event types, and a plain generic line for any
 * type it doesn't know. Never raw JSON.
 */
import { extraPenaltyOf, isBallOfOver } from './cricketRules';

export interface LogContext {
  sport: string;
  teamA: string;
  teamB: string;
}

type P = Record<string, any>;

const plural = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;
const words = (s: string) => s.replace(/_/g, ' ').trim();

function teamOf(p: P, ctx: LogContext): string {
  return p.team_side === 'B' ? ctx.teamB : ctx.teamA;
}
function playerOf(p: P): string | null {
  const n = p.player_name ?? p.batsman_name ?? p.batsmanName ?? p.batter;
  return typeof n === 'string' && n.trim() ? n.trim() : null;
}

const EXTRA: Record<string, string> = { Wd: 'wide', Nb: 'no-ball', B: 'bye', Lb: 'leg bye' };
const WICKET: Record<string, string> = {
  bowled: 'bowled', caught: 'caught', lbw: 'lbw', run_out: 'run out', stumped: 'stumped',
  hit_wicket: 'hit wicket', retired_hurt: 'retired hurt', retired_out: 'retired out', retired_not_out: 'retired not out',
};
const CARD: Record<string, string> = { yellow: 'yellow card', red: 'red card', green: 'green card' };

/** One scoring event as a short phrase: "Lions point", "4 runs", "wide + 1". */
export function describeEvent(type: string | null | undefined, p: P | null | undefined, ctx: LogContext): string {
  const t = String(type ?? '');
  const x: P = p && typeof p === 'object' ? p : {};
  const team = teamOf(x, ctx);
  const who = playerOf(x);
  const v = Number(x.value ?? x.points ?? 0);

  switch (t) {
    // Cricket
    case 'ball': {
      if (x.wicket) return `wicket${who ? ` (${who})` : ''}`;
      const r = Number(x.runs ?? 0);
      return r === 0 ? 'dot ball' : plural(r, 'run');
    }
    case 'extra': {
      const kind = EXTRA[String(x.type)] ?? 'extra';
      const r = Number(x.runs ?? 0);
      if (kind === 'bye' || kind === 'leg bye') return plural(Math.max(r, 1), kind, `${kind}s`);
      const over = r - extraPenaltyOf(x); // BUILD 3.6: on top of its own penalty
      return over > 0 ? `${kind} + ${over}` : kind;
    }
    case 'wicket': {
      const how = WICKET[String(x.wicket_type ?? x.type ?? '')] ?? (x.wicket_type ? words(String(x.wicket_type)) : null);
      return `wicket${who ? ` — ${who}` : ''}${how ? ` (${how})` : ''}`;
    }
    case 'declaration': return `${team} declared`;
    // Goals, points, baskets — every "score" shape
    case 'score': case 'point': case 'goal': {
      if (x.kind === 'own_goal') return `own goal by ${team}`;
      if (x.kind === 'goal' || t === 'goal' || ctx.sport === 'football' || ctx.sport === 'hockey') return `${team} goal${who ? ` (${who})` : ''}`;
      if (x.kind === 'ace') return `${team} ace`;
      if (x.kind === 'double_fault') return `double fault — ${team} point`;
      if (x.kind === 'board' || ctx.sport === 'carrom') return `${team} +${v || 1}`;
      if (ctx.sport === 'basketball') return v === 1 ? `${team} free throw` : `${team} ${v || 2}-pointer`;
      return v > 1 ? `${team} +${v}` : `${team} point`;
    }
    case 'basket': return v === 1 ? `${team} free throw` : `${team} ${v || 2}-pointer`;
    case 'assist': return `assist${who ? ` — ${who}` : ''} (${team})`;
    case 'foul': return `${team} foul${who ? ` (${who})` : ''}`;
    case 'yellow_card': return `yellow card — ${who ? `${who}, ` : ''}${team}`;
    case 'red_card': return `red card — ${who ? `${who}, ` : ''}${team}`;
    case 'card': return `${CARD[String(x.kind)] ?? 'card'} — ${who ? `${who}, ` : ''}${team}`;
    case 'sub': return `substitution (${team})`;
    case 'timeout': return `${team} timeout`;
    case 'period_change': return x.kind === 'halftime' ? 'half-time' : 'end of period';
    // Chess
    case 'move': return `${x.side === 'B' ? 'Black' : 'White'} move`;
    case 'result': {
      if (x.winner === 'draw') return 'result — draw';
      if (x.winner === 'white' || x.winner === 'black') return `result — ${x.winner === 'black' ? 'Black' : 'White'} wins`;
      return 'result';
    }
    // Carrom
    case 'queen': return `${team} queen`;
    // Rally sports
    case 'serve_swap': return 'serve change';
    case 'note': return x.kind ? words(String(x.kind)) : 'note';
    default:
      return t ? `a ${words(t)} entry` : 'an entry';
  }
}

/** The score, as short as it can be read: "3–1", "games 1–0 · 3–1", "Lions 45/2". */
export function scoreText(summary: P | null | undefined, ctx: LogContext): string | null {
  if (!summary || typeof summary !== 'object') return null;
  const A: P = summary.A ?? {};
  const B: P = summary.B ?? {};
  if (A.runs != null || B.runs != null) {
    const side = (s: P, name: string) => `${name} ${Number(s.runs ?? 0)}/${Number(s.wickets ?? 0)}`;
    return Number(B.balls ?? 0) > 0 || Number(B.runs ?? 0) > 0
      ? `${side(A, ctx.teamA)} · ${side(B, ctx.teamB)}`
      : side(A, ctx.teamA);
  }
  if (A.points != null || B.points != null) {
    const pts = `${Number(A.points ?? 0)}–${Number(B.points ?? 0)}`;
    // Games (or sets) only when they are counted apart from the points in play.
    const separate = A.score !== A.points || B.score !== B.points;
    const games = separate && Number(A.score ?? 0) + Number(B.score ?? 0) > 0
      ? `games ${Number(A.score ?? 0)}–${Number(B.score ?? 0)} · ` : '';
    return `${games}${pts}`;
  }
  if (A.score != null || B.score != null) return `${Number(A.score ?? 0)}–${Number(B.score ?? 0)}`;
  return null;
}

/** What an edited event is called when it has no ball number: "a point",
 *  "a goal", "a card" — never the internal type name. */
export function eventNoun(type: string | null | undefined, ctx: LogContext): string {
  const t = String(type ?? '');
  if (t === 'score' || t === 'point' || t === 'goal' || t === 'basket') {
    if (ctx.sport === 'football' || ctx.sport === 'hockey') return 'a goal';
    if (ctx.sport === 'basketball') return 'a basket';
    if (ctx.sport === 'carrom') return 'a board';
    return 'a point';
  }
  const named: Record<string, string> = {
    ball: 'a ball', extra: 'an extra', wicket: 'a wicket', card: 'a card', yellow_card: 'a card', red_card: 'a card',
    foul: 'a foul', assist: 'an assist', move: 'a move', result: 'the result', queen: 'the queen',
    sub: 'a substitution', timeout: 'a timeout', period_change: 'a period change', serve_swap: 'a serve change',
  };
  return named[t] ?? (t ? `a ${words(t)} entry` : 'an entry');
}

/** An edit logged before migration 109 carries the payload only — guess its
 *  type from what it holds, so "2 runs → 3 runs" still reads. */
function inferType(p: P): string | null {
  if (p.wicket_type != null) return 'wicket';
  if (p.runs != null) return p.type && EXTRA[String(p.type)] ? 'extra' : 'ball';
  if (p.kind != null || p.value != null) return 'score';
  return null;
}

export interface AuditRow {
  id: string;
  action: string;
  changed_by: string;
  created_at: string;
  event_id?: string | null;
  old_payload?: P | null;
  new_payload?: P | null;
  score_before?: P | null;
  score_after?: P | null;
}

/**
 * One log row as a line. `who` is the person's name; `label` is where the
 * event sits when it still exists ("ball 4.3").
 */
export function editLine(row: AuditRow, who: string, ctx: LogContext, label?: string | null): string {
  const old = row.old_payload ?? {};
  // Undo / delete (migration 107 on): old_payload is the whole event row.
  // Edit: old_payload is the payload, with __event_type added (109 on).
  const isRow = typeof old.event_type === 'string' && old.payload && typeof old.payload === 'object';
  const type = isRow ? old.event_type : (old.__event_type ?? inferType(old));
  const oldP = isRow ? old.payload : old;
  const before = scoreText(row.score_before, ctx);
  const after = scoreText(row.score_after, ctx);
  const scorePart = before && after && before !== after ? `, ${before} → ${after}` : '';

  if (row.action === 'undo' || row.action === 'delete') {
    const verb = row.action === 'undo' ? 'undid' : 'deleted';
    return `${who} ${verb}: ${describeEvent(type, oldP, ctx)}${scorePart}`;
  }
  if (row.action === 'edit') {
    const from = describeEvent(type, oldP, ctx);
    const to = describeEvent(type, row.new_payload ?? {}, ctx);
    const where = label ?? eventNoun(type, ctx);
    const change = from !== to ? `${from} → ${to}` : 'details changed';
    return `${who} edited ${where}: ${change}${scorePart}`;
  }
  return `${who} changed ${type ? `a ${words(String(type))}` : 'an entry'}${scorePart}`;
}

/**
 * Cricket: "ball 4.3" for each event still on the match, counted the way the
 * scorecard counts (per innings, wides and no-balls don't advance the over).
 */
export function cricketBallLabels(events: Array<{ id: string; event_type: string; payload?: P | null }>): Map<string, string> {
  const legal: Record<'A' | 'B', number> = { A: 0, B: 0 };
  const out = new Map<string, string>();
  for (const ev of events) {
    if (ev.event_type !== 'ball' && ev.event_type !== 'extra' && ev.event_type !== 'wicket') continue;
    const p: P = ev.payload ?? {};
    const side: 'A' | 'B' = p.team_side === 'B' ? 'B' : 'A';
    const isLegal = isBallOfOver(ev.event_type, p);
    if (isLegal) legal[side] += 1;
    const n = isLegal ? legal[side] : legal[side] + 1;
    out.set(ev.id, `ball ${Math.floor((n - 1) / 6)}.${((n - 1) % 6) + 1}`);
  }
  return out;
}
