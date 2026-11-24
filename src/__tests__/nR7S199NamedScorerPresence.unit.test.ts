/**
 * N-R7-S199 (Step 3 final pass, SIDE-X12-1, X1-S14 on emulator-5558 + 5560): a casual football match scored by its
 * NAMED scorer (fx_o1); their phone dropped, and the viewer — the creator, app open — still read 'No scoring for 10m'
 * instead of 'Scorer may be offline', because presence was read for [creator, umpire] only. It now follows the lease
 * holder, else the named scorer (the creator when none is named) and the umpire.
 */
import { fakeDb } from './helpers/fakeSupabase';

let db = fakeDb();
jest.mock('../utils/supabase', () => ({ get supabase() { return db.client; } }));

// eslint-disable-next-line import/first
import { getMatchLiveStatus, QUIET_AFTER_MS } from '../utils/liveStatus';

const iso = (agoMs: number) => new Date(Date.now() - agoMs).toISOString();
const quietEvents = [{ id: 'e1', match_id: 'm1', created_at: iso(QUIET_AFTER_MS + 120_000) }];

it('named scorer offline, creator online: the scorer looks offline', async () => {
  db = fakeDb({
    match_events: quietEvents, match_event_audit: [],
    match_scoring_leases: [{ match_id: 'm1', user_id: 'scorer' }],
    users: [{ id: 'creator', last_active_at: iso(5_000) }, { id: 'scorer', last_active_at: iso(10 * 60_000) }],
  });
  const s = await getMatchLiveStatus({ id: 'm1', status: 'live', created_by: 'creator', umpire_id: null, scorer_id: 'scorer' } as never);
  expect(Date.parse(s.scorer_last_active_at!)).toBeLessThan(Date.now() - 9 * 60_000);
  expect(s.scorer_signal).not.toBe('quiet');
});

it('no lease row: the named scorer counts, not the creator', async () => {
  db = fakeDb({
    match_events: quietEvents, match_event_audit: [], match_scoring_leases: [],
    users: [{ id: 'creator', last_active_at: iso(5_000) }, { id: 'scorer', last_active_at: iso(10 * 60_000) }],
  });
  const s = await getMatchLiveStatus({ id: 'm1', status: 'live', created_by: 'creator', umpire_id: null, scorer_id: 'scorer' } as never);
  expect(Date.parse(s.scorer_last_active_at!)).toBeLessThan(Date.now() - 9 * 60_000);
});

it('no named scorer: the creator counts as before', async () => {
  db = fakeDb({
    match_events: quietEvents, match_event_audit: [], match_scoring_leases: [],
    users: [{ id: 'creator', last_active_at: iso(5_000) }],
  });
  const s = await getMatchLiveStatus({ id: 'm1', status: 'live', created_by: 'creator', umpire_id: null });
  expect(Date.parse(s.scorer_last_active_at!)).toBeGreaterThan(Date.now() - 60_000);
});
