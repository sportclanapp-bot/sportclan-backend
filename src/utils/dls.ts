// Simplified Duckworth-Lewis-Stern method.
//
// The full DLS uses a proprietary resource table that ICC licenses. This
// implementation uses the commonly-published approximation formula:
//
//   Resources remaining = 100 × (1 - b^(overs_remaining)) × wickets_factor
//
// where b ≈ 0.04 per over and wickets_factor scales linearly.
// Accurate enough for community cricket; not ICC-certified.

const WICKET_FACTORS = [1.0, 0.95, 0.88, 0.80, 0.70, 0.59, 0.47, 0.35, 0.24, 0.14, 0.05];
// Index = wickets lost (0-10)

function resourcesRemaining(oversLeft: number, wicketsLost: number): number {
  const wf = WICKET_FACTORS[Math.min(wicketsLost, 10)] ?? 0;
  const overFraction = 1 - Math.pow(0.96, oversLeft);
  return 100 * overFraction * wf;
}

export interface DLSResult {
  revisedTarget: number;
  resourcesTeam1: number;
  resourcesTeam2: number;
  method: 'DLS';
}

/**
 * Calculate the DLS revised target for the team batting second.
 *
 * @param team1Score      - First innings total (runs scored by Team 1)
 * @param totalOvers      - Total overs allocated per side before interruption
 * @param team2OversLeft  - Overs remaining for Team 2 after the interruption
 * @param team2Wickets    - Wickets lost by Team 2 at the point of interruption
 */
export function calculateDLSTarget(
  team1Score: number,
  totalOvers: number,
  team2OversLeft: number,
  team2Wickets: number,
): DLSResult {
  const r1 = resourcesRemaining(totalOvers, 0); // Team 1 had full resources
  const r2 = resourcesRemaining(team2OversLeft, team2Wickets);

  // Guard against zero/negative Team-1 resources (e.g. totalOvers=0) — the
  // ratio would be NaN/Infinity and revisedTarget would come back NaN (A5-013).
  // With no resources to scale against, fall back to "no reduction".
  if (r1 <= 0) {
    return {
      revisedTarget: team1Score + 1,
      resourcesTeam1: 0,
      resourcesTeam2: Math.round(r2 * 100) / 100,
      method: 'DLS',
    };
  }

  // DLS formula: if R2 < R1 → target reduced proportionally
  const ratio = r2 / r1;
  const revisedTarget = Math.ceil(team1Score * ratio) + 1; // +1 because target = score to beat

  return {
    revisedTarget,
    resourcesTeam1: Math.round(r1 * 100) / 100,
    resourcesTeam2: Math.round(r2 * 100) / 100,
    method: 'DLS',
  };
}
