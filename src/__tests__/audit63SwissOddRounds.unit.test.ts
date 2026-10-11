/** Audit #63 (11 Oct 2026): an odd field can play as many Swiss rounds as players (one bye a round). */
import { swissRoundsProblem, swissMaxRounds } from '../utils/tournamentSettings';

describe('audit #63', () => {
  it('5 players: 5 rounds allowed, 6 refused; 6 players: 5 allowed, 6 refused', () => {
    expect(swissMaxRounds(5)).toBe(5);
    expect(swissRoundsProblem(5, 5)).toBeNull();
    expect(swissRoundsProblem(6, 5)).toMatch(/at most 5/);
    expect(swissRoundsProblem(5, 6)).toBeNull();
    expect(swissRoundsProblem(6, 6)).toMatch(/at most 5/);
  });
});
