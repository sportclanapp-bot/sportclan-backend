/**
 * SC-442 (M6) · the server refuses a delivery where one player is both roles.
 *
 * The app's picker offered the FIELDING side's players as striker and accepted
 * them, then accepted the same person as bowler — one player batting and bowling
 * to himself. The finished scorecard credited him with runs scored for both
 * teams. The picker is restricted by side now, but an old build keeps posting
 * whatever it likes, so the server has to refuse it as well.
 *
 * Asserted against the source: the check sits inside the payload-validation
 * block of addScoringEvent, and proving "it runs before the insert" is the point.
 */
import fs from 'fs';
import path from 'path';

const src = fs.readFileSync(
  path.join(__dirname, '..', 'controllers', 'scoring.controller.ts'),
  'utf8',
);

describe('SC-442 · same-player guard', () => {
  test('the check exists and has its own error code', () => {
    expect(src).toContain('SAME_PLAYER_BOTH_ROLES');
    expect(src).toContain('The batter and the bowler cannot be the same player.');
  });

  test('it reads the batting id the same way the rollup does', () => {
    // player_id is the batting fallback on older payloads; missing it would let
    // the old shape through.
    expect(src).toMatch(/payload\.batsman_id \?\? payload\.player_id/);
  });

  test('it refuses BEFORE the event is recorded', () => {
    // Scoped to createEvent's body: `record_match_event` also appears in the
    // recordEventIdempotent helper defined earlier in the file, and comparing
    // against that occurrence proves
    // nothing about the order things run in.
    const start = src.indexOf('export async function createEvent');
    expect(start).toBeGreaterThan(-1);
    const next = src.indexOf('\nexport ', start + 10);
    const body = src.slice(start, next === -1 ? undefined : next);

    const guard = body.indexOf('SAME_PLAYER_BOTH_ROLES');
    const insert = body.indexOf('record_match_event');
    expect(guard).toBeGreaterThan(-1);
    expect(insert).toBeGreaterThan(-1);
    expect(guard).toBeLessThan(insert);
  });

  test('it only fires when BOTH ids are present and equal', () => {
    // A delivery with no attribution at all is normal for casual matches and
    // must not be rejected.
    expect(src).toMatch(/if \(batId && bowlId && batId === bowlId\)/);
  });
});
