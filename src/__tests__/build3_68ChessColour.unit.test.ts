/** BUILD 3.68 · chess colour at create; the ranked gate's opponent is whoever isn't the creator. */
import fs from 'fs';
import path from 'path';

const read = (p: string) => fs.readFileSync(path.join(__dirname, '..', p), 'utf8');

test('create seats the creator on the chosen side and names the sides to match', () => {
  const src = read('controllers/matches.controller.ts');
  expect(src).toContain("if (chess_colour === 'black') creatorSide = 'B';");
  expect(src).toContain("else if (chess_colour === 'alternate') creatorSide = (await lastChessSide(userId, opponent_id, String(resolved ?? sport_id))) === 'A' ? 'B' : 'A';");
  expect(src).toContain('{ match_id: data.id, user_id: userId, team_side: singlesSides.creatorSide },');
  expect(src).toContain("code: 'BAD_COLOUR'");
  expect(src).toContain('challengerName: singlesSides.creatorName,');
});

test('the acceptance gate asks the player who isn’t the creator', () => {
  const src = read('utils/singles.ts');
  expect(src).toContain("(match.created_by ? p.user_id !== match.created_by : p.team_side === 'B')");
});
