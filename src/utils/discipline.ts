/**
 * Stage 8 · F5 (Oct 2026) · bans from cards across a tournament (football,
 * hockey), worked out from the card events — nothing to keep in step by hand.
 *
 *   - Every `yellowsForBan` yellows (in separate matches' bookings) = a ban of
 *     `banMatches` matches. A second yellow in one match is a sending-off: that
 *     match's yellows don't count towards the total, the red's ban applies.
 *   - A red (straight, or the second yellow) = a ban of `redBanMatches`.
 *   - `resetAfterGroups`: yellows are wiped when the knockout starts.
 *   - A ban covers the team's next N fixtures after the match it came in, in
 *     fixture order (played or not yet), so "banned for the next match" is
 *     always a real fixture.
 * Defaults (when the organiser turns bans on): 2 yellows → 1 match; a red → 1.
 */
import type { DisciplineRules } from './tournamentSettings';

export type DMatch = { id: string; team_a_id: string | null; team_b_id: string | null; knockout: boolean; played: boolean };
export type DCard = { match_id: string; payload: { team_side?: unknown; kind?: unknown; player_id?: unknown; player_name?: unknown; second_yellow?: unknown } | null };
export type Ban = { matchId: string; reason: string; length: number; covers: string[] };
export type PlayerRecord = { key: string; user_id: string | null; name: string; team_id: string; yellows: number; reds: number; bans: Ban[] };

export function disciplineRules(d: DisciplineRules | null | undefined): Required<Omit<DisciplineRules, 'yellowsForBan'>> & { yellowsForBan: number | null } {
  return { yellowsForBan: d?.yellowsForBan === undefined ? 2 : d.yellowsForBan, banMatches: d?.banMatches ?? 1, redBanMatches: d?.redBanMatches ?? 1, resetAfterGroups: d?.resetAfterGroups ?? false };
}

/** Every carded player's record and bans. `matches` in fixture order (the order bans are served in). */
export function disciplineRecords(rulesIn: DisciplineRules | null | undefined, matches: DMatch[], cards: DCard[]): PlayerRecord[] {
  const rules = disciplineRules(rulesIn);
  const byMatch = new Map<string, DCard[]>();
  for (const c of cards) (byMatch.get(c.match_id) ?? byMatch.set(c.match_id, []).get(c.match_id)!).push(c);
  const teamFixtures = new Map<string, string[]>(); // team → its fixture ids in order
  for (const m of matches) for (const t of [m.team_a_id, m.team_b_id]) if (t) (teamFixtures.get(t) ?? teamFixtures.set(t, []).get(t)!).push(m.id);
  const recs = new Map<string, PlayerRecord & { tally: number }>();
  let knockoutStarted = false;
  for (const m of matches) {
    if (m.knockout && !knockoutStarted) { knockoutStarted = true; if (rules.resetAfterGroups) for (const r of recs.values()) r.tally = 0; }
    if (!m.played) continue;
    // this match's cards, per player
    const per = new Map<string, { team: string; name: string; user: string | null; y: number; red: boolean; second: boolean }>();
    for (const c of byMatch.get(m.id) ?? []) {
      const p = c.payload ?? {};
      const team = p.team_side === 'B' ? m.team_b_id : m.team_a_id;
      if (!team) continue;
      const user = typeof p.player_id === 'string' && p.player_id && !p.player_id.startsWith('guest:') ? p.player_id : null;
      const name = typeof p.player_name === 'string' ? p.player_name.trim() : '';
      if (!user && !name) continue; // a card with no player named can't ban anyone
      const key = user ?? `n:${team}:${name.toLowerCase()}`;
      const e = per.get(key) ?? { team, name, user, y: 0, red: false, second: false };
      if (p.kind === 'yellow') e.y += 1;
      else if (p.kind === 'red') { e.red = true; if (p.second_yellow) e.second = true; }
      if (!e.name && name) e.name = name;
      per.set(key, e);
    }
    for (const [key, e] of per) {
      const r = recs.get(key) ?? { key, user_id: e.user, name: e.name || 'Player', team_id: e.team, yellows: 0, reds: 0, bans: [], tally: 0 };
      if (!r.name && e.name) r.name = e.name;
      const fixtures = teamFixtures.get(e.team) ?? [];
      const at = fixtures.indexOf(m.id);
      const ban = (length: number, reason: string) => { if (length > 0) r.bans.push({ matchId: m.id, reason, length, covers: fixtures.slice(at + 1, at + 1 + length) }); };
      if (e.red) {
        r.reds += 1;
        if (e.second) r.yellows += 2; else r.yellows += e.y; // shown, but a sending-off's yellows don't accumulate
        // A yellow then a straight red in one match: the red's ban only.
        ban(rules.redBanMatches, e.second ? 'sent off (second yellow)' : 'red card');
      } else if (e.y > 0) {
        r.yellows += e.y;
        if (rules.yellowsForBan) {
          r.tally += 1; // one booking per match counts towards the total
          if (r.tally % rules.yellowsForBan === 0) ban(rules.banMatches, `${rules.yellowsForBan} yellow cards`);
        }
      }
      recs.set(key, r);
    }
  }
  return [...recs.values()].map(({ tally: _t, ...r }) => r);
}

/** The players banned from one fixture (by team), with why. */
export function bannedFrom(records: PlayerRecord[], matchId: string): Array<{ team_id: string; user_id: string | null; name: string; reason: string }> {
  const out: Array<{ team_id: string; user_id: string | null; name: string; reason: string }> = [];
  for (const r of records) {
    const b = r.bans.find((x) => x.covers.includes(matchId));
    if (b) out.push({ team_id: r.team_id, user_id: r.user_id, name: r.name, reason: b.reason });
  }
  return out;
}

/** Bans still to serve: the fixtures they cover that aren't played yet. */
export function openBans(records: PlayerRecord[], played: Set<string>): Array<{ team_id: string; user_id: string | null; name: string; reason: string; remaining: string[] }> {
  const out: Array<{ team_id: string; user_id: string | null; name: string; reason: string; remaining: string[] }> = [];
  for (const r of records) for (const b of r.bans) {
    const remaining = b.covers.filter((id) => !played.has(id));
    // a ban whose fixtures don't exist yet (the knockout isn't drawn) is still owed: one of each kind counts
    const owed = b.covers.length < b.length ? b.length - b.covers.length : 0;
    if (remaining.length || owed) out.push({ team_id: r.team_id, user_id: r.user_id, name: r.name, reason: b.reason, remaining });
  }
  return out;
}
