/**
 * F-13 (MATCH_CREATE_TEST_PLAN): options stored where they mean nothing —
 * players_needed / join_policy on closed and singles matches, a batting order
 * on every sport's line-up. (format = slug and overs on non-cricket were fixed
 * by decision B and A6.)
 */
import fs from 'fs';
import path from 'path';

const src = fs.readFileSync(path.join(__dirname, '../controllers/matches.controller.ts'), 'utf8');
const fn = (name: string) => { const i = src.indexOf(`export async function ${name}(`); return src.slice(i, src.indexOf('\nexport ', i + 10)); };

describe('F-13', () => {
  test('createMatch stores slots and a join policy only for an open pickup', () => {
    const body = fn('createMatch');
    expect(body).toContain('players_needed: !singles && is_open ? players_needed ?? 0 : 0,');
    expect(body).toContain("join_policy: !singles && is_open ? joinPolicy : 'open',");
  });
  test('addParticipants keeps a batting order only for cricket', () => {
    const body = fn('addParticipants');
    expect(body).toContain("const isCricketLineup = normSportSlug((await getSport(match.sport_id as string))?.slug) === 'cricket';");
    expect(body).toContain('batting_order: isCricketLineup ? p.batting_order ?? null : null,');
    expect(body.indexOf('sport_id')).toBeLessThan(body.indexOf('isCricketLineup'));
  });
});
