/** BUILD 3.77 · point carrom on the server: coin events only in a points match; the replay; the timeline. */
import fs from 'fs';
import path from 'path';
import { pointCarromReplay, pointCoinValue } from '../utils/carromCore';
import { rulesRefusal, standardRules } from '../utils/matchRules';
import { sportCommentary } from '../utils/commentary';

test('replay and values', () => {
  expect([pointCoinValue('white', 50), pointCoinValue('black', 50), pointCoinValue('queen', 25)]).toEqual([10, 5, 25]);
  const s = pointCarromReplay([{ side: 'B', coin: 'queen' }, { side: 'A', coin: 'white' }], { gamesToWin: 2, queenValue: 50 });
  expect(s.points).toEqual({ A: 10, B: 50 });
  expect(rulesRefusal('carrom', { ...standardRules('carrom'), carromMode: 'points', queenValue: 50 })).toBeNull();
});
test('checked, summarised and said', () => {
  const src = fs.readFileSync(path.join(__dirname, '../controllers/scoring.controller.ts'), 'utf8');
  expect(src).toContain("if (!r || r.carromMode !== 'points') return refuse(400, { error: 'A piece is scored only in point carrom.', code: 'BAD_COIN' });");
  expect(src).toContain("} else if (slug === 'carrom' && rulesOf('carrom', match).carromMode === 'points') {");
  expect(sportCommentary('score', { team_side: 'B', kind: 'coin', coin: 'queen', value: 50 }, { sport: 'carrom', teamA: 'Strikers', teamB: 'Rebounds', period: 1 } as never)).toBe('👑 Queen pocketed — Rebounds (+50)');
});
