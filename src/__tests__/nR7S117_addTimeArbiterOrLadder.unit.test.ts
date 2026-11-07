/**
 * N-R7-S117 · Step 2 · Batch 8 · SP-CHS-042: a plain scorer's note {kind:'add_time'} was
 * accepted (200) although the pad hides 'Add time' from a plain scorer (illegal_move /
 * wrong_claim / device results were already refused, N-R7-S20). The misconduct ladder's
 * time step sends add_time right after its 'violation' note, so a non-arbiter's add_time is
 * accepted only as that penalty: straight after a 'time' step of the other player's
 * misconduct, with the game's penalty seconds. The arbiter / organiser may add any time.
 */
let mayDefault = false;
let latest: Array<Record<string, unknown>> = [];
const chain = () => {
  const c: Record<string, unknown> = {};
  for (const k of ['select', 'eq', 'order']) c[k] = jest.fn(() => c);
  c.limit = jest.fn(async () => ({ data: latest, error: null }));
  return c;
};
jest.mock('../utils/supabase', () => ({ supabase: { from: jest.fn(() => chain()) } }));
jest.mock('../utils/sportCache', () => ({ ...jest.requireActual('../utils/sportCache'), getSport: jest.fn(async () => ({ slug: 'chess' })) }));
jest.mock('../utils/tournamentAuth', () => ({ ...jest.requireActual('../utils/tournamentAuth'), canDefault: jest.fn(async () => mayDefault) }));
// eslint-disable-next-line import/first
import { validateScoringEvent, ladderTimePenaltyOk } from '../controllers/scoring.controller';
// eslint-disable-next-line import/first
import { standardRules } from '../utils/matchRules';

const rapid = { ...standardRules('chess'), baseMinutes: 15, incrementSeconds: 10 };
const m = { id: 'm', status: 'live', sport_id: 's', tournament_id: null, team_a_id: null, team_b_id: null, rules: rapid, score_summary: {} };
const addTime = (side: 'A' | 'B', seconds = 60) => ({ event_type: 'note', payload: { kind: 'add_time', side, seconds } });
const violation = (side: 'A' | 'B', penalty = 'time') => ({ event_type: 'note', payload: { kind: 'violation', team_side: side, offence: 'conduct', penalty, n: 2 }, client_key: 'v1' });

beforeEach(() => { mayDefault = false; latest = []; });

test('a plain scorer’s add_time on its own → 403 NOT_ARBITER', async () => {
  latest = [{ event_type: 'move', payload: { side: 'A' } }];
  const r = await validateScoringEvent('m', m as never, addTime('A'), 'scorer');
  expect(r?.status).toBe(403);
  expect(r?.body.code).toBe('NOT_ARBITER');
  latest = [];
  expect((await validateScoringEvent('m', m as never, addTime('A'), 'scorer'))?.body.code).toBe('NOT_ARBITER');
});

test('the ladder’s time step: right after the other player’s time-penalty misconduct note, with the penalty seconds → accepted', async () => {
  latest = [violation('B')];
  expect(await validateScoringEvent('m', m as never, addTime('A', 60), 'scorer')).toBeNull();
});

test('not to the offender, not a warning, not more than the penalty, not twice', async () => {
  latest = [violation('A')];
  expect((await validateScoringEvent('m', m as never, addTime('A', 60), 'scorer'))?.body.code).toBe('NOT_ARBITER');
  latest = [violation('B', 'warning')];
  expect((await validateScoringEvent('m', m as never, addTime('A', 60), 'scorer'))?.body.code).toBe('NOT_ARBITER');
  latest = [violation('B')];
  expect((await validateScoringEvent('m', m as never, addTime('A', 600), 'scorer'))?.body.code).toBe('NOT_ARBITER');
  latest = [{ ...addTime('A', 60), client_key: 'a1' }, violation('B')];
  expect((await validateScoringEvent('m', m as never, addTime('A', 60), 'scorer', { clientKey: 'a2' }))?.body.code).toBe('NOT_ARBITER');
});

test('the same add_time sent again (its key already stored) is still accepted, so the outbox’s retry dedupes', async () => {
  latest = [{ ...addTime('A', 60), client_key: 'a1' }, violation('B')];
  expect(await validateScoringEvent('m', m as never, addTime('A', 60), 'scorer', { clientKey: 'a1' })).toBeNull();
});

test('a QR hand-over: the op before it in the same code counts', async () => {
  latest = [];
  expect(await validateScoringEvent('m', m as never, addTime('A', 60), 'scorer', { batch: true, prev: violation('B') })).toBeNull();
  expect((await validateScoringEvent('m', m as never, addTime('A', 60), 'scorer', { batch: true, prev: { event_type: 'move', payload: {} } }))?.body.code).toBe('NOT_ARBITER');
});

test('a classical game’s penalty is 2 minutes', () => {
  const classical = { ...m, rules: { ...standardRules('chess'), baseMinutes: 90, incrementSeconds: 30 } };
  expect(ladderTimePenaltyOk(classical as never, { kind: 'add_time', side: 'A', seconds: 120 }, violation('B'))).toBe(true);
  expect(ladderTimePenaltyOk(classical as never, { kind: 'add_time', side: 'A', seconds: 60 }, violation('B'))).toBe(false);
});

test('the arbiter or the organiser adds any time', async () => {
  mayDefault = true;
  latest = [{ event_type: 'move', payload: { side: 'A' } }];
  expect(await validateScoringEvent('m', m as never, addTime('B', 300), 'arbiter')).toBeNull();
});
