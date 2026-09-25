/**
 * Session 1 of MATCH_CREATE_TEST_PLAN: six serious findings and four "server
 * accepts" cases, each confirmed on the live system before these fixes.
 */
import fs from 'fs';
import path from 'path';

const teams: Record<string, { id: string; sport_id: string }> = {
  't-cricket': { id: 't-cricket', sport_id: 'cricket-id' },
  't-bad': { id: 't-bad', sport_id: 'bad-id' },
};
jest.mock('../utils/supabase', () => {
  const q = (table: string) => {
    const st: any = { table, filters: {} as Record<string, unknown> };
    const chain: any = {
      select: () => chain,
      eq: (k: string, v: unknown) => { st.filters[k] = v; return chain; },
      in: (k: string, v: unknown[]) => { st.filters[k] = v; return chain; },
      maybeSingle: async () => (table === 'tournaments'
        ? { data: st.filters.id === 'tour-1' ? { id: 'tour-1', sport_id: 'cricket-id' } : null }
        : { data: null }),
      then: (res: any) => res({ data: table === 'teams' ? (st.filters.id as string[]).map((i) => teams[i]).filter(Boolean) : [] }),
    };
    return chain;
  };
  return { supabase: { from: q } };
});
jest.mock('../utils/tournamentAuth', () => ({
  isTournamentOrganiser: async (_t: string, u: string) => u === 'organiser',
  canOfficiateMatch: async () => true,
}));

import { createMatchRefusal } from '../controllers/matches.controller';
import { bestOfState } from '../controllers/scoring.controller';
import { scorePush } from '../utils/scorePush';

const future = new Date(Date.now() + 3600_000).toISOString();
const base = { userId: 'u1', sportId: 'bad-id', venue: 'Court 1', scheduledAt: future, isRanked: false, isOpen: false, teamIds: [] as string[], tournamentId: null as string | null };

describe('createMatch refuses what the form refused (I-01, I-03, I-15, I-19, I-22)', () => {
  test('a valid request passes', async () => { expect(await createMatchRefusal(base)).toBeNull(); });
  test('empty venue', async () => { expect((await createMatchRefusal({ ...base, venue: null }))?.code).toBe('VENUE_REQUIRED'); });
  test('a time in the past (beyond 5 minutes of skew)', async () => {
    expect((await createMatchRefusal({ ...base, scheduledAt: new Date(Date.now() - 86400_000).toISOString() }))?.code).toBe('SCHEDULED_IN_PAST');
    expect(await createMatchRefusal({ ...base, scheduledAt: new Date(Date.now() - 60_000).toISOString() })).toBeNull();
    expect((await createMatchRefusal({ ...base, scheduledAt: 'not a date' }))?.code).toBe('BAD_SCHEDULED_AT');
  });
  test('ranked + open', async () => { expect((await createMatchRefusal({ ...base, isRanked: true, isOpen: true }))?.code).toBe('RANKED_OPEN'); });
  test('a team from another sport', async () => {
    expect((await createMatchRefusal({ ...base, teamIds: ['t-cricket'] }))?.code).toBe('TEAM_WRONG_SPORT');
    expect(await createMatchRefusal({ ...base, teamIds: ['t-bad'] })).toBeNull();
    expect((await createMatchRefusal({ ...base, teamIds: ['nope'] }))?.code).toBe('TEAM_NOT_FOUND');
  });
  test("someone else's tournament (F-06)", async () => {
    expect(await createMatchRefusal({ ...base, sportId: 'cricket-id', tournamentId: 'tour-1' })).toMatchObject({ status: 403, code: 'NOT_TOURNAMENT_ORGANISER' });
    expect(await createMatchRefusal({ ...base, userId: 'organiser', sportId: 'cricket-id', tournamentId: 'tour-1' })).toBeNull();
    expect((await createMatchRefusal({ ...base, userId: 'organiser', tournamentId: 'tour-1' }))?.code).toBe('TOURNAMENT_WRONG_SPORT');
  });
});

describe('F-01 · a scored best-of match must be decided to complete', () => {
  test('badminton 1-0 in games is not decided; 2-0 is', () => {
    expect(bestOfState('badminton', { A: { score: 1, sets: [21] }, B: { score: 0, sets: [0] } })).toMatchObject({ needed: 2, decided: false, scored: true });
    expect(bestOfState('badminton', { A: { score: 2, sets: [21, 21] }, B: { score: 0, sets: [0, 0] } })?.decided).toBe(true);
  });
  test('points played but no game finished counts as scored', () => {
    expect(bestOfState('badminton', { A: { score: 0, points: 1 }, B: { score: 0, points: 1 } })).toMatchObject({ scored: true, decided: false });
  });
  test('no scoring at all (a result entered by an organiser) is not "scored"', () => {
    expect(bestOfState('badminton', {})?.scored).toBe(false);
  });
  test('per sport: tennis 2, table tennis 3, volleyball 3, carrom 2; goal/point sports are not best-of', () => {
    expect(bestOfState('tennis', {})?.needed).toBe(2);
    expect(bestOfState('tabletennis', {})?.needed).toBe(3);
    expect(bestOfState('volleyball', {})?.needed).toBe(3);
    expect(bestOfState('carrom', {})?.needed).toBe(2);
    for (const s of ['football', 'hockey', 'basketball', 'cricket', 'chess']) expect(bestOfState(s, {})).toBeNull();
  });
  test('completeMatch refuses MATCH_NOT_DECIDED', () => {
    const src = fs.readFileSync(path.join(__dirname, '../controllers/matches.controller.ts'), 'utf8');
    expect(src).toMatch(/bo && bo\.scored && !bo\.decided[\s\S]{0,300}MATCH_NOT_DECIDED/);
  });
});

describe('F-04 · a board/game/set push only for the event that ended one', () => {
  const decided = { A: { score: 2, sets: [25, 25], points: 0 }, B: { score: 0, sets: [0, 0], points: 0 } };
  test('the event that ends game 2 pushes', () => {
    const prev = { A: { score: 1, sets: [25], points: 24 }, B: { score: 0, sets: [0], points: 0 } };
    expect(scorePush({ slug: 'carrom', summary: decided, side: 'A', teamName: 'A', prevSummary: prev })?.body).toContain('wins game 2');
  });
  test('a tap after the match was decided does not re-push', () => {
    expect(scorePush({ slug: 'carrom', summary: decided, side: 'A', teamName: 'A', prevSummary: decided })).toBeNull();
  });
});

describe('F-02 · the acceptance check guards every route', () => {
  const src = fs.readFileSync(path.join(__dirname, '../controllers/matches.controller.ts'), 'utf8');
  test('complete, status edit and line-up changes all check it', () => {
    expect(src).toMatch(/F-02: completing[\s\S]{0,200}opponentNotAcceptedRefusal\(match\)/);
    expect(src).toMatch(/'status' in update[\s\S]{0,200}opponentNotAcceptedRefusal/);
    expect(src).toContain('SINGLES_LINEUP_FIXED');
  });
});

describe('F-05 · a chess result must credit the winning side', () => {
  test('createEvent checks the named player against the winner', () => {
    const src = fs.readFileSync(path.join(__dirname, '../controllers/scoring.controller.ts'), 'utf8');
    expect(src).toMatch(/payload\.winner === 'white' \? 'A' : 'B'[\s\S]{0,900}RESULT_PLAYER_WRONG_SIDE/);
  });
});

describe('Decision B · the server reads the match length preset', () => {
  test('"decided" follows the preset', () => {
    const oneGame = { A: { score: 1, sets: [21] }, B: { score: 0, sets: [0] } };
    expect(bestOfState('badminton', oneGame, 'bo1')?.decided).toBe(true);
    expect(bestOfState('badminton', oneGame, 'bo3')?.decided).toBe(false);
    expect(bestOfState('badminton', oneGame, 'badminton')?.decided).toBe(false); // older match: standard
    expect(bestOfState('tabletennis', {}, 'bo7')?.needed).toBe(4);
    expect(bestOfState('tennis', { A: { score: 1 }, B: { score: 0 } }, 'bo1')?.decided).toBe(true);
  });
  test('recompute, completion and creation all use it', () => {
    const sc = fs.readFileSync(path.join(__dirname, '../controllers/scoring.controller.ts'), 'utf8');
    expect(sc).toContain('maxSets: bestOfFor(slug, match.format)');
    expect(sc).toContain("winsNeeded(bestOfFor('tennis', match.format) ?? 3)");
    const mc = fs.readFileSync(path.join(__dirname, '../controllers/matches.controller.ts'), 'utf8');
    expect(mc).toContain('bestOfState(normSportSlug(sportRow?.slug), canonical, match.format)');
    expect(mc).toContain("code: 'BAD_MATCH_LENGTH'");
    expect(mc).toContain('format: storedFormat,');
  });
});

describe('A5 · carrom on the server', () => {
  const sc = fs.readFileSync(path.join(__dirname, '../controllers/scoring.controller.ts'), 'utf8');
  test('a board event may carry 0–12 points and 0–9 pieces; other scores stay 1–3', () => {
    expect(sc).toContain("const isBoard = payload.kind === 'board';");
    expect(sc).toContain('outOfRange(payload.pieces_left, 0, CARROM_MAX_PIECES)');
    expect(sc).toContain('outOfRange(payload.value, 0, CARROM_MAX_PIECES + CARROM_QUEEN_POINTS)');
  });
  test('board events are replayed through the shared core, by the match preset', () => {
    expect(sc).toMatch(/slug === 'carrom' && events\.some[\s\S]{0,900}carromReplay\([\s\S]{0,400}winsNeeded\(bestOfFor\('carrom', match\.format\) \?\? 3\)/);
  });
  test('carrom game pushes say "game"', () => {
    expect(scorePush({ slug: 'carrom', side: 'A', teamName: 'X', summary: { A: { sets: [27], points: 0 }, B: { sets: [12], points: 0 } } })!.body).toBe('X wins game 1 · 27–12');
  });
});
