/**
 * Cricket gap 1 (5 Oct 2026) · a tournament's cricket rules, beyond overs.
 * Tennis-ball and box cricket play without LBW: a rules switch, off by default
 * (older matches play LBW as before), refused by the server in a no-LBW match,
 * copied onto every fixture by the draw like the other stage rules. The match
 * page learns whether the viewer may change the fixture (`can_manage`).
 */
jest.mock('../utils/supabase', () => ({ supabase: { from: jest.fn(() => { throw new Error('no db in this test'); }) } }));

import fs from 'fs';
import path from 'path';
import { validateScoringEvent } from '../controllers/scoring.controller';
import { rulesRefusal, rulesOf, stageRules, standardRules, tournamentRulesRefusal } from '../utils/matchRules';

test('No LBW: off by default and for older matches; on or off only', () => {
  expect(standardRules('cricket').noLbw).toBe(false);
  expect(rulesOf('cricket', { format: 'T20', overs: 20 }).noLbw).toBe(false);
  expect(rulesRefusal('cricket', { ...standardRules('cricket'), noLbw: true })).toBeNull();
  expect(rulesRefusal('cricket', { ...standardRules('cricket'), noLbw: 'yes' })).toMatchObject({ field: 'noLbw', error: 'No LBW is on or off.' });
  expect(rulesRefusal('badminton', { ...standardRules('badminton'), noLbw: true })?.field).toBe('noLbw');
});

test('a tournament’s rules: box, 6 a side, no LBW for every match; each stage its own overs and bowler limit', () => {
  const wide = { v: 1, style: 'box', players: 6, noLbw: true, freeHit: true, extraRuns: 2 };
  const rules = { default: wide, group: { ...wide, overs: 5, bowlerOvers: 1 }, knockout: { ...wide, overs: 6, bowlerOvers: 2, powerplayOvers: 2 } };
  expect(tournamentRulesRefusal('cricket', rules)).toBeNull();
  expect(stageRules('cricket', rules, 'group')).toMatchObject({ style: 'box', players: 6, noLbw: true, overs: 5, bowlerOvers: 1, freeHit: true, extraRuns: 2 });
  expect(stageRules('cricket', rules, 'final')).toMatchObject({ noLbw: true, overs: 6, bowlerOvers: 2, powerplayOvers: 2 });
  // 6 players bowling 1 over each can't bowl a 10-over group innings.
  expect(tournamentRulesRefusal('cricket', { group: { ...wide, overs: 10, bowlerOvers: 1 } })?.error)
    .toBe('Group / league matches: 6 players bowling 1 over each can’t bowl 10 overs. Raise the max overs per bowler.');
});

describe('the server refuses an LBW in a match played without LBW', () => {
  const match = (noLbw: boolean) => ({ id: 'm1', status: 'live', tournament_id: null, team_a_id: null, team_b_id: null, rules: { ...standardRules('cricket'), overs: 6, noLbw } });
  const lbw = (wicket_type: string) => ({ event_type: 'wicket', payload: { team_side: 'A', batsman_id: 'bt', bowler_id: 'bw', wicket_type } });
  test('lbw → 400 NO_LBW, whatever the spelling an app sends', async () => {
    for (const k of ['lbw', 'LBW', 'l_b_w']) {
      expect(await validateScoringEvent('m1', match(true), lbw(k))).toEqual({ status: 400, body: { error: 'This match is played without LBW — it isn’t a way out here.', code: 'NO_LBW' } });
    }
  });
  test('other wickets go through; LBW goes through when the match plays it', async () => {
    expect(await validateScoringEvent('m1', match(true), lbw('bowled'))).toBeNull();
    expect(await validateScoringEvent('m1', match(false), lbw('lbw'))).toBeNull();
    expect(await validateScoringEvent('m1', { ...match(false), rules: null, format: 'T20', overs: 20 } as never, lbw('lbw'))).toBeNull();
  });
});

test('the match page says whether the viewer may change the fixture (its rules, gap 3’s officials)', () => {
  const src = fs.readFileSync(path.join(__dirname, '..', 'controllers', 'matches.controller.ts'), 'utf8');
  expect(src).toMatch(/matchWithRating\.can_manage = canManage;/);
  // updateMatch's own test: a tournament fixture → its organisers; casual → creator or umpire.
  expect(src).toMatch(/isTournamentOrganiser\(match\.tournament_id, userId\)\.catch\(\(\) => false\)\s*: Promise\.resolve\(!!userId && \(match\.created_by === userId \|\| match\.umpire_id === userId\)\)/);
});
