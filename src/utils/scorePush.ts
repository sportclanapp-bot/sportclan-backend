/**
 * V-5 · what a live score push says — and whether there is one at all.
 *
 * The fan-out pushed on EVERY 'score' event. For a rally sport that is every
 * rally: test 3's badminton match sent each player 92 pushes. And it quoted the
 * summary's live `points`, which a game-ending point has already reset — so the
 * point that won a game was announced as "SC434 Fresh QA scores! 0-0".
 *
 * Now, for sports scored in games and sets, a push marks the moment that
 * matters and quotes it:
 *   rally / carrom  a GAME ends   → "QA Flow Test wins game 2 · 23–21"
 *   tennis          a SET ends    → "SC434 Fresh QA wins set 3 · 7–6 (7–5)"
 * A point that ends nothing sends nothing. (The match end has its own
 * match_result notification.)
 *
 * Basketball: a basket sends nothing either — a game has ~150 of them. The
 * quarter's end does (`quarterPush`, on the period_change event), and the final
 * is the match_result notification.
 *
 * Football / hockey keep a push per goal and cricket per wicket: those are the
 * moments, and a match has a handful.
 */
import { periodLabel } from './basketballRules';

type SideLine = { score?: number; points?: number; games?: number; sets?: number[]; goals?: number } | undefined;

const RALLY = new Set(['badminton', 'tabletennis', 'pickleball', 'volleyball', 'carrom']);

export function scorePush(args: {
  slug: string;
  summary: { A?: SideLine; B?: SideLine; set_tiebreaks?: Array<{ A: number; B: number } | null> };
  side: 'A' | 'B';
  teamName: string;
  kind?: string;
  /**
   * F-04 (confirmed live): the summary BEFORE this event. A point after the
   * match was decided changes nothing server-side, so the "a game just ended"
   * test kept matching the last finished game and re-sent "wins board 2" for
   * every extra tap. A game/set push now needs this event to have finished one.
   */
  prevSummary?: { A?: SideLine; B?: SideLine } | null;
}): { title: string; body: string } | null {
  const { slug, summary, side, teamName, kind } = args;
  const prevN = Math.max(args.prevSummary?.A?.sets?.length ?? 0, args.prevSummary?.B?.sets?.length ?? 0);
  const A = summary.A ?? {};
  const B = summary.B ?? {};
  const setsA = A.sets ?? [];
  const setsB = B.sets ?? [];
  const n = Math.max(setsA.length, setsB.length);
  const mine = (a: number, b: number) => (side === 'A' ? `${a}–${b}` : `${b}–${a}`);

  if (RALLY.has(slug)) {
    // A game just ended exactly when the live points are back at 0-0 and a
    // completed game exists — this event was its last point.
    const gameEnded = n > prevN && (A.points ?? 0) === 0 && (B.points ?? 0) === 0;
    if (!gameEnded) return null;
    // A5: a carrom 'set' in the summary is now a GAME to 25 (boards are inside it).
    const word = slug === 'volleyball' ? 'set' : 'game';
    return { title: `${word[0]!.toUpperCase()}${word.slice(1)} to ${teamName}`, body: `${teamName} wins ${word} ${n} · ${mine(setsA[n - 1] ?? 0, setsB[n - 1] ?? 0)}` };
  }

  if (slug === 'tennis') {
    const setEnded = n > prevN && (A.games ?? 0) === 0 && (B.games ?? 0) === 0 && (A.points ?? 0) === 0 && (B.points ?? 0) === 0;
    if (!setEnded) return null;
    const tb = summary.set_tiebreaks?.[n - 1];
    const games = mine(setsA[n - 1] ?? 0, setsB[n - 1] ?? 0);
    const tbText = tb ? ` (${mine(tb.A, tb.B)})` : '';
    return { title: `Set to ${teamName}`, body: `${teamName} wins set ${n} · ${games}${tbText}` };
  }

  if (slug === 'basketball') return null; // per quarter instead — see quarterPush

  // Goals: every one is the moment.
  const val = (s: SideLine) => (s ? s.score ?? s.goals ?? s.points ?? 0 : 0);
  return { title: kind === 'goal' ? 'GOAL!' : 'Score!', body: `${teamName} scores! ${val(summary.A)}-${val(summary.B)}` };
}

/**
 * Basketball's end-of-quarter push: "End of Q2 · Lakers 45–40 Celtics".
 * `quarter` is the quarter that just ended (the count of period_change events).
 * Q4's end is the match end, which match_result announces — the app ends the
 * match there rather than sending a fifth period_change.
 */
export function quarterPush(args: {
  quarter: number;
  summary: { A?: SideLine; B?: SideLine };
  teamAName: string;
  teamBName: string;
}): { title: string; body: string } {
  const pts = (s: SideLine) => (s ? s.points ?? s.score ?? 0 : 0);
  return {
    title: `End of ${periodLabel(args.quarter)}`, // A1: Q1–Q4, then OT1, OT2 …
    body: `${args.teamAName} ${pts(args.summary.A)}–${pts(args.summary.B)} ${args.teamBName}`,
  };
}
