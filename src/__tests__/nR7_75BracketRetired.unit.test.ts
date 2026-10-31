/**
 * N-R7-75 (Step 2 · Batch 5, SPP1-TEN-104 / SP-TEN-F02): the bracket answer carried decided_by for a
 * walkover / default / award but nothing for a retirement, so the app's card couldn't say 'ret.'.
 */
jest.mock('../utils/supabase', () => ({ supabase: {} }));
import { decidedFields } from '../controllers/tournaments.controller';

describe('N-R7-75 · how a bracket match ended', () => {
  test('a retirement is sent as retired; the others keep decided_by', () => {
    expect(decidedFields({ result_type: 'retired', score_summary: {} })).toEqual({ retired: true });
    expect(decidedFields({ result_type: 'default', score_summary: {} })).toEqual({ decided_by: 'default' });
    expect(decidedFields({ result_type: 'walkover', score_summary: {} })).toEqual({ decided_by: 'walkover' });
    expect(decidedFields({ result_type: 'decisive', score_summary: {} })).toEqual({});
  });
});
