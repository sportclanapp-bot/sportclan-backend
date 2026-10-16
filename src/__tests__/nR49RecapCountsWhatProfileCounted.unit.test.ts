/**
 * N-R4-9 (launch test plan, Round 4, found on the phone checking F189): the Profile said 13,323
 * matches while "Your last 90 days" said 13,326 and Match history agreed with the Profile. The recap
 * (and Insights' form) counted a casual match for anyone in its line-up, but the Profile only counts it
 * for players who agreed to it (Audit #6) — which a result has listed since Audit #56
 * (score_summary.attributed_user_ids). One rule now, for one person: countsForUser.
 */
import fs from 'fs';
import path from 'path';
import { countsForUser } from '../utils/matchCounts';

const m = (o: Record<string, unknown>) => ({ status: 'completed', is_ranked: false, voided_at: null, team_a_id: null, team_b_id: null, tournament_id: null, ...o });

test('a result that lists whose record it changed decides for that person', () => {
  expect(countsForUser(m({ score_summary: { attributed_user_ids: ['me', 'you'] } }), 'me', 2)).toBe(true);
  expect(countsForUser(m({ score_summary: { attributed_user_ids: [] } }), 'me', 2)).toBe(false); // nobody agreed
  expect(countsForUser(m({ score_summary: { attributed_user_ids: ['you'] } }), 'me', 2)).toBe(false);
});

test('an older result goes by the Profile rule (ranked, or two real players); void and byes never count', () => {
  expect(countsForUser(m({}), 'me', 2)).toBe(true);
  expect(countsForUser(m({}), 'me', 1)).toBe(false);
  expect(countsForUser(m({ is_ranked: true }), 'me', 1)).toBe(true);
  expect(countsForUser(m({ voided_at: '2026-10-01', score_summary: { attributed_user_ids: ['me'] } }), 'me', 2)).toBe(false);
});

test('the recap, Insights\' form and Match history all use it', () => {
  const read = (f: string) => fs.readFileSync(path.join(__dirname, '..', 'controllers', f), 'utf8');
  expect(read('features.controller.ts')).toContain('countsForUser(m, id, participantCounts.get(m?.id) ?? 0)');
  expect(read('insights.controller.ts')).toContain('countsForUser(x.m, id, insightCounts.get(x.m?.id) ?? 0)');
  expect(read('matches.controller.ts')).toContain('countsForUser(m, userId, players?.get(m.id) ?? 0)');
});
