/**
 * The scoring edit log (27 Sep 2026): every edit / delete / undo as a plain
 * line, for every sport's event types; never raw JSON; organisers, scorers,
 * umpires and admins only.
 */
import fs from 'fs';
import path from 'path';
import { describeEvent, scoreText, editLine, cricketBallLabels, LogContext } from '../utils/editLog';
import { KNOWN_EVENT_TYPES } from '../utils/scoringEvents';

const ctx = (sport: string): LogContext => ({ sport, teamA: 'Lions', teamB: 'Tigers' });
const code = (f: string) =>
  fs.readFileSync(path.join(__dirname, '..', f), 'utf8').replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*$/gm, '');

describe('every event type reads in words', () => {
  test.each([
    ['cricket', 'ball', { runs: 1 }, '1 run'],
    ['cricket', 'ball', { runs: 4 }, '4 runs'],
    ['cricket', 'ball', { runs: 0 }, 'dot ball'],
    ['cricket', 'extra', { type: 'Wd', runs: 1 }, 'wide'],
    ['cricket', 'extra', { type: 'Nb', runs: 5 }, 'no-ball + 4'],
    ['cricket', 'extra', { type: 'Lb', runs: 2 }, '2 leg byes'],
    ['cricket', 'wicket', { wicket_type: 'bowled', batsman_name: 'Rohit' }, 'wicket — Rohit (bowled)'],
    ['cricket', 'declaration', { team_side: 'B' }, 'Tigers declared'],
    ['badminton', 'score', { team_side: 'A', kind: 'point', value: 1 }, 'Lions point'],
    ['table_tennis', 'point', { team_side: 'B' }, 'Tigers point'],
    ['tennis', 'score', { team_side: 'A', kind: 'ace' }, 'Lions ace'],
    ['tennis', 'score', { team_side: 'B', kind: 'double_fault' }, 'double fault — Tigers point'],
    ['football', 'score', { team_side: 'A', kind: 'goal', player_name: 'Sunil' }, 'Lions goal (Sunil)'],
    ['football', 'score', { team_side: 'B', kind: 'own_goal' }, 'own goal by Tigers'],
    ['hockey', 'goal', { team_side: 'A' }, 'Lions goal'],
    ['football', 'card', { team_side: 'B', kind: 'yellow', player_name: 'Arjun' }, 'yellow card — Arjun, Tigers'],
    ['football', 'yellow_card', { team_side: 'A' }, 'yellow card — Lions'],
    ['football', 'red_card', { team_side: 'A' }, 'red card — Lions'],
    ['football', 'foul', { team_side: 'A' }, 'Lions foul'],
    ['football', 'assist', { team_side: 'A', player_name: 'Ravi' }, 'assist — Ravi (Lions)'],
    ['basketball', 'score', { team_side: 'A', value: 3 }, 'Lions 3-pointer'],
    ['basketball', 'score', { team_side: 'B', value: 1 }, 'Tigers free throw'],
    ['basketball', 'basket', { team_side: 'A', value: 2 }, 'Lions 2-pointer'],
    ['basketball', 'period_change', {}, 'end of period'],
    ['football', 'period_change', { kind: 'halftime' }, 'half-time'],
    ['carrom', 'score', { team_side: 'A', kind: 'board', value: 3 }, 'Lions +3'],
    ['carrom', 'queen', { team_side: 'B' }, 'Tigers queen'],
    ['chess', 'move', { side: 'B' }, 'Black move'],
    ['chess', 'result', { winner: 'white' }, 'result — White wins'],
    ['chess', 'result', { winner: 'draw' }, 'result — draw'],
    ['volleyball', 'serve_swap', {}, 'serve change'],
    ['tennis', 'note', { kind: 'let' }, 'let'],
    ['football', 'sub', { team_side: 'A' }, 'substitution (Lions)'],
    ['basketball', 'timeout', { team_side: 'B' }, 'Tigers timeout'],
  ])('%s %s %j → "%s"', (sport, type, p, text) => {
    expect(describeEvent(type as string, p as object, ctx(sport as string))).toBe(text);
  });
  test('every known event type gets words, never JSON', () => {
    for (const t of KNOWN_EVENT_TYPES) {
      const line = describeEvent(t, { team_side: 'A', runs: 1, value: 1, kind: 'x' }, ctx('generic'));
      expect([t, /[{}[\]"]/.test(line), line.length > 0]).toEqual([t, false, true]);
    }
  });
  test('an unknown type reads as a generic line', () => {
    expect(describeEvent('power_play', { a: { b: 1 } }, ctx('cricket'))).toBe('a power play entry');
    expect(describeEvent(null, null, ctx('cricket'))).toBe('an entry');
  });
});

describe('the score part', () => {
  test('rally sports: the points in play, with games when counted apart', () => {
    expect(scoreText({ A: { score: 0, points: 3 }, B: { score: 0, points: 1 } }, ctx('badminton'))).toBe('3–1');
    expect(scoreText({ A: { score: 1, points: 2 }, B: { score: 0, points: 5 } }, ctx('badminton'))).toBe('games 1–0 · 2–5');
  });
  test('goal sports', () => expect(scoreText({ A: { score: 2 }, B: { score: 1 } }, ctx('football'))).toBe('2–1'));
  test('cricket', () => {
    expect(scoreText({ A: { runs: 45, wickets: 2, balls: 30 }, B: { runs: 0, wickets: 0, balls: 0 } }, ctx('cricket'))).toBe('Lions 45/2');
    expect(scoreText({ A: { runs: 120, wickets: 7 }, B: { runs: 30, wickets: 1, balls: 12 } }, ctx('cricket'))).toBe('Lions 120/7 · Tigers 30/1');
  });
  test('nothing to show → null', () => expect(scoreText(null, ctx('football'))).toBeNull());
});

describe('a log row as a line', () => {
  const at = '2026-09-27T10:00:00Z';
  test('undo, with the score either side', () => {
    expect(editLine({ id: '1', action: 'undo', changed_by: 'u', created_at: at,
      old_payload: { id: 'e', event_type: 'score', payload: { team_side: 'A', kind: 'point', value: 1 } },
      score_before: { A: { score: 0, points: 3 }, B: { score: 0, points: 1 } },
      score_after: { A: { score: 0, points: 2 }, B: { score: 0, points: 1 } } }, 'Priya', ctx('badminton')))
      .toBe('Priya undid: Lions point, 3–1 → 2–1');
  });
  test('an edit, with where it is', () => {
    expect(editLine({ id: '2', action: 'edit', changed_by: 'u', created_at: at,
      old_payload: { runs: 1, __event_type: 'ball' }, new_payload: { runs: 4 } }, 'Rahul', ctx('cricket'), 'ball 4.3'))
      .toBe('Rahul edited ball 4.3: 1 run → 4 runs');
  });
  test('a delete; an old row with no score reads without it', () => {
    expect(editLine({ id: '3', action: 'delete', changed_by: 'u', created_at: at,
      old_payload: { event_type: 'card', payload: { kind: 'red', team_side: 'B' } } }, 'Asha', ctx('football')))
      .toBe('Asha deleted: red card — Tigers');
  });
  test('an edit that changes nothing visible says so', () => {
    expect(editLine({ id: '4', action: 'edit', changed_by: 'u', created_at: at,
      old_payload: { runs: 1, bowler_id: 'x', __event_type: 'ball' }, new_payload: { runs: 1, bowler_id: 'y' } }, 'Rahul', ctx('cricket')))
      .toBe('Rahul edited ball: details changed');
  });
  test('a pre-109 edit row (payload only, no type) still reads', () => {
    expect(editLine({ id: '5', action: 'edit', changed_by: 'u', created_at: at, old_payload: { runs: 2 }, new_payload: { runs: 3 } }, 'Rahul', ctx('cricket')))
      .toBe('Rahul edited ball: 2 runs → 3 runs');
    expect(editLine({ id: '6', action: 'edit', changed_by: 'u', created_at: at, old_payload: { foo: 1 }, new_payload: { foo: 2 } }, 'Rahul', ctx('chess')))
      .toBe('Rahul edited an entry: details changed');
  });
});

describe('cricket ball labels', () => {
  test('per innings; wides don\'t advance the over', () => {
    const m = cricketBallLabels([
      { id: 'a', event_type: 'ball', payload: { team_side: 'A' } },
      { id: 'b', event_type: 'extra', payload: { team_side: 'A', type: 'Wd' } },
      { id: 'c', event_type: 'ball', payload: { team_side: 'A' } },
      { id: 'd', event_type: 'ball', payload: { team_side: 'B' } },
    ]);
    expect([m.get('a'), m.get('b'), m.get('c'), m.get('d')]).toEqual(['ball 0.1', 'ball 0.2', 'ball 0.2', 'ball 0.1']);
  });
});

describe('who can read it', () => {
  test('organiser / umpire (canOfficiateMatch) or an admin; everyone else 403', () => {
    const f = code('controllers/matchFeatures.controller.ts');
    const i = f.indexOf('function getScoringEditLog(');
    const body = f.slice(i, i + 2500);
    expect(body).toMatch(/!\(await canOfficiateMatch\(match, userId\)\) && !\(await isAdminUser\(userId\)\)[\s\S]*?status\(403\)[\s\S]*?NOT_MATCH_OFFICIAL/);
    expect(body).toMatch(/\.order\('created_at', \{ ascending: false \}\)/); // newest first
    expect(fs.readFileSync(path.join(__dirname, '..', 'routes', 'matches.routes.ts'), 'utf8'))
      .toMatch(/router\.get\('\/:id\/edit-log', authenticateToken, getScoringEditLog\)/);
  });
  test('every writer records the score either side (edit, undo, delete)', () => {
    expect(code('controllers/matchFeatures.controller.ts')).toMatch(/recordScoreAfter\(logged\.auditId, summary\)/);
    expect(code('controllers/matchFeatures.controller.ts')).toMatch(/recordScoreAfter\(removed\.auditId, summary\)/);
    expect(code('controllers/scoring.controller.ts')).toMatch(/recordScoreAfter\(removed\.auditId, await recomputeSummary\(matchId\)\)/);
  });
});
