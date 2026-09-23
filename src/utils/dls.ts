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

/**
 * F-44 · refuse the impossible instead of answering it.
 *
 * `calculateDLSTarget` has a guard for zero Team-1 resources that returns
 * "no reduction" so the caller never sees a NaN. That is correct arithmetic and
 * a terrible answer: with totalOvers = 0 and a Team-1 score of 0 it returns a
 * revised target of 1, which the app printed as "Revised target: 1" beside a
 * Calculate button, with nothing to say it was nonsense. A scorer in the rain
 * could act on it.
 *
 * So the endpoint validates first. The app validates too — it has to, to put the
 * reason on its own button before the request is made — but a client-side check
 * is a courtesy, not a rule, and this is the rule. Same wording on both sides so
 * a scorer never sees the refusal change shape depending on where it came from.
 *
 * Returns the reason, or null when the numbers describe a real match.
 */
export function dlsInputProblem(input: {
  team1Score: number;
  totalOvers: number;
  team2OversLeft: number;
  team2Wickets: number;
}): string | null {
  const { team1Score, totalOvers, team2OversLeft, team2Wickets } = input;
  if (![team1Score, totalOvers, team2OversLeft, team2Wickets].every((n) => Number.isFinite(n))) {
    return 'Those are not all numbers.';
  }
  if (totalOvers < 1) return 'Total overs must be at least 1 — there is nothing to reduce from.';
  if (team1Score < 0) return "Team 1's score cannot be negative.";
  if (team2Wickets < 0 || team2Wickets > 10) return 'Wickets lost is between 0 and 10.';
  if (team2Wickets === 10) return 'Team 2 is all out — the innings is over, so there is no target to revise.';
  if (team2OversLeft < 0) return 'Overs remaining cannot be negative.';
  if (team2OversLeft > totalOvers) return 'Team 2 cannot have more overs left than the match allows.';
  if (team2OversLeft === 0) return 'No overs remain — there is nothing left to chase in.';
  return null;
}
