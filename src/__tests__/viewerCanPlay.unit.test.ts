/**
 * U-13 · "Are you playing?" was asked of the umpire and of pure spectators.
 * viewer_can_play is true only for someone in the line-up or on either team's
 * roster — never the match's umpire.
 */
const rosterRows: Array<{ user_id: string; team_id: string }> = [];
jest.mock('../utils/supabase', () => {
  const chain = (filters: Record<string, unknown> = {}) => ({
    select: () => chain(filters),
    eq: (c: string, v: unknown) => chain({ ...filters, [c]: v }),
    in: (c: string, v: unknown[]) => chain({ ...filters, [c]: v }),
    limit: async () => ({
      data: rosterRows.filter(
        (r) => r.user_id === filters.user_id && (filters.team_id as string[]).includes(r.team_id),
      ),
    }),
  });
  return { supabase: { from: () => chain() } };
});

import { viewerCanPlay } from '../controllers/matches.controller';

const teamMatch = { team_a_id: 'ta', team_b_id: 'tb', umpire_id: 'ump' };

beforeEach(() => {
  rosterRows.length = 0;
  rosterRows.push({ user_id: 'captain-b', team_id: 'tb' }, { user_id: 'ump', team_id: 'ta' });
});

test('a member of either team can play', async () => {
  expect(await viewerCanPlay(teamMatch, 'captain-b', [])).toBe(true);
});

test('someone already in the line-up can play', async () => {
  expect(await viewerCanPlay({ ...teamMatch, team_a_id: null, team_b_id: null }, 'p1', ['p1'])).toBe(true);
});

test('the umpire is never asked — even if they are on a roster', async () => {
  expect(await viewerCanPlay(teamMatch, 'ump', [])).toBe(false);
});

test('a spectator is not asked', async () => {
  expect(await viewerCanPlay(teamMatch, 'stranger', [])).toBe(false);
});

test('a typed-in match has nobody to ask', async () => {
  expect(await viewerCanPlay({ team_a_id: null, team_b_id: null, umpire_id: null }, 'anyone', [])).toBe(false);
});

test('getMatch sends it', () => {
  const fs = require('fs') as typeof import('fs');
  const path = require('path') as typeof import('path');
  const src = fs.readFileSync(path.join(__dirname, '..', 'controllers', 'matches.controller.ts'), 'utf8');
  expect(src).toContain('viewerCanPlay(match, userId, participantIds),');
  expect(src).toContain('matchWithRating.viewer_can_play = viewerCan;');
});
