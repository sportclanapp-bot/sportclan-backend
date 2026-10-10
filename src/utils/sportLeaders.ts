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
import { pointHowFor } from './matchRules'; // Stage 14 · VB8

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
    /** Stage 9 · T11: tennis — each set's tiebreak, and the serve stats per side. */
    set_tiebreaks?: Array<{ A: number; B: number } | null> | null;
    /** Stage 16 · HK2: set pieces per team (hockey PCs, strokes; football penalties). */
    set_pieces?: Partial<Record<"A" | "B", { pc?: number; pc_goals?: number }>> | null;
    serve?: Partial<Record<'A' | 'B', { aces?: unknown; double_faults?: unknown }>> | null;
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

type TTally = { team_id: string; played: number; won: number; lost: number; drawn: number; games: number; gamesLost: number; pf: number; pa: number; cleanSheets: number; tbWon: number; tbLost: number; aces: number; pc: number; pcGoals: number };

function teamTallies(matches: SportLeaderMatch[]): TTally[] {
  const out = new Map<string, TTally>();
  const t = (id: string) => { let x = out.get(id); if (!x) { x = { team_id: id, played: 0, won: 0, lost: 0, drawn: 0, games: 0, gamesLost: 0, pf: 0, pa: 0, cleanSheets: 0, tbWon: 0, tbLost: 0, aces: 0, pc: 0, pcGoals: 0 }; out.set(id, x); } return x; };
  for (const m of matches) {
    const ids: Array<[string | null, 'A' | 'B']> = [[m.team_a_id, 'A'], [m.team_b_id, 'B']];
    const tie = m.score_summary?.rubbers != null;
    // A walkover or an awarded score (Stage 8 · F12) wasn't played: it counts for the result, not for points, games or clean sheets.
    const wo = m.result_type === 'walkover' || m.result_type === 'awarded' || !!m.score_summary?.walkover;
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
      // Stage 9 · T11: tennis's tiebreaks won/lost (a match tiebreak counts) and aces.
      for (const tb of m.score_summary?.set_tiebreaks ?? []) {
        if (!tb) continue;
        if (tb[side] > tb[other]) me.tbWon += 1; else if (tb[other] > tb[side]) me.tbLost += 1;
      }
      me.aces += n(Number(m.score_summary?.serve?.[side]?.aces ?? 0));
      // A goal sport's score is A.score / B.score (the live rollup); `value` as a fallback.
      const goalsOf = (x: 'A' | 'B') => { const v = m.score_summary?.[x]?.score ?? m.score_summary?.[x]?.value; return typeof v === 'number' ? v : typeof v === 'string' && v.trim() !== '' && Number.isFinite(Number(v)) ? Number(v) : null; };
      const conceded = goalsOf(other);
      if (conceded === 0 && goalsOf(side) != null) me.cleanSheets += 1;
      // Stage 16 · HK2: hockey's penalty corners won and scored from.
      me.pc += n(Number(m.score_summary?.set_pieces?.[side]?.pc ?? 0)); me.pcGoals += n(Number(m.score_summary?.set_pieces?.[side]?.pc_goals ?? 0));
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
    const p = playerTallies(matches, ['goals', 'assists', 'yellow_cards', 'red_cards', 'green_cards', 'pc_goals', 'stroke_goals', 'pen_goals', 'fk_goals', 'pens_missed', 'strokes_missed'], accounts);
    const teams = teamTallies(matches);
    const cards = (t: PTally) => 3 * (t.s.red_cards ?? 0) + (t.s.yellow_cards ?? 0) + (t.s.green_cards ?? 0);
    const pctOf = (made: number, of: number) => (of > 0 ? Math.round((1000 * made) / of) / 10 : 0);
    // Stage 16 · HK2: goals by how, once there's one — hockey's penalty corners and strokes, football's penalties and free kicks.
    const setPieceBoards = (k === 'hockey'
      ? [
        topPlayers(p, 'pc_goals', 'Penalty-corner goals', 'goal', 'goals', teamNames, (t) => t.s.pc_goals ?? 0, played),
        topPlayers(p, 'stroke_goals', 'Penalty-stroke goals', 'goal', 'goals', teamNames, (t) => t.s.stroke_goals ?? 0, (t) => `${t.s.stroke_goals ?? 0}/${(t.s.stroke_goals ?? 0) + (t.s.strokes_missed ?? 0)} strokes`),
        topTeams(teams.filter((t) => t.pc > 0), 'pc_conversion', 'Penalty-corner conversion', '%', '%', teamNames, (t) => pctOf(t.pcGoals, t.pc), (t) => `${t.pcGoals}/${t.pc} corners`),
      ]
      : [
        topPlayers(p, 'pen_goals', 'Penalty goals', 'goal', 'goals', teamNames, (t) => t.s.pen_goals ?? 0, (t) => `${t.s.pen_goals ?? 0}/${(t.s.pen_goals ?? 0) + (t.s.pens_missed ?? 0)} taken`),
        topPlayers(p, 'fk_goals', 'Free-kick goals', 'goal', 'goals', teamNames, (t) => t.s.fk_goals ?? 0, played),
      ]).filter((b) => b.rows.length > 0);
    return [
      topPlayers(p, 'goals', 'Top scorers', 'goal', 'goals', teamNames, (t) => t.s.goals ?? 0, played),
      topPlayers(p, 'assists', 'Assists', 'assist', 'assists', teamNames, (t) => t.s.assists ?? 0, played),
      ...setPieceBoards,
      topPlayers(p, 'cards', 'Cards', 'point', 'points', teamNames, cards,
        (t) => [t.s.yellow_cards ? `🟨 ${t.s.yellow_cards}` : null, t.s.green_cards ? `🟩 ${t.s.green_cards}` : null, t.s.red_cards ? `🟥 ${t.s.red_cards}` : null].filter(Boolean).join(' · ')),
      topTeams(teams, 'clean_sheets', 'Clean sheets', 'clean sheet', 'clean sheets', teamNames, (t) => t.cleanSheets, (t) => pl(t.played, 'match', 'matches')),
    ];
  }
  if (k === 'basketball') {
    const p = playerTallies(matches, ['points', 'assists', 'rebounds', 'steals', 'blocks', 'oreb', 'dreb', 'turnovers', 'fgm', 'fga', 'tpm', 'tpa', 'ftm', 'fta'], accounts);
    const pct = (m: number, a: number) => (a > 0 ? Math.round((1000 * m) / a) / 10 : 0);
    // Stage 15 · BB8: FIBA's efficiency — points + rebounds + assists + steals + blocks − missed shots − turnovers.
    const eff = (t: PTally) => (t.s.points ?? 0) + (t.s.rebounds ?? 0) + (t.s.assists ?? 0) + (t.s.steals ?? 0) + (t.s.blocks ?? 0)
      - ((t.s.fga ?? 0) - (t.s.fgm ?? 0)) - ((t.s.fta ?? 0) - (t.s.ftm ?? 0)) - (t.s.turnovers ?? 0);
    // A share made means something only once misses are kept: each shooting board waits for its first miss.
    const kept = (m: string, a: string) => p.some((t) => (t.s[a] ?? 0) > (t.s[m] ?? 0));
    const shooters = (m: string, a: string) => (kept(m, a) ? p.filter((t) => (t.s[a] ?? 0) > 0) : []);
    // Efficiency, once the box score is kept (a rebound, steal, block, turnover or miss) — else it's the points again.
    const boxKept = p.some((t) => (t.s.rebounds ?? 0) + (t.s.steals ?? 0) + (t.s.blocks ?? 0) + (t.s.turnovers ?? 0) > 0) || kept('fgm', 'fga') || kept('ftm', 'fta');
    return [
      topPlayers(p, 'points', 'Top scorers', 'point', 'points', teamNames, (t) => t.s.points ?? 0, played),
      topPlayers(p, 'assists', 'Assists', 'assist', 'assists', teamNames, (t) => t.s.assists ?? 0, played),
      // Stage 14 · VB8 / Stage 15 · BB8: the box score, once anyone has one.
      topPlayers(p, 'rebounds', 'Rebounds', 'rebound', 'rebounds', teamNames, (t) => t.s.rebounds ?? 0, (t) => (t.s.oreb || t.s.dreb ? `${t.s.oreb ?? 0} off · ${t.s.dreb ?? 0} def` : played(t))),
      topPlayers(p, 'steals', 'Steals', 'steal', 'steals', teamNames, (t) => t.s.steals ?? 0, played),
      topPlayers(p, 'blocks', 'Blocks', 'block', 'blocks', teamNames, (t) => t.s.blocks ?? 0, played),
      topPlayers(boxKept ? p : [], 'efficiency', 'Efficiency', 'eff', 'eff', teamNames, eff, played),
      // Shooting: the share made, its attempts beside it (any attempt ranks — no app minimum).
      topPlayers(shooters('fgm', 'fga'), 'fg_pct', 'Field goal %', '%', '%', teamNames, (t) => pct(t.s.fgm ?? 0, t.s.fga ?? 0), (t) => `${t.s.fgm ?? 0}/${t.s.fga ?? 0}`),
      topPlayers(shooters('tpm', 'tpa'), 'tp_pct', '3-point %', '%', '%', teamNames, (t) => pct(t.s.tpm ?? 0, t.s.tpa ?? 0), (t) => `${t.s.tpm ?? 0}/${t.s.tpa ?? 0}`),
      topPlayers(shooters('ftm', 'fta'), 'ft_pct', 'Free throw %', '%', '%', teamNames, (t) => pct(t.s.ftm ?? 0, t.s.fta ?? 0), (t) => `${t.s.ftm ?? 0}/${t.s.fta ?? 0}`),
      topPlayers(p, 'turnovers', 'Turnovers', 'turnover', 'turnovers', teamNames, (t) => t.s.turnovers ?? 0, played),
    ].filter((b, i) => i < 2 || b.rows.length > 0);
  }
  const teams = teamTallies(matches);
  const wins = topTeams(teams, 'wins', 'Most wins', 'win', 'wins', teamNames, (t) => t.won, record, false, (a, b) => a.lost - b.lost);
  if (RALLY.has(k)) {
    const word = k === 'volleyball' ? ['set', 'sets'] : ['game', 'games'];
    // Stage 14 · VB8: player boards from the points credited — the best scorers and each way of winning one (when said).
    const hows = pointHowFor(k).filter((h) => !h.error);
    const p = playerTallies(matches, ['points', ...hows.map((h) => `how_${h.key}`)], accounts);
    const playerBoards = [
      topPlayers(p, 'points', k === 'volleyball' ? 'Top scorers' : 'Points won', 'point', 'points', teamNames, (t) => t.s.points ?? 0, played),
      ...hows.map((h) => topPlayers(p, `how_${h.key}`, h.board ?? h.label, h.key === 'ace' ? 'ace' : 'point', h.key === 'ace' ? 'aces' : 'points', teamNames, (t) => t.s[`how_${h.key}`] ?? 0, played)),
    ].filter((b) => b.rows.length > 0);
    return [
      wins,
      ...playerBoards,
      topTeams(teams, 'games', k === 'volleyball' ? 'Sets won' : 'Games won', word[0]!, word[1]!, teamNames, (t) => t.games, (t) => `${t.games}–${t.gamesLost}`, false, (a, b) => a.gamesLost - b.gamesLost),
      topTeams(teams, 'points_diff', 'Points difference', 'point', 'points', teamNames, (t) => t.pf - t.pa, (t) => `${t.pf}–${t.pa}`, true),
    ];
  }
  if (k === 'tennis') {
    // Stage 9 · T11: games won (each set's games), tiebreaks won and aces besides wins and sets.
    return [
      wins,
      topTeams(teams, 'sets', 'Sets won', 'set', 'sets', teamNames, (t) => t.games, (t) => `${t.games}–${t.gamesLost}`, false, (a, b) => a.gamesLost - b.gamesLost),
      topTeams(teams, 'games', 'Games won', 'game', 'games', teamNames, (t) => t.pf, (t) => `${t.pf}–${t.pa}`, false, (a, b) => a.pa - b.pa),
      topTeams(teams, 'tiebreaks', 'Tiebreaks won', 'tiebreak', 'tiebreaks', teamNames, (t) => t.tbWon, (t) => `${t.tbWon}–${t.tbLost}`, false, (a, b) => a.tbLost - b.tbLost),
      topTeams(teams, 'aces', 'Aces', 'ace', 'aces', teamNames, (t) => t.aces, (t) => pl(t.played, 'match', 'matches')),
    ];
  }
  if (k === 'chess' || k === 'carrom') return [wins];
  return [];
}
