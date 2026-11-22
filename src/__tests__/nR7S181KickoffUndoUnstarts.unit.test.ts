/**
 * N-R7-S181 (Step 3 final pass, SIDE-A5r6-1, SP-BKB-134 on emulator-5558): undoing basketball's '⏱ TIP-OFF · start the
 * clock' (the only event) put the pad back to READY but the match stayed 'live' with 0 events, so the header read
 * 'BASKETBALL · LIVE'. The kick-off sports (football, hockey, basketball) now follow chess (N-R7-S129): with nothing
 * that starts play left after an undo, the match goes back to scheduled. Point sports keep their status.
 */
let match: Record<string, unknown> | null = null;
let slug = 'basketball';
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

beforeEach(() => { match = { sport_id: 's', status: 'live', voided_at: null }; rest = []; updates.length = 0; });

test.each(['basketball', 'hockey', 'football'])('%s: the start undone, nothing left → scheduled', async (s) => {
  slug = s;
  expect(await unstartChessIfNoPlay('m1')).toBe(true);
  expect(updates).toEqual([{ row: { status: 'scheduled' }, eqs: [['id', 'm1'], ['status', 'live']] }]);
});

test('a basket or the tip-off still there → stays live', async () => {
  slug = 'basketball';
  for (const e of [{ event_type: 'score', payload: { points: 2 } }, { event_type: 'note', payload: { kind: 'kickoff' } }]) {
    rest = [e]; updates.length = 0;
    expect(await unstartChessIfNoPlay('m1')).toBe(false);
    expect(updates).toEqual([]);
  }
});

test.each(['badminton', 'tennis', 'cricket', 'volleyball'])('%s keeps its status after an undo', async (s) => {
  slug = s;
  expect(await unstartChessIfNoPlay('m1')).toBe(false);
  expect(updates).toEqual([]);
});
