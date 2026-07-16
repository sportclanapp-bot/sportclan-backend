import { Request, Response } from 'express';
import { supabase } from '../utils/supabase';
import { isPremiumActive } from '../utils/premium';
import { resolveSportId } from '../utils/sportId';
import { getTeamRole } from '../utils/teamAuth';

// SC-275: Advanced Stats (PREMIUM). Strictly ADDITIVE analytics that go BEYOND
// the free surfaces. Free already gives, and STAYS free:
//   • /users/:id/insights  → last-10 form, win streaks, last-10 rating trend
//   • getSportProfile      → cricket career total_runs / avg / SR / econ, ranks
//   • rating-history, activity-heatmap, scorecards, leaderboards, standings
// This endpoint adds what free does NOT: full rating trajectory + peak, win-rate
// over time, head-to-head opponent records, and win-rate splits by time / day /
// format / city. It NEVER fences an existing read — the ONLY new gate is the
// is_premium check below.
//
// NO fabrication (SC-155): every number derives from a real row. Thin data
// returns an honest lowData flag, never an invented trend.
//
// The analytics UNIVERSE is the user's RANKED matches for the sport — the ones
// with a rating_history row (guaranteed result, guaranteed sport, a match_id to
// join context). Casual/unranked matches have no rating impact and weak side
// data (joinOpenMatch defaults everyone to side 'A'), so they are honestly
// excluded and reported as `rankedMatches`.

const IST_OFFSET_MIN = 330; // Asia/Kolkata; matches TOURNAMENT_TZ_OFFSET_MIN + formatFixtureSlot
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

type Result = 'W' | 'L' | 'D';
function resultFromDelta(delta: number): Result {
  if (delta > 0) return 'W';
  if (delta < 0) return 'L';
  return 'D';
}

// GET /users/me/advanced-stats?sport_id=  (PREMIUM)
export async function getAdvancedStats(req: Request, res: Response) {
  const userId = req.userId;
  if (!userId) return res.status(401).json({ error: 'Unauthorized' });

  // The ONLY new fence. No existing read is affected by this feature.
  const { data: me } = await supabase
    .from('users').select('is_premium, premium_expires_at').eq('id', userId).maybeSingle();
  if (!isPremiumActive(me)) {
    return res.status(403).json({ error: 'Premium required for advanced stats', code: 'PREMIUM_REQUIRED' });
  }

  const rawSportId = req.query.sport_id as string | undefined;
  if (!rawSportId) return res.status(400).json({ error: 'sport_id is required' });
  const sportId = (await resolveSportId(rawSportId)) ?? rawSportId;

  try {
    // ── Universe: this user's ranked matches for the sport (rating_history) ──
    const { data: rh } = await supabase
      .from('rating_history')
      .select('match_id, old_rating, new_rating, delta, created_at')
      .eq('user_id', userId)
      .eq('sport_id', sportId)
      .order('created_at', { ascending: true });
    const history = rh ?? [];

    const { data: prof } = await supabase
      .from('user_sport_profiles').select('rating')
      .eq('user_id', userId).eq('sport_id', sportId).maybeSingle();
    const lastRow = history.length ? history[history.length - 1] : null;
    const currentRating = prof?.rating != null
      ? Number(prof.rating)
      : lastRow ? Number(lastRow.new_rating) : 1200;
    const peakRating = history.length
      ? Math.max(1200, ...history.map((h) => Number(h.new_rating)))
      : Math.round(currentRating);

    // Low-data honesty: too few ranked matches to show a real trend.
    const LOW_DATA_MIN = 5;
    if (history.length < LOW_DATA_MIN) {
      return res.json({
        lowData: true,
        rankedMatches: history.length,
        minMatches: LOW_DATA_MIN,
        currentRating: Math.round(currentRating),
        peakRating: Math.round(peakRating),
      });
    }

    // ── Match context for accurate results + #2/#3 ──
    const matchIds = history.map((h) => h.match_id).filter(Boolean) as string[];
    const idFilter = matchIds.length ? matchIds : ['00000000-0000-0000-0000-000000000000'];

    const { data: matchRows } = await supabase
      .from('matches')
      .select('id, team_a_id, team_b_id, team_a_name, team_b_name, winner_team_id, scheduled_at, format, city_id')
      .in('id', idFilter);
    const matches = matchRows ?? [];
    const matchById = new Map<string, (typeof matches)[number]>();
    for (const m of matches) matchById.set(m.id as string, m);

    const { data: myParts } = await supabase
      .from('match_participants').select('match_id, team_side')
      .eq('user_id', userId).in('match_id', idFilter);
    const mySideByMatch = new Map<string, 'A' | 'B'>();
    for (const p of myParts ?? []) if (p.match_id) mySideByMatch.set(p.match_id as string, p.team_side as 'A' | 'B');

    // Result per match: use the actual winner for team matches (accurate for
    // draws too); fall back to the rating delta sign for 1v1 / casual.
    const deltaByMatch = new Map<string, number>();
    history.forEach((h) => { if (h.match_id) deltaByMatch.set(h.match_id as string, Number(h.delta)); });
    function matchResult(mid: string): Result {
      const m = matchById.get(mid);
      const mySide = mySideByMatch.get(mid);
      if (m && m.team_a_id && m.team_b_id && mySide) {
        const myTeam = mySide === 'A' ? m.team_a_id : m.team_b_id;
        if (m.winner_team_id) return m.winner_team_id === myTeam ? 'W' : 'L';
        return 'D';
      }
      return resultFromDelta(deltaByMatch.get(mid) ?? 0);
    }
    const resultByMatch = new Map<string, Result>();
    for (const mid of matchIds) resultByMatch.set(mid, matchResult(mid));

    // ── #1 Form & trajectory ──
    const results: Result[] = history.map((h) =>
      (h.match_id && resultByMatch.get(h.match_id as string)) || resultFromDelta(Number(h.delta)),
    );
    const wins = results.filter((r) => r === 'W').length;
    const losses = results.filter((r) => r === 'L').length;
    const draws = results.filter((r) => r === 'D').length;
    const last10 = results.slice(-10);
    const last10Wins = last10.filter((r) => r === 'W').length;
    const lastResult = results.length ? results[results.length - 1] : 'D';
    let streakLen = 0;
    for (let i = results.length - 1; i >= 0 && results[i] === lastResult; i--) streakLen++;
    const netDelta5 = history.slice(-5).reduce((s, h) => s + Number(h.delta), 0);
    const trend = netDelta5 > 0 ? 'rising' : netDelta5 < 0 ? 'falling' : 'steady';
    const trajectory = history.map((h) => ({ rating: Math.round(Number(h.new_rating)), at: h.created_at }));

    // ── #2 Head-to-head ──
    // Team match → opponent = other team (id + denormalised name). 1v1 →
    // opponent = the single participant on the other side; if pickup left 0 or
    // >1 on the other side (joinOpenMatch side-'A' default), it's ambiguous and
    // is SKIPPED, not guessed (SC-155).
    const oneVoneIds = matches.filter((m) => !m.team_a_id && !m.team_b_id).map((m) => m.id as string);
    const oppUserByMatch = new Map<string, string>();
    if (oneVoneIds.length) {
      const { data: allParts } = await supabase
        .from('match_participants').select('match_id, user_id, team_side').in('match_id', oneVoneIds);
      const byMatch = new Map<string, Array<{ user_id: string; side: string }>>();
      for (const p of allParts ?? []) {
        const arr = byMatch.get(p.match_id as string) ?? [];
        arr.push({ user_id: p.user_id as string, side: p.team_side as string });
        byMatch.set(p.match_id as string, arr);
      }
      for (const [mid, arr] of byMatch) {
        const mySide = mySideByMatch.get(mid);
        const opps = arr.filter((x) => x.user_id !== userId && x.side !== mySide);
        if (mySide && opps.length === 1) oppUserByMatch.set(mid, opps[0]!.user_id);
      }
    }
    const oppUserIds = Array.from(new Set([...oppUserByMatch.values()]));
    const userName = new Map<string, string>();
    if (oppUserIds.length) {
      const { data: us } = await supabase.from('users').select('id, name, username').in('id', oppUserIds);
      for (const u of us ?? []) userName.set(u.id as string, (u.name as string) || (u.username as string) || 'Player');
    }

    const h2h = new Map<string, { name: string; w: number; l: number; d: number }>();
    let identifiable = 0;
    for (const m of matches) {
      const mid = m.id as string;
      const result = resultByMatch.get(mid);
      if (!result) continue;
      let key: string | null = null;
      let name = '';
      if (m.team_a_id && m.team_b_id) {
        const mySide = mySideByMatch.get(mid);
        if (!mySide) continue;
        const oppTeam = mySide === 'A' ? m.team_b_id : m.team_a_id;
        const oppName = mySide === 'A' ? m.team_b_name : m.team_a_name;
        key = `team:${oppTeam}`;
        name = (oppName as string) || 'Opponent team';
      } else {
        const oppUser = oppUserByMatch.get(mid);
        if (!oppUser) continue;
        key = `user:${oppUser}`;
        name = userName.get(oppUser) || 'Player';
      }
      identifiable++;
      const rec = h2h.get(key) ?? { name, w: 0, l: 0, d: 0 };
      if (result === 'W') rec.w++; else if (result === 'L') rec.l++; else rec.d++;
      h2h.set(key, rec);
    }
    const h2hList = Array.from(h2h.values())
      .map((r) => ({ ...r, played: r.w + r.l + r.d, winRate: Math.round((r.w / (r.w + r.l + r.d)) * 100) }))
      .sort((a, b) => b.played - a.played);
    const qualified = h2hList.filter((r) => r.played >= 2);
    const bestMatchup = qualified.slice().sort((a, b) => b.winRate - a.winRate || b.played - a.played)[0] ?? null;
    const worstMatchup = qualified.slice().sort((a, b) => a.winRate - b.winRate || b.played - a.played)[0] ?? null;

    // ── #3 Splits: win-rate by time-of-day / day-of-week / format / city ──
    const cityIds = Array.from(new Set(matches.map((m) => m.city_id).filter(Boolean) as string[]));
    const cityName = new Map<string, string>();
    if (cityIds.length) {
      const { data: cs } = await supabase.from('cities').select('id, name').in('id', cityIds);
      for (const c of cs ?? []) cityName.set(c.id as string, c.name as string);
    }
    const DOW = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
    const todBucket = (hour: number): string =>
      hour >= 5 && hour < 12 ? 'Morning'
        : hour >= 12 && hour < 17 ? 'Afternoon'
          : hour >= 17 && hour < 21 ? 'Evening'
            : 'Night';
    const acc = {
      tod: new Map<string, [number, number]>(),
      dow: new Map<string, [number, number]>(),
      fmt: new Map<string, [number, number]>(),
      city: new Map<string, [number, number]>(),
    };
    const bump = (m: Map<string, [number, number]>, key: string, won: boolean) => {
      const cur = m.get(key) ?? [0, 0];
      cur[0]++;
      if (won) cur[1]++;
      m.set(key, cur);
    };
    for (const m of matches) {
      const result = resultByMatch.get(m.id as string);
      if (!result) continue;
      const won = result === 'W';
      if (m.scheduled_at) {
        const ist = new Date(new Date(m.scheduled_at as string).getTime() + IST_OFFSET_MIN * 60000);
        bump(acc.tod, todBucket(ist.getUTCHours()), won);
        bump(acc.dow, DOW[ist.getUTCDay()]!, won);
      }
      if (m.format) bump(acc.fmt, String(m.format), won);
      if (m.city_id) bump(acc.city, cityName.get(m.city_id as string) || 'Unknown city', won);
    }
    const splitOut = (m: Map<string, [number, number]>) =>
      Array.from(m.entries())
        .map(([label, [played, w]]) => ({ label, played, wins: w, winRate: Math.round((w / played) * 100) }))
        .sort((a, b) => b.played - a.played);

    return res.json({
      lowData: false,
      rankedMatches: history.length,
      form: {
        currentRating: Math.round(currentRating),
        peakRating: Math.round(peakRating),
        wins, losses, draws,
        winRate: Math.round((wins / results.length) * 100),
        last10, last10Wins,
        streak: { type: lastResult, length: streakLen },
        trend, netDelta5: Math.round(netDelta5),
        trajectory,
      },
      headToHead: {
        coverage: { identifiable, total: history.length },
        opponents: h2hList.slice(0, 10),
        best: bestMatchup,
        worst: worstMatchup,
      },
      splits: {
        timeOfDay: splitOut(acc.tod),
        dayOfWeek: splitOut(acc.dow),
        format: splitOut(acc.fmt),
        city: splitOut(acc.city),
      },
    });
  } catch {
    return res.status(500).json({ error: 'Internal server error' });
  }
}

// GET /teams/:id/insights  (PREMIUM + team member)
export async function getTeamInsights(req: Request, res: Response) {
  const userId = req.userId;
  if (!userId) return res.status(401).json({ error: 'Unauthorized' });
  const teamId = req.params.id;
  if (!teamId || !UUID_RE.test(teamId)) return res.status(400).json({ error: 'Invalid team id' });

  const { data: me } = await supabase
    .from('users').select('is_premium, premium_expires_at').eq('id', userId).maybeSingle();
  if (!isPremiumActive(me)) {
    return res.status(403).json({ error: 'Premium required for team insights', code: 'PREMIUM_REQUIRED' });
  }
  // "Your team's" analytics — members only.
  const role = await getTeamRole(teamId, userId);
  if (!role) return res.status(403).json({ error: 'Only team members can view team insights', code: 'NOT_A_MEMBER' });

  try {
    const { data: team } = await supabase
      .from('teams').select('id, name, sport_id').eq('id', teamId).maybeSingle();
    if (!team) return res.status(404).json({ error: 'Team not found' });

    // Completed matches this team played (as side A or B).
    const { data: matchRows } = await supabase
      .from('matches')
      .select('id, winner_team_id, scheduled_at')
      .or(`team_a_id.eq.${teamId},team_b_id.eq.${teamId}`)
      .eq('status', 'completed')
      .order('scheduled_at', { ascending: false });
    const matches = matchRows ?? [];

    let w = 0, l = 0, d = 0;
    const form: Result[] = [];
    for (const m of matches) {
      const r: Result = m.winner_team_id == null ? 'D' : (m.winner_team_id === teamId ? 'W' : 'L');
      if (r === 'W') w++; else if (r === 'L') l++; else d++;
      form.push(r);
    }
    const recentForm = form.slice(0, 10).reverse(); // oldest-first for display

    // Top scorers / wicket-takers — cricket only (innings_stats). Attribute to
    // THIS team: innings in this team's matches, by CURRENT team members.
    const matchIds = matches.map((m) => m.id as string);
    const { data: members } = await supabase.from('team_members').select('user_id').eq('team_id', teamId);
    const memberIds = new Set((members ?? []).map((x) => x.user_id as string));
    let cricket = false;
    let topScorers: Array<{ userId: string; name: string; runs: number }> = [];
    let topWicketTakers: Array<{ userId: string; name: string; wickets: number }> = [];
    if (matchIds.length && memberIds.size) {
      const { data: innings } = await supabase
        .from('innings_stats').select('user_id, runs, bowling_wickets').in('match_id', matchIds);
      if (innings && innings.length) {
        cricket = true;
        const runsBy = new Map<string, number>();
        const wktsBy = new Map<string, number>();
        for (const i of innings) {
          const uid = i.user_id as string;
          if (!memberIds.has(uid)) continue;
          runsBy.set(uid, (runsBy.get(uid) ?? 0) + (Number(i.runs) || 0));
          wktsBy.set(uid, (wktsBy.get(uid) ?? 0) + (Number(i.bowling_wickets) || 0));
        }
        const uids = Array.from(new Set([...runsBy.keys(), ...wktsBy.keys()]));
        const nameMap = new Map<string, string>();
        if (uids.length) {
          const { data: us } = await supabase.from('users').select('id, name, username').in('id', uids);
          for (const u of us ?? []) nameMap.set(u.id as string, (u.name as string) || (u.username as string) || 'Player');
        }
        topScorers = Array.from(runsBy.entries())
          .filter(([, r]) => r > 0)
          .map(([uid, runs]) => ({ userId: uid, name: nameMap.get(uid) || 'Player', runs }))
          .sort((a, b) => b.runs - a.runs).slice(0, 5);
        topWicketTakers = Array.from(wktsBy.entries())
          .filter(([, wk]) => wk > 0)
          .map(([uid, wickets]) => ({ userId: uid, name: nameMap.get(uid) || 'Player', wickets }))
          .sort((a, b) => b.wickets - a.wickets).slice(0, 5);
      }
    }

    return res.json({
      team: { id: team.id, name: team.name },
      played: matches.length,
      record: { wins: w, losses: l, draws: d, winRate: matches.length ? Math.round((w / matches.length) * 100) : 0 },
      recentForm,
      cricket,
      topScorers,
      topWicketTakers,
    });
  } catch {
    return res.status(500).json({ error: 'Internal server error' });
  }
}
