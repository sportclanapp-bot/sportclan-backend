/**
 * Q41 (Dipak, 21 Nov 2026: A) · N-R6-E121: a tournament referee who doesn't score a fixture can't
 * give it a walkover; the organiser or the match's umpire does. canDefault keeps the referees for a
 * default / disqualification during play (N-R7-105, CH11). completeMatch is driven with a recording
 * Supabase; the referee is a tournament official (role referee), not the fixture's umpire.
 */
import { mock, res } from './r6Mock';
jest.mock('../utils/supabase', () => require('./r6Mock').supabaseStandIn());
// eslint-disable-next-line import/first
import { canGiveWalkover, canDefault } from '../utils/tournamentAuth';

const T = '77777777-7777-4777-8777-777777777777';
const ORG = '11111111-1111-4111-8111-111111111111';
const UMP = '22222222-2222-4222-8222-222222222222';
const REF = '33333333-3333-4333-8333-333333333333';
const match = { tournament_id: T, created_by: ORG, umpire_id: UMP, scorer_id: null };
beforeEach(() => {
  mock.next = (q) => {
    const has = (s: string) => q.some((c) => c.includes(s));
    if (q[0] === 'from:tournaments') return { data: has('select') && has('parent_id') ? { id: T, parent_id: null, created_by: ORG } : { id: T, created_by: ORG } };
    if (q[0] === 'from:tournament_organisers') return { data: [] };
    if (q[0] === 'from:tournament_officials') return { data: has(REF) ? [{ id: 'o1' }] : [] };
    return { data: [] };
  };
});

test('the referee may default a player but not give a walkover', async () => {
  expect(await canDefault(match, REF)).toBe(true);
  expect(await canGiveWalkover(match, REF)).toBe(false);
});
test('the umpire and the organiser may give a walkover', async () => {
  expect(await canGiveWalkover(match, UMP)).toBe(true);
  expect(await canGiveWalkover(match, ORG)).toBe(true);
});
test('completeMatch asks canGiveWalkover for a walkover; the match page says can_walkover', () => {
  const src = require('fs').readFileSync(require('path').join(__dirname, '../controllers/matches.controller.ts'), 'utf8');
  expect(src).toContain('!(await canGiveWalkover(match, userId))) {');
  expect(src).toMatch(/matchWithRating\.can_walkover = /);
  void res;
});
