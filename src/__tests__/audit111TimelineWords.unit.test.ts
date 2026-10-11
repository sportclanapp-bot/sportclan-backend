/**
 * Audit batch 4 · #111, #112, #113, #114, #123, #128, #136, #137 (11 Oct 2026).
 * Every timeline event kind, in every sport, reads as plain words — never a raw
 * key, JSON or "note {". The catalogue is every event the app's scoring pads send
 * (src/scoring/rules/*, the pads), each with and without names and with zero
 * values, plus every event type the server accepts and kinds nobody knows.
 */
import { silentOnTimeline, timelineLine, type CommentaryContext } from '../utils/commentary';
import fs from 'fs';
import path from 'path';
import { KNOWN_EVENT_TYPES } from '../utils/scoringEvents';

const SPORTS = ['cricket', 'football', 'hockey', 'basketball', 'volleyball', 'badminton', 'tennis', 'tabletennis', 'pickleball', 'chess', 'carrom'];
const NOTE_KINDS = ['kickoff', 'clock_pause', 'clock_resume', 'clock_adjust', 'added_time', 'add_time', 'buzzer', 'serve_order', 'expedite', 'point_off', 'game_forfeit',
  'typed_score', 'warmup', 'medical_timeout', 'violation', 'rotation', 'libero', 'super_point', 'receiver_swap', 'shootout_start', 'shootout_cancel', 'shootout_kick',
  'shootout', 'pen_corner', 'pc_over', 'pen_stroke', 'pen_missed', 'official_card', 'game_end', 'toss', 'arrow', 'arrow_flip', 'stat', 'illegal_move', 'wrong_claim',
  'some_new_kind'];
const SCORE_KINDS = ['point', 'rally', 'ace', 'double_fault', 'fault', 'goal', 'own_goal', 'coin', 'board', 'ft', '1pt', '2pt', '3pt', undefined];
const EXTRA_TYPES = ['Wd', 'Nb', 'B', 'Lb', 'P'];

type Ev = { t: string; p: Record<string, unknown> };
function catalogue(): Ev[] {
  const evs: Ev[] = [];
  const variants = (base: Record<string, unknown>) => [
    base,
    { ...base, team_side: 'A' }, { ...base, team_side: 'B', player_name: 'Asha Rao' },
    { ...base, team_side: 'B', seconds: 0, minutes: 0, value: 0, runs: 0 },
    { ...base, team_side: 'A', seconds: 30, minutes: 2, value: 2, runs: 3, game: 1, winner: 'A', next_first: 'B', stat: 'steal', server: 2, receiver: 1,
      libero: { name: '' }, replaced: { name: '' }, slots: [{ name: 'A' }], offence: 'time', penalty: 'warning', scored: true, A: 4, B: 3, text: '21–19' },
    { ...base, kind: base.kind, side: 'B', seconds: -60, partner: true },
  ];
  for (const k of NOTE_KINDS) evs.push(...variants({ kind: k }).map((p) => ({ t: 'note', p })));
  for (const k of SCORE_KINDS) evs.push(...variants(k ? { kind: k } : {}).map((p) => ({ t: 'score', p })));
  for (const x of EXTRA_TYPES) for (const runs of [0, 1, 2, 5]) evs.push({ t: 'extra', p: { type: x, runs, team_side: 'A' } }, { t: 'extra', p: { type: x, runs, penalty: 1, batsman_name: 'Rohit', bowler_name: 'Bumrah' } });
  for (const runs of [0, 1, 2, 3, 4, 5, 6]) evs.push({ t: 'ball', p: { runs, team_side: 'B' } }, { t: 'ball', p: { runs, boundary: false } });
  for (const w of ['bowled', 'caught', 'lbw', 'run_out', 'stumped', 'hit_wicket', 'retired_hurt', 'retired_not_out', 'retired_out', 'obstructing']) evs.push({ t: 'wicket', p: { wicket_type: w, runs: 0 } }, { t: 'wicket', p: { wicket_type: w, batsman_name: 'Rohit', bowler_name: 'Bumrah', fielder_name: 'Jadeja', runs: 1 } });
  for (const t of KNOWN_EVENT_TYPES) evs.push({ t, p: {} }, { t, p: { team_side: 'A' } }, { t, p: { kind: 'partner', team_side: 'B' } }, { t, p: { kind: 'red', team_side: 'B', player_name: 'Asha' } });
  evs.push({ t: 'result', p: { winner: 'white', reason: 'checkmate' } }, { t: 'result', p: { winner: 'draw', reason: 'stalemate' } }, { t: 'move', p: { side: 'B' } },
    { t: 'card', p: { kind: 'yellow' } }, { t: 'period_change', p: { kind: 'halftime' } }, { t: 'period_change', p: { kind: 'extra_time' } },
    { t: 'note', p: { kind: 'serve_swap' } }, { t: 'serve_swap', p: { kind: 'serve_swap' } }, { t: 'note', p: null as never }, { t: 'note', p: [1, 2] as never },
    { t: 'note', p: { kind: '{"x":1}' } }, { t: 'mystery_event', p: { foo_bar: 1 } });
  return evs;
}

const ctx = (sport: string): CommentaryContext => ({ sport, teamA: 'Lions', teamB: 'Tigers', period: 1, move: 3, clockSeconds: 75, regulation: null, periodMinutes: null });

const RAW = [/[{}"[\]]/, /^\s*note\b/i, /note\s*\{/i, /\b[a-z]+_[a-z_]+\b/, /\bundefined\b/, /\bnull\b/, /\bNaN\b/, /\[object/, / {2}/, /—\s*$/, /\(\s*\)/, /\bfor\s+—/, /:\s*$/];

test.each(SPORTS)('every event kind in %s reads as plain words', (sport) => {
  const bad: string[] = [];
  for (const e of catalogue()) {
    const { text } = timelineLine(e.t, e.p, ctx(sport));
    if (!text || RAW.some((r) => r.test(text))) bad.push(`${e.t} ${JSON.stringify(e.p)} → "${text}"`);
  }
  expect(bad).toEqual([]);
});

test('the exact lines the audit found', () => {
  // #111: a doubles receiver swap is the scorer's correction — not on the timeline (Stage 9 · T10), never raw.
  expect(silentOnTimeline('note', { kind: 'receiver_swap', team_side: 'A' })).toBe(true);
  expect(timelineLine('note', { kind: 'receiver_swap', team_side: 'A' }, ctx('tennis')).text).toBe('↔ Lions: receivers swapped');
  expect(fs.readFileSync(path.join(__dirname, '../controllers/matches.controller.ts'), 'utf8')).toContain('if (silentOnTimeline(ev.event_type as string, p)) continue;');
  expect(fs.readFileSync(path.join(__dirname, '../controllers/matches.controller.ts'), 'utf8')).not.toContain('JSON.stringify(p).slice(0, 80)');
  expect(timelineLine('note', { game: 1, kind: 'game_end', winner: 'A', next_first: 'B' }, ctx('cricket')).text).toBe('🏁 End of game 1 — Lions won it · Tigers bat first in game 2'); // #112
  expect(timelineLine('serve_swap', { kind: 'partner', team_side: 'B' }, ctx('tennis')).text).toBe('🔁 Tigers: the other partner serves'); // #113
  expect(timelineLine('note', { kind: 'clock_adjust', seconds: 0 }, ctx('chess')).text).toBe('⏱ Clock checked — no change'); // #114
  expect(timelineLine('note', { kind: 'add_time', side: 'A', seconds: 0 }, ctx('chess')).text).toBe('⏱ Lions: no time added');
  expect(timelineLine('note', { kind: 'kickoff' }, ctx('hockey')).text).toBe('⏱ Push-back'); // #123
  expect(timelineLine('note', { kind: 'kickoff' }, ctx('football')).text).toBe('⏱ Kick-off');
  expect(timelineLine('note', { kind: 'serve_order', server: 1, receiver: 2 }, ctx('tabletennis')).text).toMatch(/^🏓 /); // #128
  expect(timelineLine('note', { kind: 'serve_order', server: 1, receiver: 2 }, ctx('pickleball')).text).toMatch(/^🥒 /);
  expect(timelineLine('note', { kind: 'libero', team_side: 'A' }, ctx('volleyball')).text).toBe('🔄 Libero in — Lions'); // #137
  // #136
  expect(timelineLine('extra', { type: 'B', runs: 2 }, ctx('cricket')).text).toBe('2 byes');
  expect(timelineLine('extra', { type: 'Lb', runs: 1 }, ctx('cricket')).text).toBe('1 leg bye');
  expect(timelineLine('extra', { type: 'Wd', runs: 3, penalty: 1 }, ctx('cricket')).text).toBe('3 wides');
  expect(timelineLine('extra', { type: 'Wd', runs: 1, penalty: 1 }, ctx('cricket')).text).toBe('Wide');
  expect(timelineLine('ball', { runs: 4, boundary: false }, ctx('cricket'))).toEqual({ text: '4 runs, all run', isWicket: false, isBoundary: false });
  expect(timelineLine('ball', { runs: 4 }, ctx('cricket'))).toEqual({ text: 'FOUR!', isWicket: false, isBoundary: true });
});
