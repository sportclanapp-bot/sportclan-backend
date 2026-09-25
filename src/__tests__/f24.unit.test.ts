/**
 * F-24 (MATCH_CREATE_TEST_PLAN): a refused scoring event must not start the
 * match. Session 2 confirmed it live: a chess result refused with
 * BAD_CHESS_REASON / RESULT_PLAYER_WRONG_SIDE still flipped the match to live.
 * And a match is never 'upcoming' — that is a tournament status.
 */
import fs from 'fs';
import path from 'path';

const read = (f: string) => fs.readFileSync(path.join(__dirname, '..', f), 'utf8');
const scoring = read('controllers/scoring.controller.ts');
const start = scoring.indexOf('export async function createEvent');
const body = scoring.slice(start, scoring.indexOf('\nexport ', start + 10));

describe('F-24 · createEvent promotes to live only after every refusal', () => {
  const live = body.indexOf("update({ status: 'live' })");
  test.each([
    "code: 'BAD_CHESS_REASON'",
    "code: 'RESULT_PLAYER_WRONG_SIDE'",
    "code: 'SAME_PLAYER_BOTH_ROLES'",
    'Ranked matches require registered players, not guests.',
    "code: 'OPPONENT_NOT_ACCEPTED'",
    'must be an integer between',
  ])('the live flip comes after %s', (refusal) => {
    const at = body.indexOf(refusal);
    expect(at).toBeGreaterThan(0);
    expect(live).toBeGreaterThan(at);
  });
  test('and before the event is recorded', () => {
    expect(live).toBeLessThan(body.indexOf('recordEventIdempotent({'));
  });
});

describe("F-24 · no match code path reads a status of 'upcoming'", () => {
  test.each([
    'controllers/scoring.controller.ts',
    'controllers/matches.controller.ts',
    'controllers/features.controller.ts',
    'utils/matchVoid.ts',
  ])('%s', (f) => {
    const code = read(f).split('\n').filter((l) => !/^\s*(\/\/|\*)/.test(l)).join('\n');
    // Tournament statuses are allowed to say 'upcoming'; match ones are not.
    const matchUses = code.split('\n').filter((l) => l.includes("'upcoming'") && !/tournament/i.test(l));
    expect(matchUses).toEqual([]);
  });
});
