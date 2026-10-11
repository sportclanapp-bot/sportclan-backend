/** Audit #64 (11 Oct 2026, Dipak): a ladder with no reach set has no limit (it was capped at 3 places). */
import { challengeProblem, reachOf } from '../utils/ladderBox';

const order = ['p1', 'p2', 'p3', 'p4', 'p5', 'p6', 'p7'];
describe('audit #64', () => {
  it('no reach set: the bottom player can challenge the top', () => {
    expect(reachOf(undefined)).toBeNull();
    expect(reachOf({ move: 'swap' })).toBeNull();
    expect(challengeProblem(order, 'p7', 'p1', { move: 'leapfrog' })).toBeNull();
    expect(challengeProblem(order, 'p7', 'p1', null)).toBeNull();
  });
  it('a reach the organiser set still holds', () => {
    expect(challengeProblem(order, 'p7', 'p1', { reach: 3 })).not.toBeNull();
    expect(challengeProblem(order, 'p7', 'p4', { reach: 3 })).toBeNull();
  });
});
