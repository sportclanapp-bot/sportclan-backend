/**
 * Badminton gap 7 (Oct 2026) · a doubles event's fixtures are 2 a side, and a
 * singles / doubles event's fixtures take their entries' players as line-ups
 * (at the draw and when a winner moves on) — no "Add players".
 */
import { fakeDb } from './helpers/fakeSupabase';

const T = 'dddddddd-dddd-4ddd-8ddd-000000000001';
let db = fakeDb();
jest.mock('../utils/supabase', () => ({ get supabase() { return db.client; } }));
// eslint-disable-next-line import/first
import { fillEntryLineups, doublesRulesSport } from '../utils/entryLineups';
// eslint-disable-next-line import/first
import { rulesRefusal, normalizeRules } from '../utils/matchRules';

const seed = (kind: string) => {
  db = fakeDb({
    tournaments: [{ id: T, entry_kind: kind }],
    matches: [
      { id: 'm1', tournament_id: T, team_a_id: 'p1', team_b_id: 'p2', status: 'scheduled', voided_at: null },
      { id: 'm2', tournament_id: T, team_a_id: 'p3', team_b_id: null, status: 'scheduled', voided_at: null },
      { id: 'm3', tournament_id: T, team_a_id: 'p1', team_b_id: 'p3', status: 'completed', voided_at: null },
    ],
    team_members: [
      { team_id: 'p1', user_id: 'ravi', role: 'vice_captain' }, { team_id: 'p1', user_id: 'amit', role: 'captain' },
      { team_id: 'p2', user_id: 'x', role: 'captain' }, { team_id: 'p2', user_id: 'y', role: 'vice_captain' },
      { team_id: 'p3', user_id: 'k', role: 'captain' }, { team_id: 'p3', user_id: 'd', role: 'vice_captain' },
    ],
    match_participants: [],
  });
};
const lineup = (m: string) => db.t('match_participants').filter((p) => p.match_id === m).map((p) => `${p.team_side}:${p.user_id}`);

test('a doubles event: each known side gets its pair (captain first); finished and unknown sides are left', async () => {
  seed('doubles');
  expect(await fillEntryLineups(T)).toBe(6);
  expect(lineup('m1')).toEqual(['A:amit', 'A:ravi', 'B:x', 'B:y']);
  expect(lineup('m2')).toEqual(['A:k', 'A:d']);
  expect(lineup('m3')).toEqual([]);
  // again (a winner moved on): only the new side
  db.t('matches').find((m) => m.id === 'm2')!.team_b_id = 'p2';
  expect(await fillEntryLineups(T)).toBe(2);
  expect(lineup('m2')).toEqual(['A:k', 'A:d', 'B:x', 'B:y']);
});

test('a side someone already picked is left alone; a team tournament is untouched', async () => {
  seed('doubles');
  db.t('match_participants').push({ match_id: 'm1', user_id: 'ravi', team_side: 'A' });
  await fillEntryLineups(T);
  expect(lineup('m1')).toEqual(['A:ravi', 'B:x', 'B:y']);
  seed('team');
  expect(await fillEntryLineups(T)).toBe(0);
  expect(db.t('match_participants')).toHaveLength(0);
});

test('2 a side is a valid rule for badminton, pickleball and tennis — not with a team tie', () => {
  expect(['badminton', 'pickleball', 'tennis'].every(doublesRulesSport)).toBe(true);
  expect(doublesRulesSport('tabletennis')).toBe(false);
  for (const s of ['badminton', 'pickleball', 'tennis']) expect(rulesRefusal(s, { ...normalizeRules(s, {}), players: 2 })).toBeNull();
});

// eslint-disable-next-line import/first
import fs from 'fs';
// eslint-disable-next-line import/first
import path from 'path';
// eslint-disable-next-line import/first
import { fixtureRulesFor } from '../controllers/tournaments.controller';

test('the draw: a doubles event’s fixtures are 2 a side; singles, teams and ties aren’t', () => {
  const r = { default: { v: 1, bestOf: 3, target: 15, cap: 21 } };
  expect(fixtureRulesFor('badminton', r, 'knockout', 'doubles').players).toBe(2);
  expect(fixtureRulesFor('badminton', r, 'knockout', 'singles').players).toBeNull();
  expect(fixtureRulesFor('badminton', r, 'knockout', 'team').players).toBeNull();
  expect(fixtureRulesFor('badminton', { default: { v: 1, bestOf: 3, rubbers: 5 } }, 'knockout', 'doubles').players).toBeNull();
  expect(fixtureRulesFor('tabletennis', { default: { v: 1, bestOf: 5 } }, 'knockout', 'doubles').players ?? null).toBeNull();
  // found on the local server: the draw read the tournament without entry_kind
  const src = fs.readFileSync(path.join(__dirname, '..', 'controllers', 'tournaments.controller.ts'), 'utf8');
  expect(src).toContain("match_rules, settings, is_parent, parent_id, entry_kind')");
  expect(src).toContain('fixtureRulesFor(sportSlug, tournamentRules, stage, (tournament as { entry_kind?: string }).entry_kind)');
});
