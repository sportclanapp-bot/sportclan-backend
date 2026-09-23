/**
 * F-36 · the rollup finally gets told how the batsman was out.
 *
 * The bowler-credit rule in aggregateCricketPlayers has been correct since it
 * was written: a run-out is nobody's wicket. It was simply never fed — the app
 * sent a bare `{ team_side }` wicket, so the normalised kind was the empty
 * string, which is not 'runout', so every run-out in every match went into a
 * bowler's figures. These tests pin both halves: the kinds now arriving, and
 * the legacy events that will keep arriving from replayed logs forever.
 */
import { aggregateCricketPlayers } from '../controllers/scoring.controller';

const BAT = 'bat-1';
const BOWL = 'bowl-1';
const FIELD = 'field-1';

const wicket = (payload: Record<string, unknown>) => ({
  event_type: 'wicket',
  payload: { team_side: 'A', batsman_id: BAT, bowler_id: BOWL, ...payload },
});

describe('who gets the wicket', () => {
  it('a run-out is credited to nobody', () => {
    const p = aggregateCricketPlayers([wicket({ wicket_type: 'run_out' })]);
    expect(p[BOWL]!.bowl_wickets).toBe(0);
    expect(p[BAT]!.out).toBe(true);
  });

  it('a retirement is credited to nobody', () => {
    const p = aggregateCricketPlayers([wicket({ wicket_type: 'retired_hurt', is_extra: true })]);
    expect(p[BOWL]!.bowl_wickets).toBe(0);
  });

  it('bowled, caught, lbw, stumped and hit wicket are all the bowler’s', () => {
    for (const kind of ['bowled', 'caught', 'lbw', 'stumped', 'hit_wicket']) {
      const p = aggregateCricketPlayers([wicket({ wicket_type: kind })]);
      expect(`${kind}:${p[BOWL]!.bowl_wickets}`).toBe(`${kind}:1`);
    }
  });

  it('a stumping is the bowler’s AND the keeper’s — both, not either', () => {
    const p = aggregateCricketPlayers([
      wicket({ wicket_type: 'stumped', fielder_id: FIELD, fielder_name: 'Dhoni' }),
    ]);
    expect(p[BOWL]!.bowl_wickets).toBe(1);
    expect(p[FIELD]!.stumpings).toBe(1);
  });

  it('an old event with no kind still credits the bowler — the log is not rewritten', () => {
    // Every wicket recorded before F-36 looks like this. Changing how these
    // replay would silently restate finished matches.
    const p = aggregateCricketPlayers([wicket({})]);
    expect(p[BOWL]!.bowl_wickets).toBe(1);
    expect(p[BAT]!.dismissal).toBe('out');
  });
});

describe('fielding credit', () => {
  it('a catch goes to the catcher, on the BOWLING side', () => {
    const p = aggregateCricketPlayers([
      wicket({ wicket_type: 'caught', fielder_id: FIELD, fielder_name: 'Sharma' }),
    ]);
    expect(p[FIELD]!.catches).toBe(1);
    expect(p[FIELD]!.side).toBe('B'); // batting side was A
    expect(p[FIELD]!.name).toBe('Sharma');
  });

  it('a run-out goes to the fielder as a run-out, not a catch', () => {
    const p = aggregateCricketPlayers([
      wicket({ wicket_type: 'run_out', fielder_id: FIELD }),
    ]);
    expect(p[FIELD]!.runouts).toBe(1);
    expect(p[FIELD]!.catches).toBe(0);
    expect(p[FIELD]!.stumpings).toBe(0);
  });

  it('a kind with no fielder credits nobody with anything', () => {
    const p = aggregateCricketPlayers([wicket({ wicket_type: 'bowled' })]);
    expect(p[FIELD]).toBeUndefined();
    expect(p[BOWL]!.catches).toBe(0);
  });

  it('credits accumulate across a match', () => {
    const p = aggregateCricketPlayers([
      wicket({ wicket_type: 'caught', fielder_id: FIELD }),
      wicket({ wicket_type: 'caught', fielder_id: FIELD }),
      wicket({ wicket_type: 'run_out', fielder_id: FIELD }),
    ]);
    expect(p[FIELD]!.catches).toBe(2);
    expect(p[FIELD]!.runouts).toBe(1);
    expect(p[BOWL]!.bowl_wickets).toBe(2); // the run-out is not his
  });

  it('every player line starts its fielding counters at zero, not undefined', () => {
    const p = aggregateCricketPlayers([
      { event_type: 'ball', payload: { team_side: 'A', batsman_id: BAT, bowler_id: BOWL, runs: 4 } },
    ]);
    expect(p[BAT]).toMatchObject({ catches: 0, runouts: 0, stumpings: 0 });
  });
});

describe('the dismissal reads back with its names', () => {
  it('carries the fielder and the bowler onto the batsman’s line', () => {
    const p = aggregateCricketPlayers([
      wicket({ wicket_type: 'caught', fielder_name: 'Sharma', bowler_name: 'Khan', fielder_id: FIELD }),
    ]);
    expect(p[BAT]).toMatchObject({
      dismissal: 'caught', dismissal_fielder: 'Sharma', dismissal_bowler: 'Khan',
    });
  });

  it('leaves them off when they are not known, rather than storing empties', () => {
    const p = aggregateCricketPlayers([wicket({ wicket_type: 'bowled' })]);
    expect(p[BAT]!.dismissal_fielder).toBeUndefined();
    expect(p[BAT]!.dismissal_bowler).toBeUndefined();
  });
});
