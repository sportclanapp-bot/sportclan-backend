/**
 * Phase 3 · player-vs-player singles, ranked 1-a-side with the opponent's
 * acceptance, and a winner that does not depend on team ids.
 */
import fs from 'fs';
import path from 'path';
import { winnerSideOf, isSinglesShape, isSinglesSport, challengeText } from '../utils/singles';

const code = (rel: string) =>
  fs.readFileSync(path.join(__dirname, '..', rel), 'utf8')
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/^\s*\/\/.*$/gm, '');
const fn = (src: string, name: string) => {
  const start = src.indexOf(`export async function ${name}(`); // "(" so createMatch ≠ createMatchRefusal
  const next = src.indexOf('\nexport ', start + 10);
  return src.slice(start, next === -1 ? undefined : next);
};

describe('winnerSideOf', () => {
  const teams = { team_a_id: 'ta', team_b_id: 'tb' };
  test('a team match names its winner by team id', () => {
    expect(winnerSideOf({ ...teams, winner_team_id: 'ta' })).toBe('A');
    expect(winnerSideOf({ ...teams, winner_team_id: 'tb' })).toBe('B');
  });
  test('a match with no teams names it by side', () => {
    expect(winnerSideOf({ winner_side: 'B' })).toBe('B');
  });
  test('garbage is no winner, never a guess', () => {
    expect(winnerSideOf({ ...teams, winner_team_id: 'someone-else' })).toBeNull();
    expect(winnerSideOf({ winner_side: 'C' })).toBeNull();
    expect(winnerSideOf({})).toBeNull();
  });
});

describe('isSinglesShape', () => {
  const one = (s: string, u = s) => ({ user_id: u, team_side: s });
  test('no teams, one participant a side', () => {
    expect(isSinglesShape({}, [one('A'), one('B')])).toBe(true);
  });
  test('teams, or anything but one-and-one, is not singles', () => {
    expect(isSinglesShape({ team_a_id: 'ta' }, [one('A'), one('B')])).toBe(false);
    expect(isSinglesShape({}, [one('A'), one('A', 'x'), one('B')])).toBe(false);
    expect(isSinglesShape({}, [])).toBe(false);
  });
});

test('singles sports are the one-a-side ones, whatever the slug spelling', () => {
  for (const s of ['badminton', 'tennis', 'table-tennis', 'Table Tennis', 'pickleball', 'chess', 'carrom']) {
    expect(isSinglesSport(s)).toBe(true);
  }
  for (const s of ['cricket', 'football', 'basketball', 'volleyball', 'hockey', '', null]) {
    expect(isSinglesSport(s)).toBe(false);
  }
});

test('the challenge says who, what, and that it needs an answer', () => {
  const t = challengeText({ challengerName: 'SC434 Fresh QA', sportName: 'Badminton', ranked: true, when: null });
  expect(t.title).toBe('SC434 Fresh QA challenged you');
  expect(t.body).toBe('A ranked badminton singles match. Open it to accept or decline.');
  expect(challengeText({ challengerName: 'X', sportName: 'Tennis', ranked: false, when: null }).body)
    .toBe('A tennis singles match. Open it to accept or decline.');
});

describe('wiring', () => {
  const matches = code('controllers/matches.controller.ts');
  const create = fn(matches, 'createMatch');
  const complete = fn(matches, 'completeMatch');

  test('createMatch: singles seeds BOTH players as the line-up and notifies the opponent', () => {
    expect(create).toMatch(/team_side: 'A' \},\s*\{ match_id: data\.id, user_id: singlesSides\.opponentId, team_side: 'B' \}/);
    expect(create).toContain("type: 'match_challenge'");
  });

  test('createMatch: ranked no longer needs teams when it is singles', () => {
    expect(create).toContain('if (is_ranked && !singles && (!team_a_id || !team_b_id))');
  });

  test('createMatch: singles refuses self, a missing/deleted/blocked opponent, and a team sport', () => {
    for (const code_ of ['OPPONENT_IS_SELF', 'OPPONENT_NOT_FOUND', 'NOT_A_SINGLES_SPORT', 'SINGLES_NO_TEAMS']) {
      expect(create).toContain(code_);
    }
    expect(create).toContain('isBlockedBetween(userId, opponent_id)');
  });

  test('createMatch: a team match tells both rosters (U-10)', () => {
    expect(create).toContain("type: 'match_scheduled'");
  });

  test('completeMatch: rating outcome, W/L, draws and coins all read the SIDE', () => {
    expect(complete).toContain("if (winnerSide) outcome = winnerSide === 'A' ? 1 : 0;");
    expect(complete).not.toMatch(/outcome = winner_team_id ===/);
    expect(complete).not.toMatch(/draws: profile\.draws \+ \(!winner_team_id/);
    expect(complete).toMatch(/if \(winnerSide\) \{\s*const winnerIds/);
    expect(complete).toContain('if (!winnerSide) {'); // the decisive-sport guard
  });

  test('completeMatch: a side win is decisive, not a draw', () => {
    expect(complete).toContain("(winner_team_id || patch.winner_team_id || derivedSide) ? 'decisive' : 'draw'");
  });

  test('completeMatch: the result is sent to the audience (U-32)', () => {
    expect(complete).toContain("type: 'match_result'");
  });

  test('createEvent: a ranked singles match cannot start before the opponent accepts', () => {
    const scoring = fn(code('controllers/scoring.controller.ts'), 'createEvent');
    const gate = scoring.indexOf('OPPONENT_NOT_ACCEPTED');
    const live = scoring.indexOf(".update({ status: 'live' })");
    expect(gate).toBeGreaterThan(-1);
    expect(gate).toBeLessThan(live);
  });

  test('history is routed before /:id', () => {
    const routes = code('routes/matches.routes.ts');
    expect(routes.indexOf("router.get('/history'")).toBeGreaterThan(-1);
    expect(routes.indexOf("router.get('/history'")).toBeLessThan(routes.indexOf("router.get('/:id'"));
  });

  test('the app is told who is admin by the same rule the admin gate uses', () => {
    expect(code('middleware/admin.middleware.ts')).toMatch(/requireAdmin[\s\S]*isAdminUser\(userId\)/);
    expect(fn(code('controllers/users.controller.ts'), 'getMe')).toContain('isAdminUser(userId)');
  });

  test('serve_swap is a known event type', () => {
    expect(code('utils/scoringEvents.ts')).toContain("'serve_swap'");
  });
});

describe('match history (decision 4)', () => {
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  const { buildHistory } = require('../controllers/matches.controller') as typeof import('../controllers/matches.controller');
  const m = (id: string, completed_at: string, extra: Record<string, unknown> = {}) =>
    ({ id, status: 'completed', completed_at, ...extra });

  const rows = [
    m('old', '2026-09-01T10:00:00Z'),
    m('new', '2026-09-24T17:07:53Z'),
    m('umpired', '2026-09-20T10:00:00Z'),
    m('voided', '2026-09-22T10:00:00Z', { voided_at: '2026-09-23T00:00:00Z' }),
    m('abandoned', '2026-09-21T10:00:00Z', { status: 'abandoned' }),
  ];
  const sideOf = new Map([['old', 'A'], ['new', 'B'], ['voided', 'A'], ['abandoned', 'B']]);
  const out = buildHistory(rows, sideOf, 0, 50);

  test('newest first, each labelled with the role and side', () => {
    expect(out.matches.map((x) => x.id)).toEqual(['new', 'voided', 'abandoned', 'umpired', 'old']);
    expect(out.matches[0]).toMatchObject({ my_role: 'played', my_side: 'B' });
    expect(out.matches.find((x) => x.id === 'umpired')).toMatchObject({ my_role: 'officiated', my_side: null });
  });

  test('counts leave out voided and abandoned — listed, not counted', () => {
    expect(out.played_count).toBe(2);   // old, new
    expect(out.officiated_count).toBe(1);
  });

  test('pages', () => {
    const p = buildHistory(rows, sideOf, 0, 2);
    expect(p.matches).toHaveLength(2);
    expect(p.has_more).toBe(true);
  });
});
