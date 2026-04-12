"use strict";
// Simplified Duckworth-Lewis-Stern method.
//
// The full DLS uses a proprietary resource table that ICC licenses. This
// implementation uses the commonly-published approximation formula:
//
//   Resources remaining = 100 × (1 - b^(overs_remaining)) × wickets_factor
//
// where b ≈ 0.04 per over and wickets_factor scales linearly.
// Accurate enough for community cricket; not ICC-certified.
Object.defineProperty(exports, "__esModule", { value: true });
exports.calculateDLSTarget = void 0;
const WICKET_FACTORS = [1.0, 0.95, 0.88, 0.80, 0.70, 0.59, 0.47, 0.35, 0.24, 0.14, 0.05];
// Index = wickets lost (0-10)
function resourcesRemaining(oversLeft, wicketsLost) {
    const wf = WICKET_FACTORS[Math.min(wicketsLost, 10)] ?? 0;
    const overFraction = 1 - Math.pow(0.96, oversLeft);
    return 100 * overFraction * wf;
}
/**
 * Calculate the DLS revised target for the team batting second.
 *
 * @param team1Score      - First innings total (runs scored by Team 1)
 * @param totalOvers      - Total overs allocated per side before interruption
 * @param team2OversLeft  - Overs remaining for Team 2 after the interruption
 * @param team2Wickets    - Wickets lost by Team 2 at the point of interruption
 */
function calculateDLSTarget(team1Score, totalOvers, team2OversLeft, team2Wickets) {
    const r1 = resourcesRemaining(totalOvers, 0); // Team 1 had full resources
    const r2 = resourcesRemaining(team2OversLeft, team2Wickets);
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
exports.calculateDLSTarget = calculateDLSTarget;
//# sourceMappingURL=dls.js.map