/** BUILD 3.58 · pickleball side-out: the server replays the serve with the shared core. */
import fs from 'fs';
import path from 'path';
import { sideOutReplay } from '../utils/pickleballCore';
import { sportCommentary } from '../utils/commentary';

const rally = (side: string) => ({ event_type: 'score', payload: { team_side: side, kind: 'rally' } });

test('the same core as the app (byte-identical)', () => {
  const app = path.join(__dirname, '../../../sportclan-v2/src/scoring/pickleballCore.ts');
  if (fs.existsSync(app)) expect(fs.readFileSync(app, 'utf8')).toBe(fs.readFileSync(path.join(__dirname, '../utils/pickleballCore.ts'), 'utf8'));
});

test('a receiver’s rally scores nothing; doubles open 0-0-2', () => {
  const s = sideOutReplay([rally('B'), rally('B'), rally('B')], { target: 11, winBy2: true, maxGames: 3, doubles: true });
  expect(s.cur).toEqual({ A: 0, B: 2 });
  expect([s.server, s.serverNum]).toEqual(['B', 1]);
});

test('the summary, the event checks and the timeline', () => {
  const src = fs.readFileSync(path.join(__dirname, '../controllers/scoring.controller.ts'), 'utf8');
  expect(src).toContain("if (slug === 'pickleball' && rules.scoring === 'sideout') {");
  expect(src).toContain("code: 'BAD_RALLY'");
  expect(src).toContain("code: 'SIDEOUT_NEEDS_UPDATE'");
  expect(sportCommentary('score', { team_side: 'A', kind: 'rally' }, { sport: 'pickleball', teamA: 'Dinks', teamB: 'Drives', period: 1 } as never)).toBe('Rally to Dinks');
});
