/**
 * Session 2 of MATCH_CREATE_TEST_PLAN (the API checks), F-19: the create body's
 * flags and counts are typed. Confirmed live before this fix: players_needed
 * 2.5 → 500, -1 → stored, is_ranked "false" → treated as ranked.
 */
import fs from 'fs';
import path from 'path';

jest.mock('../utils/supabase', () => ({ supabase: { from: () => ({}) } }));

import { createFieldRefusal, PLAYERS_NEEDED_MAX } from '../controllers/matches.controller';

describe('createFieldRefusal (F-19)', () => {
  test('absent, null and real values pass', () => {
    expect(createFieldRefusal({})).toBeNull();
    expect(createFieldRefusal({ is_ranked: null, is_open: null, players_needed: null })).toBeNull();
    expect(createFieldRefusal({ is_ranked: true, is_open: false, players_needed: 0 })).toBeNull();
    expect(createFieldRefusal({ is_open: true, players_needed: 1 })).toBeNull();
    expect(createFieldRefusal({ is_open: true, players_needed: PLAYERS_NEEDED_MAX })).toBeNull();
  });

  test.each([['false'], ['true'], [0], [1], ['yes'], [{}]])('is_ranked %p is refused', (v) => {
    expect(createFieldRefusal({ is_ranked: v })?.code).toBe('BAD_FLAG');
  });

  test.each([['false'], [1]])('is_open %p is refused', (v) => {
    expect(createFieldRefusal({ is_open: v })?.code).toBe('BAD_FLAG');
  });

  test.each([[-1], [2.5], [31], ['3'], [NaN], [Infinity]])('players_needed %p is refused', (v) => {
    const r = createFieldRefusal({ is_open: true, players_needed: v });
    expect(r).toMatchObject({ status: 400, code: 'BAD_PLAYERS_NEEDED' });
  });

  test('createMatch checks the fields before anything is written', () => {
    const src = fs.readFileSync(path.join(__dirname, '../controllers/matches.controller.ts'), 'utf8');
    const body = src.slice(src.indexOf('export async function createMatch('));
    const check = body.indexOf('createFieldRefusal({ is_ranked, is_open, players_needed })');
    expect(check).toBeGreaterThan(0);
    expect(check).toBeLessThan(body.indexOf(".from('matches')"));
    expect(check).toBeLessThan(body.indexOf('createMatchRefusal('));
  });
});
