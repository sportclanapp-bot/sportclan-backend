/**
 * N-R7-231 (Step 2 B10, found by B5b): the beach has no positional faults (FIVB Beach 7.4) —
 * its fault is a service order fault (7.7). The app now sends fault: 'service_order' on the
 * beach; the timeline line names it so. Indoors stays 'Positional fault'.
 */
import { sportCommentary } from '../utils/commentary';

const ctx = { sport: 'volleyball', teamA: 'Kings', teamB: 'Hawks', period: 1 } as never;
const say = (p: Record<string, unknown>) => sportCommentary('score', p, ctx);

describe('N-R7-231 · the beach fault line', () => {
  it('a service order fault on the beach', () => {
    expect(say({ team_side: 'B', kind: 'fault', fault: 'service_order', by: 'A', value: 1 })).toBe('🔢 Service order fault by Kings — point to Hawks');
  });
  it('indoors: a positional fault, as before', () => {
    expect(say({ team_side: 'B', kind: 'fault', fault: 'positional', by: 'A', value: 1 })).toBe('🔢 Positional fault by Kings — point to Hawks');
  });
});
