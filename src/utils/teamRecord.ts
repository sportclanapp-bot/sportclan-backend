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
  const { data: matches } = await supabase
    .from('matches')
    .select('winner_team_id')
    .or(`team_a_id.eq.${teamId},team_b_id.eq.${teamId}`)
    .eq('status', 'completed');
  let wins = 0;
  let losses = 0;
  let draws = 0;
  for (const m of matches ?? []) {
    if (m.winner_team_id == null) draws++;
    else if (m.winner_team_id === teamId) wins++;
    else losses++;
  }
  const played = (matches ?? []).length;
  return { played, wins, losses, draws, win_rate: played ? Math.round((wins / played) * 100) : 0 };
}
