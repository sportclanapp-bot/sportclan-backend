/**
 * Cricket gap 2 (5 Oct 2026) · a cricket tournament's leaderboards: most runs,
 * most wickets, best bowling in a match, most sixes, most catches, and the
 * player of the tournament — from each played fixture's per-player rollup
 * (`score_summary.players`, which names guests too), or, for an older match
 * without one, its `innings_stats` rows.
 *
 * A player with an account is one person across matches (their user id). A
 * guest is entered afresh each match with a new id, so a guest is counted by
 * name within their team ("Raju" of Sunrisers in every match is one player).
 *
 * Player of the tournament: the points player of the match uses (runs + 25 a
 * wicket), plus 10 for each catch, run-out and stumping.
 */

export type LeaderStat = 'runs' | 'wickets' | 'best_bowling' | 'sixes' | 'catches' | 'player_of_tournament';
export const LEADER_STATS: readonly LeaderStat[] = ['runs', 'wickets', 'best_bowling', 'sixes', 'catches', 'player_of_tournament'];
export const LEADERS_PER_STAT = 5;

export interface PlayerLine {
  name?: string | null;
  side?: 'A' | 'B';
  runs?: number; balls?: number; fours?: number; sixes?: number; out?: boolean;
  bowl_balls?: number; bowl_runs?: number; bowl_wickets?: number;
  catches?: number; runouts?: number; stumpings?: number;
}
export interface LeaderMatch {
  id: string;
  team_a_id: string | null;
  team_b_id: string | null;
  players: Record<string, PlayerLine> | null;
}
/** An innings_stats row (older matches), with the player's name. */
export interface StatsRow {
  match_id: string; user_id: string; team_id: string | null; name: string | null;
  runs: number | null; balls_faced: number | null; sixes: number | null; is_out: boolean | null;
  bowling_overs: number | null; bowling_runs: number | null; bowling_wickets: number | null;
  catches: number | null; runouts: number | null; stumpings: number | null;
}
export interface LeaderRow {
  user_id: string | null; name: string; team_id: string | null; team_name: string | null;
  stat: LeaderStat; value: number;
  /** What the value means in words: "3 matches · SR 142", "4/12", "8 wkts · 30 runs". */
  detail: string;
}

const GUEST = 'guest:';
const n = (x: unknown) => (typeof x === 'number' && Number.isFinite(x) ? x : 0);
/** Decimal overs (1.3) → balls (9). */
const oversToBalls = (o: number | null) => { const v = n(o); return Math.floor(v) * 6 + Math.round((v % 1) * 10); };

interface Tally {
  user_id: string | null; name: string; team_id: string | null;
  matches: Set<string>; runs: number; balls: number; sixes: number; outs: number;
  bowlBalls: number; bowlRuns: number; wickets: number; catches: number; runouts: number; stumpings: number;
  best: { w: number; r: number } | null;
}

export function tournamentLeaders(
  matches: LeaderMatch[], statsRows: StatsRow[], teamNames: Record<string, string>,
  /**
   * The accounts the rows name: their name today (a rollup may carry none, or an
   * old one), and whether deleted — a deleted account is left off the boards, as
   * on the other leaderboards.
   */
  accounts: Record<string, { name: string | null; deleted: boolean }> = {},
): Record<LeaderStat, LeaderRow[]> {
  const tallies = new Map<string, Tally>();
  const tally = (key: string, user_id: string | null, name: string, team_id: string | null): Tally => {
    let t = tallies.get(key);
    if (!t) {
      t = { user_id, name, team_id, matches: new Set(), runs: 0, balls: 0, sixes: 0, outs: 0, bowlBalls: 0, bowlRuns: 0, wickets: 0, catches: 0, runouts: 0, stumpings: 0, best: null };
      tallies.set(key, t);
    }
    if (!t.name && name) t.name = name;
    return t;
  };
  const add = (t: Tally, matchId: string, l: { runs: number; balls: number; sixes: number; out: boolean; bowlBalls: number; bowlRuns: number; wickets: number; catches: number; runouts: number; stumpings: number }) => {
    t.matches.add(matchId);
    t.runs += l.runs; t.balls += l.balls; t.sixes += l.sixes; t.outs += l.out ? 1 : 0;
    t.bowlBalls += l.bowlBalls; t.bowlRuns += l.bowlRuns; t.wickets += l.wickets;
    t.catches += l.catches; t.runouts += l.runouts; t.stumpings += l.stumpings;
    if (l.bowlBalls > 0 && (!t.best || l.wickets > t.best.w || (l.wickets === t.best.w && l.bowlRuns < t.best.r))) t.best = { w: l.wickets, r: l.bowlRuns };
  };

  const withRollup = new Set<string>();
  for (const m of matches) {
    if (!m.players || typeof m.players !== 'object' || Object.keys(m.players).length === 0) continue;
    withRollup.add(m.id);
    for (const [id, p] of Object.entries(m.players)) {
      const team = (p.side === 'B' ? m.team_b_id : m.team_a_id) ?? null;
      const guest = id.startsWith(GUEST);
      if (!guest && accounts[id]?.deleted) continue;
      const name = ((guest ? null : accounts[id]?.name) ?? p.name ?? '').trim();
      if (guest && !name) continue; // an unnamed guest can't be followed across matches
      const key = guest ? `g:${team ?? ''}:${name.toLowerCase()}` : `u:${id}`;
      add(tally(key, guest ? null : id, name, team), m.id, {
        runs: n(p.runs), balls: n(p.balls), sixes: n(p.sixes), out: p.out === true,
        bowlBalls: n(p.bowl_balls), bowlRuns: n(p.bowl_runs), wickets: n(p.bowl_wickets),
        catches: n(p.catches), runouts: n(p.runouts), stumpings: n(p.stumpings),
      });
    }
  }
  // Older matches: their innings_stats rows (one per player per match).
  for (const r of statsRows) {
    if (withRollup.has(r.match_id) || accounts[r.user_id]?.deleted) continue;
    add(tally(`u:${r.user_id}`, r.user_id, (accounts[r.user_id]?.name ?? r.name ?? '').trim(), r.team_id), r.match_id, {
      runs: n(r.runs), balls: n(r.balls_faced), sixes: n(r.sixes), out: r.is_out === true,
      bowlBalls: oversToBalls(r.bowling_overs), bowlRuns: n(r.bowling_runs), wickets: n(r.bowling_wickets),
      catches: n(r.catches), runouts: n(r.runouts), stumpings: n(r.stumpings),
    });
  }

  const all = [...tallies.values()].filter((t) => t.name);
  const row = (t: Tally, stat: LeaderStat, value: number, detail: string): LeaderRow => ({
    user_id: t.user_id, name: t.name, team_id: t.team_id, team_name: t.team_id ? teamNames[t.team_id] ?? null : null, stat, value, detail,
  });
  const played = (t: Tally) => `${t.matches.size} match${t.matches.size === 1 ? '' : 'es'}`;
  const runs = (n: number) => `${n} run${n === 1 ? '' : 's'}`;
  const overs = (b: number) => `${Math.floor(b / 6)}${b % 6 ? `.${b % 6}` : ''}`;
  const top = (stat: LeaderStat, value: (t: Tally) => number, detail: (t: Tally) => string, tie: (a: Tally, b: Tally) => number = () => 0) =>
    all.filter((t) => value(t) > 0)
      .sort((a, b) => value(b) - value(a) || tie(a, b) || a.name.localeCompare(b.name))
      .slice(0, LEADERS_PER_STAT)
      .map((t) => row(t, stat, value(t), detail(t)));
  const pot = (t: Tally) => t.runs + 25 * t.wickets + 10 * (t.catches + t.runouts + t.stumpings);

  return {
    // Ties: fewer balls faced (the quicker scorer) first.
    runs: top('runs', (t) => t.runs, (t) => `${played(t)}${t.balls ? ` · SR ${Math.round((t.runs * 100) / t.balls)}` : ''}`, (a, b) => a.balls - b.balls),
    // Ties: fewer runs conceded first.
    wickets: top('wickets', (t) => t.wickets, (t) => `${played(t)} · ${overs(t.bowlBalls)} ov · ${runs(t.bowlRuns)}`, (a, b) => a.bowlRuns - b.bowlRuns),
    best_bowling: all.filter((t) => t.best && t.best.w > 0)
      .sort((a, b) => b.best!.w - a.best!.w || a.best!.r - b.best!.r || a.name.localeCompare(b.name))
      .slice(0, LEADERS_PER_STAT)
      .map((t) => row(t, 'best_bowling', t.best!.w, `${t.best!.w}/${t.best!.r}`)),
    sixes: top('sixes', (t) => t.sixes, (t) => `${played(t)} · ${runs(t.runs)}`),
    catches: top('catches', (t) => t.catches, (t) => `${played(t)}${t.stumpings ? ` · ${t.stumpings} stumping${t.stumpings === 1 ? '' : 's'}` : ''}`),
    player_of_tournament: top('player_of_tournament', pot, (t) => [runs(t.runs), `${t.wickets} wkt${t.wickets === 1 ? '' : 's'}`, ...(t.catches + t.runouts + t.stumpings ? [`${t.catches + t.runouts + t.stumpings} in the field`] : [])].join(' · ')),
  };
}

/** Every account the rows name (to look up deleted ones). */
export function leaderUserIds(matches: LeaderMatch[], statsRows: StatsRow[]): string[] {
  const ids = new Set<string>();
  for (const m of matches) for (const id of Object.keys(m.players ?? {})) if (!id.startsWith(GUEST)) ids.add(id);
  for (const r of statsRows) ids.add(r.user_id);
  return [...ids];
}
