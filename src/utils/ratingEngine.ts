/**
 * ELO Rating Engine for SportClan.
 *
 * K-factor: 32 for players with < 10 matches, 16 after.
 * Standard ELO expected-score formula.
 */

function kFactor(matchesPlayed: number): number {
  return matchesPlayed < 10 ? 32 : 16;
}

function expectedScore(ratingA: number, ratingB: number): number {
  return 1 / (1 + Math.pow(10, (ratingB - ratingA) / 400));
}

export interface RatingInput {
  rating: number;
  matchesPlayed: number;
}

export interface RatingResult {
  newRating: number;
  delta: number;
}

/**
 * Calculate new ratings for two players/teams after a match.
 *
 * @param a - Player/team A current stats
 * @param b - Player/team B current stats
 * @param outcome - 1 = A wins, 0 = B wins, 0.5 = draw
 * @returns [resultA, resultB]
 */
export function calculateElo(
  a: RatingInput,
  b: RatingInput,
  outcome: 1 | 0 | 0.5,
): [RatingResult, RatingResult] {
  const expectedA = expectedScore(a.rating, b.rating);
  const expectedB = 1 - expectedA;

  const kA = kFactor(a.matchesPlayed);
  const kB = kFactor(b.matchesPlayed);

  const scoreA = outcome;
  const scoreB = 1 - outcome;

  const deltaA = Math.round((kA * (scoreA - expectedA)) * 100) / 100;
  const deltaB = Math.round((kB * (scoreB - expectedB)) * 100) / 100;

  return [
    { newRating: Math.max(100, a.rating + deltaA), delta: deltaA },
    { newRating: Math.max(100, b.rating + deltaB), delta: deltaB },
  ];
}
