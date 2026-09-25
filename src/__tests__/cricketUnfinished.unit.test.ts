import { cricketStage, unfinishedEnds, awardAllowed } from '../utils/cricketRules';
/**
 * Decisions 2026-09-26 (MATCH_CREATE_TEST_5) · ending a cricket match that is not
 * over. The rule lives in cricketRules.ts (byte-identical in both repos); this
 * fixture table is identical in both too (only the import path differs).
 * K3: XII 17/2 (all out, 3 in the line-up), XI 1/0 after 1 ball of 24 — End
 * gave "XII won by 16 runs"; now the scorer must pick how it ends.
 */
const inn = (runs: number, wickets: number, balls: number, declared?: boolean) => ({ runs, wickets, balls, declared });

describe('cricketStage', () => {
  const base = { overs: 4, firstAllOut: 2, chaseAllOut: 10 };
  test('K3 at the End: a chase under way', () => {
    expect(cricketStage({ ...base, first: inn(17, 2, 9), chase: inn(1, 0, 1) })).toBe('chase');
  });
  test('first innings still going: by balls, wickets and declaration', () => {
    expect(cricketStage({ ...base, first: inn(10, 1, 12), chase: inn(0, 0, 0) })).toBe('first_innings');
    expect(cricketStage({ ...base, first: inn(10, 0, 3, true), chase: inn(0, 0, 0) })).toBe('chase');
    expect(cricketStage({ ...base, first: inn(30, 0, 24), chase: inn(0, 0, 0) })).toBe('chase');
  });
  test('a chase is over when the target is reached, all out, or out of overs', () => {
    expect(cricketStage({ ...base, first: inn(17, 2, 9), chase: inn(18, 0, 5) })).toBe('over');
    expect(cricketStage({ ...base, first: inn(17, 2, 9), chase: inn(5, 10, 20) })).toBe('over');
    expect(cricketStage({ ...base, first: inn(17, 2, 9), chase: inn(17, 0, 24) })).toBe('over');
  });
  test('a DLS target moves the finishing line', () => {
    expect(cricketStage({ ...base, overs: 20, first: inn(21, 10, 16), chase: inn(8, 0, 6), dlsTarget: 8 })).toBe('over');
    expect(cricketStage({ ...base, overs: 20, first: inn(21, 10, 16), chase: inn(7, 0, 6), dlsTarget: 8 })).toBe('chase');
  });
});

describe('unfinishedEnds and awardAllowed', () => {
  test('the choices per stage', () => {
    expect(unfinishedEnds('chase')).toEqual(['award', 'dls', 'no_result']);
    expect(unfinishedEnds('first_innings')).toEqual(['award', 'no_result']);
    expect(unfinishedEnds('over')).toEqual([]);
  });
  test('in a chase only the defending side can be awarded it', () => {
    expect(awardAllowed('chase', 'B', 'B')).toBe(true);
    expect(awardAllowed('chase', 'A', 'B')).toBe(false);
  });
  test('in the first innings either side can (a concession); never nobody', () => {
    expect(awardAllowed('first_innings', 'A', 'B')).toBe(true);
    expect(awardAllowed('first_innings', 'B', 'B')).toBe(true);
    expect(awardAllowed('first_innings', null, 'B')).toBe(false);
    expect(awardAllowed('over', 'A', 'A')).toBe(false);
  });
});
