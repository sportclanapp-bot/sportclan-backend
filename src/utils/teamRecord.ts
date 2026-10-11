import { allRows } from './selectAll';
import { supabase } from './supabase';

// SC-293: ONE canonical team W/L/D record, computed from completed matches via
// winner_team_id (team matches always have it backfilled — SC-285 audit). Used
// by BOTH getTeam (free header record — a team's W/L is basic info) AND
// getTeamInsights (premium depth adds recent form + top scorers on top). Sharing
// one function keeps the two surfaces from drifting (the SC-285/286 lesson: one
// rule, writer and readers can't disagree). A team's win is decided by
// winner_team_id — no fabrication for a team with no matches (returns zeros).
export interface TeamRecord {
  played: number;
  wins: number;
  losses: number;
  draws: number;
  win_rate: number; // percent, 0..100
}

export async function computeTeamRecord(teamId: string): Promise<TeamRecord> {
  // Oct 2026: every match (an unpaged read stopped at 1000).
  const rows = await allRows(() => supabase
    .from('matches')
    .select('winner_team_id, status, team_a_id, team_b_id')
    .or(`team_a_id.eq.${teamId},team_b_id.eq.${teamId}`)
    // Audit #70: a walkover counts the same however it came — completed, or
    // abandoned with a winner (a withdrawal or a no-show).
    .in('status', ['completed', 'abandoned'])
    // SC-424: a voided match counts nowhere — not in a team’s record either.
    .is('voided_at', null));
  // Audit #70: a Swiss bye (no opponent) isn't a match, and an abandoned match
  // with no winner is a no-result — neither is in the record.
  const matches = ((rows ?? []) as Array<{ winner_team_id: string | null; status: string; team_a_id: string | null; team_b_id: string | null }>)
    .filter((m) => m.team_a_id && m.team_b_id && (m.status === 'completed' || m.winner_team_id));
  let wins = 0;
  let losses = 0;
  let draws = 0;
  for (const m of matches) {
    if (m.winner_team_id == null) draws++;
    else if (m.winner_team_id === teamId) wins++;
    else losses++;
  }
  const played = matches.length;
  return { played, wins, losses, draws, win_rate: played ? Math.round((wins / played) * 100) : 0 };
}
