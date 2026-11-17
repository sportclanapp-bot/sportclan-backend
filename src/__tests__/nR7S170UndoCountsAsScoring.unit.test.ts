/**
 * N-R7-S170 (Step 2 FINAL SIDE-C4-1): a live match whose points were all undone
 * seconds ago told its viewers 'No scoring for a while'. The undo deletes the
 * event rows, so the newest match_events row was gone (last_event_at null) or old,
 * and the scorer signal fell to 'quiet'. An undo (or edit) is the scorer working
 * the pad: its time in the scoring edit log (match_event_audit) now counts as
 * scoring activity too.
 */
import { fakeDb } from './helpers/fakeSupabase';

let db = fakeDb();
jest.mock('../utils/supabase', () => ({ get supabase() { return db.client; } }));

// eslint-disable-next-line import/first
import { getMatchLiveStatus, QUIET_AFTER_MS } from '../utils/liveStatus';

const iso = (agoMs: number) => new Date(Date.now() - agoMs).toISOString();
const MATCH = { id: 'm1', status: 'live', created_by: 'u1', umpire_id: null };

describe('N-R7-S170 · an undo counts as scoring activity', () => {
  it('every point undone 5 s ago: last_event_at is the undo, the signal is scoring', async () => {
    db = fakeDb({
      match_events: [],
      match_event_audit: [{ id: 'a1', match_id: 'm1', action: 'undo', created_at: iso(5_000) }],
      users: [{ id: 'u1', last_active_at: iso(2_000) }],
    });
    const s = await getMatchLiveStatus(MATCH);
    expect(s.last_event_at).not.toBeNull();
    expect(s.scorer_signal).toBe('scoring');
  });

  it('an undo newer than the last remaining point is the latest activity', async () => {
    const undoAt = iso(4_000);
    db = fakeDb({
      match_events: [{ id: 'e1', match_id: 'm1', created_at: iso(QUIET_AFTER_MS + 60_000) }],
      match_event_audit: [{ id: 'a1', match_id: 'm1', action: 'undo', created_at: undoAt }],
      users: [{ id: 'u1', last_active_at: iso(2_000) }],
    });
    const s = await getMatchLiveStatus(MATCH);
    expect(s.last_event_at).toBe(undoAt);
    expect(s.scorer_signal).toBe('scoring');
  });

  it('a newer point still wins over an older undo; another match’s undo is not counted', async () => {
    const pointAt = iso(3_000);
    db = fakeDb({
      match_events: [{ id: 'e1', match_id: 'm1', created_at: pointAt }],
      match_event_audit: [
        { id: 'a1', match_id: 'm1', action: 'undo', created_at: iso(60_000) },
        { id: 'a2', match_id: 'm2', action: 'undo', created_at: iso(1_000) },
      ],
      users: [{ id: 'u1', last_active_at: iso(2_000) }],
    });
    expect((await getMatchLiveStatus(MATCH)).last_event_at).toBe(pointAt);
  });

  it('no events and no edits: still null, presence decides (unchanged)', async () => {
    db = fakeDb({ match_events: [], match_event_audit: [], users: [{ id: 'u1', last_active_at: iso(2_000) }] });
    const s = await getMatchLiveStatus(MATCH);
    expect(s.last_event_at).toBeNull();
    expect(s.scorer_signal).toBe('quiet');
  });
});
