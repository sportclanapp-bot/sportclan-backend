/**
 * N-R7-S129 (Step 2 B10, SIDE-X7b-KICKOFF + SIDE-X7b-UNDOSTART, follow-ups of N-R7-268):
 * - the scoring log named an undone chess clock start 'undid: kickoff' (football's word) → 'clock start';
 * - after Undo of the start (no move left) the pad is READY but the server stayed 'live' with 0 events,
 *   so Match detail read LIVE · In progress + an idle banner → a chess game with nothing that starts play
 *   left goes back to scheduled. Other sports, finished / voided games and games with a move are untouched.
 */
import fs from 'fs';
import path from 'path';

let match: Record<string, unknown> | null = null;
let slug = 'chess';
let rest: Array<{ event_type: string; payload: unknown }> = [];
const updates: Array<{ row: unknown; eqs: unknown[][] }> = [];
jest.mock('../utils/supabase', () => ({
  supabase: {
    from: (table: string) => {
      const q: any = {}; let cur: { row: unknown; eqs: unknown[][] } | null = null;
      q.select = () => q;
      q.eq = (...a: unknown[]) => { cur?.eqs.push(a); return q; };
      q.update = (row: unknown) => { cur = { row, eqs: [] }; if (table === 'matches') updates.push(cur); return q; };
      q.maybeSingle = () => Promise.resolve({ data: match, error: null });
      q.then = (r: (v: unknown) => void) => r({ error: null });
      return q;
    },
  },
}));
jest.mock('../utils/sportCache', () => ({
  getSport: async () => ({ slug }),
  normSportSlug: (s?: string | null) => String(s ?? '').replace(/[-_\s]/g, '').toLowerCase(),
}));
jest.mock('../utils/matchEventsAll', () => ({ matchEventsAll: async () => rest }));
// eslint-disable-next-line import/first
import { unstartChessIfNoPlay } from '../controllers/scoring.controller';
// eslint-disable-next-line import/first
import { describeEvent } from '../utils/editLog';

const code = (f: string) => fs.readFileSync(path.join(__dirname, '..', f), 'utf8').replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*$/gm, '');
const fnBody = (f: string, name: string) => { const s = code(f); const i = s.indexOf(`function ${name}(`); const j = s.indexOf('\nexport ', i + 10); return s.slice(i, j < 0 ? undefined : j); };
beforeEach(() => { match = { sport_id: 's', status: 'live', voided_at: null }; slug = 'chess'; rest = []; updates.length = 0; });

describe('N-R7-S129 · chess clock start in the log', () => {
  const ctx = (sport: string) => ({ sport, teamA: 'White P', teamB: 'Black P' });
  test("chess reads 'clock start', never 'kickoff'", () => {
    expect(describeEvent('note', { kind: 'kickoff', played_at: '2026-11-10T14:25:00Z' }, ctx('chess'))).toBe('clock start');
  });
  test('football keeps its kickoff', () => {
    expect(describeEvent('note', { kind: 'kickoff' }, ctx('football'))).toBe('kickoff');
  });
});

describe('N-R7-S129 · undoing the start puts a chess game back to scheduled', () => {
  test('0 events left → scheduled (only if still live)', async () => {
    expect(await unstartChessIfNoPlay('m1')).toBe(true);
    expect(updates).toEqual([{ row: { status: 'scheduled' }, eqs: [['id', 'm1'], ['status', 'live']] }]);
  });
  test('only pre-play notes left → scheduled', async () => {
    rest = [{ event_type: 'note', payload: { kind: 'warmup' } }];
    expect(await unstartChessIfNoPlay('m1')).toBe(true);
  });
  test('a move or the start still there → stays live', async () => {
    for (const e of [{ event_type: 'move', payload: { side: 'W' } }, { event_type: 'note', payload: { kind: 'kickoff' } }]) {
      rest = [e]; updates.length = 0;
      expect(await unstartChessIfNoPlay('m1')).toBe(false);
      expect(updates).toEqual([]);
    }
  });
  test('other sports, finished and voided games untouched', async () => {
    slug = 'football'; expect(await unstartChessIfNoPlay('m1')).toBe(false);
    slug = 'chess'; match = { sport_id: 's', status: 'completed', voided_at: null }; expect(await unstartChessIfNoPlay('m1')).toBe(false);
    match = { sport_id: 's', status: 'live', voided_at: '2026-11-10' }; expect(await unstartChessIfNoPlay('m1')).toBe(false);
    expect(updates).toEqual([]);
  });
  test('both undo paths call it after the delete', () => {
    expect(fnBody('controllers/matchFeatures.controller.ts', 'deleteMatchEvent')).toMatch(/logThenDeleteEvent[\s\S]*unstartChessIfNoPlay\(id\)/);
    expect(fnBody('controllers/scoring.controller.ts', 'undoEvent')).toMatch(/logThenDeleteEvent[\s\S]*unstartChessIfNoPlay\(matchId\)/);
  });
});
