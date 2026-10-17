/**
 * E-100 (Round 6): anyone on either team TODAY could rate a match — someone
 * who joined the team a month after it was played moved its rating. A member
 * counts when they were on the team by the time it was played. And the match
 * page says who may rate (can_rate), so the app offers the card to exactly the
 * people the server accepts (it showed it to the line-up only, not the creator
 * or umpire the server lets rate).
 */
import { fakeDb } from './helpers/fakeSupabase';

let db = fakeDb();
jest.mock('../utils/supabase', () => ({ get supabase() { return db.client; } }));
// eslint-disable-next-line import/first
import { rateMatchHandler, tookPartInMatch } from '../controllers/matches.controller';

const res = () => { const r: any = { statusCode: 200, body: null }; r.status = (c: number) => { r.statusCode = c; return r; }; r.json = (b: unknown) => { r.body = b; return r; }; return r; };
const M = { id: 'm', status: 'completed', created_by: 'creator', umpire_id: 'ump', team_a_id: 'A', team_b_id: 'B', voided_at: null, completed_at: '2026-09-01T12:00:00Z', scheduled_at: '2026-09-01T10:00:00Z' };
const seed = () => fakeDb({
  matches: [M],
  team_members: [
    { team_id: 'A', user_id: 'before', joined_at: '2026-08-01T00:00:00Z' },
    { team_id: 'B', user_id: 'after', joined_at: '2026-10-01T00:00:00Z' },
  ],
});

test('a member who joined after the match can’t rate it', async () => {
  db = seed();
  const r = res();
  await rateMatchHandler({ userId: 'after', params: { id: 'm' }, body: { matchQuality: 1, wouldPlayAgain: false } } as any, r);
  expect([r.statusCode, r.body.code]).toEqual([403, 'NOT_IN_MATCH']);
  expect(db.t('match_ratings')).toHaveLength(0);
});

test('a member who was on the team then still can', async () => {
  db = seed();
  const r = res();
  await rateMatchHandler({ userId: 'before', params: { id: 'm' }, body: { matchQuality: 5, wouldPlayAgain: true } } as any, r);
  expect(r.statusCode).toBe(200);
  expect(db.t('match_ratings')).toHaveLength(1);
});

test('the creator and umpire still take part', async () => {
  db = seed();
  expect(await tookPartInMatch(M, 'creator')).toBe(true);
  expect(await tookPartInMatch(M, 'ump')).toBe(true);
  expect(await tookPartInMatch(M, 'stranger')).toBe(false);
});

test('the match page carries can_rate from the same rule', () => {
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  const src: string = require('fs').readFileSync(require('path').join(__dirname, '..', 'controllers', 'matches.controller.ts'), 'utf8');
  const get = src.slice(src.indexOf('export async function getMatch'));
  expect(get).toMatch(/can_rate = !!userId && match\.status === 'completed' && !match\.voided_at\s+&& await tookPartInMatch\(match, userId\)/);
});
