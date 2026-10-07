/**
 * Stage 8 · F6 (Oct 2026) · a tournament's leaderboards for every sport, each
 * with its own stats (cricket's stay in tournamentLeaders and are carried over):
 *   - football / hockey: top scorers, assists, cards (reds count 3, yellows 1),
 *     clean sheets (by team — a keeper isn't named per match)
 *   - basketball: points, assists
 *   - badminton, table tennis, pickleball, volleyball: matches won, games (sets)
 *     won, points difference; tennis: matches and sets won
 *   - chess, carrom: wins
 * From each played fixture's own record: score_summary.players (the scorer's
 * credits; a guest is one player by name within their team, as on cricket's
 * boards) and the score. A team tie (rubbers) counts in none of the game boards.
 */
export const BOARD_ROWS = 5;

export type BoardRow = {
  user_id: string | null; team_id: string | null; name: string; team_name: string | null;
  value: number; detail: string;
};
export type Board = { stat: string; title: string; one: string; many: string; kind: 'player' | 'team'; rows: BoardRow[] };

export interface SportLeaderMatch {
  id: string;
  team_a_id: string | null; team_b_id: string | null; winner_team_id: string | null;
  result_type?: string | null;
  score_summary?: {
    A?: { score?: unknown; value?: unknown; sets?: unknown }; B?: { score?: unknown; value?: unknown; sets?: unknown };
    players?: Record<string, Record<string, unknown>> | null; rubbers?: unknown; walkover?: unknown;
  } | null;
}

const GUEST = 'guest:';
const n = (x: unknown) => (typeof x === 'number' && Number.isFinite(x) ? x : 0);
const nums = (x: unknown): number[] => (Array.isArray(x) ? x.map(Number).filter((v) => Number.isFinite(v)) : []);
const key = (s: string | null | undefined) => String(s ?? '').toLowerCase().replace(/[-_\s]/g, '');
const pl = (v: number, one: string, many: string) => `${v} ${v === 1 ? one : many}`;

type PTally = { user_id: string | null; name: string; team_id: string | null; matches: Set<string>; s: Record<string, number> };

/** Per-player sums of the given line fields across matches. */
function playerTallies(
  matches: SportLeaderMatch[], fields: string[], accounts: Record<string, { name: string | null; deleted: boolean }>,
): PTally[] {
  const out = new Map<string, PTally>();
  for (const m of matches) {
    const players = m.score_summary?.players;
    if (!players) continue;
    for (const [id, line] of Object.entries(players)) {
      const side = line.side === 'B' ? 'B' : 'A';
      const team = side === 'A' ? m.team_a_id : m.team_b_id;
      const guest = id.startsWith(GUEST);
      if (!guest && accounts[id]?.deleted) continue;
      const nm = String((!guest && accounts[id]?.name) || line.name || '').trim();
      const k = guest ? `g:${team ?? ''}:${nm.toLowerCase()}` : id;
      if (guest && !nm) continue;
      let t = out.get(k);
      if (!t) { t = { user_id: guest ? null : id, name: nm || 'Player', team_id: team, matches: new Set(), s: {} }; out.set(k, t); }
      t.matches.add(m.id);
      for (const f of fields) t.s[f] = (t.s[f] ?? 0) + n(line[f]);
    }
  }
  return [...out.values()];
}

function topPlayers(
  tallies: PTally[], stat: string, title: string, one: string, many: string, teamNames: Record<string, string>,
  value: (t: PTally) => number, detail: (t: PTally) => string,
): Board {
  const rows = tallies.filter((t) => value(t) > 0)
    .sort((a, b) => value(b) - value(a) || a.matches.size - b.matches.size || a.name.localeCompare(b.name))
    .slice(0, BOARD_ROWS)
    .map((t) => ({ user_id: t.user_id, team_id: t.team_id, name: t.name, team_name: t.team_id ? teamNames[t.team_id] ?? null : null, value: value(t), detail: detail(t) }));
  return { stat, title, one, many, kind: 'player', rows };
}

type TTally = { team_id: string; played: number; won: number; lost: number; drawn: number; games: number; gamesLost: number; pf: number; pa: number; cleanSheets: number };

function teamTallies(matches: SportLeaderMatch[]): TTally[] {
  const out = new Map<string, TTally>();
  const t = (id: string) => { let x = out.get(id); if (!x) { x = { team_id: id, played: 0, won: 0, lost: 0, drawn: 0, games: 0, gamesLost: 0, pf: 0, pa: 0, cleanSheets: 0 }; out.set(id, x); } return x; };
  for (const m of matches) {
    const ids: Array<[string | null, 'A' | 'B']> = [[m.team_a_id, 'A'], [m.team_b_id, 'B']];
    const tie = m.score_summary?.rubbers != null;
    const wo = m.result_type === 'walkover' || !!m.score_summary?.walkover;
    for (const [id, side] of ids) {
      if (!id) continue;
      const me = t(id); const other = side === 'A' ? 'B' : 'A';
      me.played += 1;
      if (m.winner_team_id === id) me.won += 1;
      else if (m.winner_team_id) me.lost += 1;
      else me.drawn += 1;
      if (tie || wo) continue;
      const mine = nums(m.score_summary?.[side]?.sets); const theirs = nums(m.score_summary?.[other]?.sets);
      for (let i = 0; i < Math.min(mine.length, theirs.length); i++) {
        me.pf += mine[i]!; me.pa += theirs[i]!;
        if (mine[i]! > theirs[i]!) me.games += 1; else if (theirs[i]! > mine[i]!) me.gamesLost += 1;
      }
      // A goal sport's score is A.score / B.score (the live rollup); `value` as a fallback.
      const goalsOf = (x: 'A' | 'B') => { const v = m.score_summary?.[x]?.score ?? m.score_summary?.[x]?.value; return typeof v === 'number' ? v : typeof v === 'string' && v.trim() !== '' && Number.isFinite(Number(v)) ? Number(v) : null; };
      const conceded = goalsOf(other);
      if (conceded === 0 && goalsOf(side) != null) me.cleanSheets += 1;
    }
  }
  return [...out.values()];
}

function topTeams(
  tallies: TTally[], stat: string, title: string, one: string, many: string, teamNames: Record<string, string>,
  value: (t: TTally) => number, detail: (t: TTally) => string, allowNegative = false,
  tie: (a: TTally, b: TTally) => number = () => 0,
): Board {
  const rows = tallies.filter((t) => (allowNegative ? t.played > 0 : value(t) > 0))
    .sort((a, b) => value(b) - value(a) || tie(a, b) || (teamNames[a.team_id] ?? '').localeCompare(teamNames[b.team_id] ?? ''))
    .slice(0, BOARD_ROWS)
    .map((t) => ({ user_id: null, team_id: t.team_id, name: teamNames[t.team_id] ?? 'Team', team_name: null, value: value(t), detail: detail(t) }));
  return { stat, title, one, many, kind: 'team', rows };
}

const RALLY = new Set(['badminton', 'tabletennis', 'pickleball', 'volleyball']);

/** Every board for a sport (cricket: none here — see tournamentLeaders). */
export function sportBoards(
  sport: string | null | undefined, matches: SportLeaderMatch[], teamNames: Record<string, string>,
  accounts: Record<string, { name: string | null; deleted: boolean }> = {},
): Board[] {
  const k = key(sport);
  const played = (t: { matches: Set<string> }) => pl(t.matches.size, 'match', 'matches');
  const record = (t: TTally) => `${t.won}W–${t.lost}L${t.drawn ? `–${t.drawn}D` : ''}`;
  if (k === 'football' || k === 'hockey') {
    const p = playerTallies(matches, ['goals', 'assists', 'yellow_cards', 'red_cards', 'green_cards'], accounts);
    const teams = teamTallies(matches);
    const cards = (t: PTally) => 3 * (t.s.red_cards ?? 0) + (t.s.yellow_cards ?? 0) + (t.s.green_cards ?? 0);
    return [
      topPlayers(p, 'goals', 'Top scorers', 'goal', 'goals', teamNames, (t) => t.s.goals ?? 0, played),
      topPlayers(p, 'assists', 'Assists', 'assist', 'assists', teamNames, (t) => t.s.assists ?? 0, played),
      topPlayers(p, 'cards', 'Cards', 'point', 'points', teamNames, cards,
        (t) => [t.s.yellow_cards ? `🟨 ${t.s.yellow_cards}` : null, t.s.green_cards ? `🟩 ${t.s.green_cards}` : null, t.s.red_cards ? `🟥 ${t.s.red_cards}` : null].filter(Boolean).join(' · ')),
      topTeams(teams, 'clean_sheets', 'Clean sheets', 'clean sheet', 'clean sheets', teamNames, (t) => t.cleanSheets, (t) => pl(t.played, 'match', 'matches')),
    ];
  }
  if (k === 'basketball') {
    const p = playerTallies(matches, ['points', 'assists'], accounts);
    return [
      topPlayers(p, 'points', 'Top scorers', 'point', 'points', teamNames, (t) => t.s.points ?? 0, played),
      topPlayers(p, 'assists', 'Assists', 'assist', 'assists', teamNames, (t) => t.s.assists ?? 0, played),
    ];
  }
  const teams = teamTallies(matches);
  const wins = topTeams(teams, 'wins', 'Most wins', 'win', 'wins', teamNames, (t) => t.won, record, false, (a, b) => a.lost - b.lost);
  if (RALLY.has(k)) {
    const word = k === 'volleyball' ? ['set', 'sets'] : ['game', 'games'];
    return [
      wins,
      topTeams(teams, 'games', k === 'volleyball' ? 'Sets won' : 'Games won', word[0]!, word[1]!, teamNames, (t) => t.games, (t) => `${t.games}–${t.gamesLost}`, false, (a, b) => a.gamesLost - b.gamesLost),
      topTeams(teams, 'points_diff', 'Points difference', 'point', 'points', teamNames, (t) => t.pf - t.pa, (t) => `${t.pf}–${t.pa}`, true),
    ];
  }
  if (k === 'tennis') return [wins, topTeams(teams, 'sets', 'Sets won', 'set', 'sets', teamNames, (t) => t.games, (t) => `${t.games}–${t.gamesLost}`, false, (a, b) => a.gamesLost - b.gamesLost)];
  if (k === 'chess' || k === 'carrom') return [wins];
  return [];
}
