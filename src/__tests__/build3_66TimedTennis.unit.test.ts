/** BUILD 3.66 · timed tennis: the server replays the buzzer and completion goes to the leader. */
import fs from 'fs';
import path from 'path';
import { tennisReplayEvents } from '../utils/tennisCore';
import { bestOfState } from '../controllers/scoring.controller';
import { standardRules } from '../utils/matchRules';

const ev = (s: string) => ({ event_type: 'score', payload: { team_side: s } });
const buzz = { event_type: 'note', payload: { kind: 'buzzer' } };

test('replay: ahead at the buzzer wins; level, the next point; nothing after counts', () => {
  const r = tennisReplayEvents([ev('A'), ev('A'), ev('B'), buzz, ev('B'), ev('B')], 2);
  expect(r.buzzer).toBe(true);
  expect(r.score.winner).toBe('A');
  expect(r.score.points).toEqual({ A: 2, B: 1 });
});

test('completion: decided at the buzzer on games or points; not while level', () => {
  const m = { format: 'bo3', rules: { ...standardRules('tennis'), timeLimitMinutes: 45 } };
  expect(bestOfState('tennis', { A: { score: 0, games: 3, points: 0 }, B: { score: 0, games: 2, points: 0 }, buzzer: true }, m)).toMatchObject({ decided: true, leader: 'A' });
  expect(bestOfState('tennis', { A: { score: 0, games: 2, points: 1 }, B: { score: 0, games: 2, points: 1 }, buzzer: true }, m)?.decided).toBe(false);
  expect(bestOfState('tennis', { A: { score: 0, games: 3 }, B: { score: 0, games: 2 } }, m)?.decided).toBe(false); // no buzzer: sets as ever
  const src = fs.readFileSync(path.join(__dirname, '../controllers/scoring.controller.ts'), 'utf8');
  expect(src).toContain("const timedHere = slug === 'tennis' || RALLY_TIMED.has(slug) ? !!rulesOf(slug, match).timeLimitMinutes"); // BUILD 3.76: and timed carrom
});
