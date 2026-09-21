/**
 * SC-433 · does the recorded result agree with the play?
 *
 * The offline hub can carry "A won 21-19" signed by a scorer while that same
 * scorer's phone is still holding the ball-by-ball. The two arrive separately and
 * can disagree. A tournament result that quietly flipped is far worse than one
 * that stopped and asked, so the rule this file pins is: detect, record, change
 * nothing.
 *
 * The two ways to get this wrong are both represented below — crying wolf on an
 * ordinary half-played match, and staying silent when the two really do disagree.
 */
import { sideFromSummary, sideOfTeam, checkResultAgainstPlay } from '../utils/resultCheck';

const isTerminal = (s?: string | null) => s === 'completed' || s === 'abandoned' || s === 'cancelled';
const A = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const B = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';

describe('SC-433 · which side the play says is ahead', () => {
  it('reads the one field every sport agrees on', () => {
    expect(sideFromSummary({ A: { score: 21 }, B: { score: 19 } })).toBe('A');
    expect(sideFromSummary({ A: { score: 1 }, B: { score: 2 } })).toBe('B');
  });

  it('level is a draw', () => {
    expect(sideFromSummary({ A: { score: 2 }, B: { score: 2 } })).toBe('draw');
  });

  it('numbers that arrived as strings still count', () => {
    // score_summary is jsonb written by several paths over several years.
    expect(sideFromSummary({ A: { score: '3' }, B: { score: '1' } })).toBe('A');
  });

  it('"no opinion" is not a draw — the distinction the whole check rests on', () => {
    // A match with no events has nothing to disagree with. Reading that as a
    // draw would raise an argument against every completed fixture whose scorer
    // never used the app.
    expect(sideFromSummary(null)).toBeNull();
    expect(sideFromSummary({})).toBeNull();
    expect(sideFromSummary({ A: {}, B: {} })).toBeNull();
    expect(sideFromSummary({ A: { score: 'abc' }, B: { score: 1 } })).toBeNull();
  });
});

describe('SC-433 · which side a winning team is', () => {
  const match = { team_a_id: A, team_b_id: B };
  it('maps a team id to its side', () => {
    expect(sideOfTeam(match, A)).toBe('A');
    expect(sideOfTeam(match, B)).toBe('B');
  });
  it('no winner is a draw', () => {
    expect(sideOfTeam(match, null)).toBe('draw');
  });
  it('a winner that is neither side is not an ARGUMENT, it is a broken record', () => {
    // Reporting "the events disagree" here would tell the wrong story entirely.
    expect(sideOfTeam(match, 'cccccccc-cccc-4ccc-8ccc-cccccccccccc')).toBeNull();
  });
  it('a free-text fixture has no team ids to map', () => {
    expect(sideOfTeam({ team_a_id: null, team_b_id: null }, A)).toBeNull();
  });
});

describe('SC-433 · raising the argument', () => {
  const base = {
    matchStatus: 'completed',
    isTerminal,
    teamAId: A,
    teamBId: B,
    hasRecordedResult: true,
    eventCount: 12,
  };

  it('agreement is silence', () => {
    const v = checkResultAgainstPlay({ ...base, recordedWinnerTeamId: A, derivedSummary: { A: { score: 21 }, B: { score: 19 } } });
    expect(v.disagrees).toBe(false);
  });

  it('a real disagreement is raised', () => {
    const v = checkResultAgainstPlay({ ...base, recordedWinnerTeamId: A, derivedSummary: { A: { score: 19 }, B: { score: 21 } } });
    expect(v).toEqual(expect.objectContaining({ disagrees: true, recordedSide: 'A', derivedSide: 'B' }));
  });

  it('a recorded DRAW against a decisive scoreline disagrees', () => {
    const v = checkResultAgainstPlay({ ...base, recordedWinnerTeamId: null, derivedSummary: { A: { score: 21 }, B: { score: 19 } } });
    expect(v.disagrees).toBe(true);
    expect(v.recordedSide).toBe('draw');
  });

  it('a half-played match NEVER raises one — the comeback case', () => {
    // B leads 11-5 at the interval and A wins. Firing here would cry wolf on
    // every comeback and teach organisers to ignore the warning.
    const v = checkResultAgainstPlay({
      ...base, matchStatus: 'live', recordedWinnerTeamId: A,
      derivedSummary: { A: { score: 5 }, B: { score: 11 } },
    });
    expect(v).toEqual(expect.objectContaining({ disagrees: false, skipped: 'not_final' }));
  });

  it('a match with no events has nothing to disagree with', () => {
    const v = checkResultAgainstPlay({ ...base, eventCount: 0, recordedWinnerTeamId: A, derivedSummary: null });
    expect(v).toEqual(expect.objectContaining({ disagrees: false, skipped: 'no_events' }));
  });

  it('events with no usable summary are silence, not a disagreement', () => {
    const v = checkResultAgainstPlay({ ...base, recordedWinnerTeamId: A, derivedSummary: { A: {}, B: {} } });
    expect(v.disagrees).toBe(false);
  });

  it('a match with no recorded result yet is not an argument', () => {
    const v = checkResultAgainstPlay({
      ...base, hasRecordedResult: false, recordedWinnerTeamId: null,
      derivedSummary: { A: { score: 21 }, B: { score: 19 } },
    });
    expect(v).toEqual(expect.objectContaining({ disagrees: false, skipped: 'unknown_winner' }));
  });

  it('a free-text fixture is skipped, not silently called wrong', () => {
    const v = checkResultAgainstPlay({
      ...base, teamAId: null, teamBId: null, recordedWinnerTeamId: A,
      derivedSummary: { A: { score: 19 }, B: { score: 21 } },
    });
    expect(v).toEqual(expect.objectContaining({ disagrees: false, skipped: 'free_text' }));
  });

  it('an abandoned match is final, so it is checked like any other', () => {
    const v = checkResultAgainstPlay({
      ...base, matchStatus: 'abandoned', recordedWinnerTeamId: B,
      derivedSummary: { A: { score: 21 }, B: { score: 12 } },
    });
    expect(v.disagrees).toBe(true);
  });
});

/**
 * SC-433 · the check that happens BEFORE the result is written.
 *
 * The difference from the block above is the whole point. That one looks at a
 * match that already has a result; this one looks at a result about to be written
 * over events that are already here. Completing first and flagging afterwards
 * would leave the match recording an outcome its own ball-by-ball contradicts —
 * "never silently overwritten" has to mean the write does not happen.
 */
import { resultWouldContradictPlay } from '../utils/resultCheck';

describe('SC-433 · refusing a result that contradicts the play', () => {
  const base = { teamAId: A, teamBId: B, eventCount: 30 };

  it('a result agreeing with the events is written', () => {
    expect(resultWouldContradictPlay({
      ...base, claimedWinnerTeamId: A, currentSummary: { A: { score: 21 }, B: { score: 15 } },
    }).disagrees).toBe(false);
  });

  it('a result contradicting the events is refused', () => {
    const v = resultWouldContradictPlay({
      ...base, claimedWinnerTeamId: A, currentSummary: { A: { score: 15 }, B: { score: 21 } },
    });
    expect(v).toEqual(expect.objectContaining({ disagrees: true, recordedSide: 'A', derivedSide: 'B' }));
  });

  it('STATUS is not consulted — a result op is the thing that ends a match', () => {
    // Waiting for the match to be final before checking would mean never
    // checking at all: it is this very op that makes it final.
    const v = resultWouldContradictPlay({
      ...base, claimedWinnerTeamId: B, currentSummary: { A: { score: 21 }, B: { score: 9 } },
    });
    expect(v.disagrees).toBe(true);
  });

  it('a match with no events has nothing to contradict', () => {
    // The ordinary case for a zero-signal ground: the result arrives first and
    // the ball-by-ball is still on the scorer's phone.
    expect(resultWouldContradictPlay({
      ...base, eventCount: 0, claimedWinnerTeamId: A, currentSummary: null,
    })).toEqual(expect.objectContaining({ disagrees: false, skipped: 'no_events' }));
  });

  it('events with no usable score are silence, not an accusation', () => {
    expect(resultWouldContradictPlay({
      ...base, claimedWinnerTeamId: A, currentSummary: { A: {}, B: {} },
    }).disagrees).toBe(false);
  });

  it('a claimed DRAW against a decisive scoreline is refused', () => {
    expect(resultWouldContradictPlay({
      ...base, claimedWinnerTeamId: null, currentSummary: { A: { score: 21 }, B: { score: 15 } },
    }).disagrees).toBe(true);
  });

  it('a free-text fixture is skipped rather than called wrong', () => {
    expect(resultWouldContradictPlay({
      ...base, teamAId: null, teamBId: null, claimedWinnerTeamId: A,
      currentSummary: { A: { score: 15 }, B: { score: 21 } },
    })).toEqual(expect.objectContaining({ disagrees: false, skipped: 'free_text' }));
  });
});
