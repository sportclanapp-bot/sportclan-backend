/**
 * N320 side finding 4 · community_posts.post_type was stored as sent. A post
 * with post_type 'text' saved, and the feed printed "text" on its card. Create
 * and edit now accept only the types the app can show.
 */
import fs from 'fs';
import path from 'path';
import { isPostType, POST_TYPES } from '../utils/validation';

const src = fs
  .readFileSync(path.join(__dirname, '..', 'controllers', 'community.controller.ts'), 'utf8')
  .replace(/\/\*[\s\S]*?\*\//g, '')
  .replace(/\/\/.*$/gm, '');

describe('post_type is one the app knows', () => {
  test('the allowed list matches the app', () => {
    expect([...POST_TYPES]).toEqual([
      'general', 'match_announcement', 'achievement', 'poll', 'looking_for_team', 'looking_for_player', 'match_result',
    ]);
  });

  test('known types pass; anything else is refused', () => {
    for (const t of POST_TYPES) expect(isPostType(t)).toBe(true);
    for (const t of ['text', 'GENERAL', '', ' poll', 'link', 1, null, undefined, {}]) expect(isPostType(t)).toBe(false);
  });

  test('create checks both `type` and `post_type` before the insert', () => {
    const guard = /for \(const t of \[type, post_type\]\) \{\s*if \(t !== undefined && t !== null && !isPostType\(t\)\) \{\s*return res\.status\(400\)\.json\(\{ error: `Unknown post type\. Use one of: \$\{POST_TYPES\.join\(', '\)\}\.`, code: 'INVALID_POST_TYPE' \}\);/;
    expect(src).toMatch(guard);
    expect(src.search(guard)).toBeLessThan(src.indexOf("p_post_type: validatedMatchId ? 'match_result' : type || post_type || 'general'"));
  });

  test('an edit checks post_type before the update', () => {
    const guard = /if \(post_type !== undefined && post_type !== null && !isPostType\(post_type\)\) \{\s*return res\.status\(400\)\.json\(\{ error: `Unknown post type\.[^`]*`, code: 'INVALID_POST_TYPE' \}\);/;
    expect(src).toMatch(guard);
    expect(src.search(guard)).toBeLessThan(src.indexOf('...(post_type !== undefined && { post_type })'));
  });
});
