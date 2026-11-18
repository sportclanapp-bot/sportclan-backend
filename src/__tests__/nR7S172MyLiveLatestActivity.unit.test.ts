/**
 * N-R7-S172 (Step 2 FINAL SIDE-C9b-1, case SP-CRM-C04): Home's live ticker is the
 * first of GET /matches/my-live, which ordered your live matches by scheduled_at.
 * A match scheduled yesterday that you started scoring a minute ago sat behind
 * every live match scheduled later (297 of them for the tester), so it was in
 * neither the ticker nor the first 'More live' cards. Within each tie (play in /
 * created / follow) the order is now the latest scoring activity first: updated_at,
 * which every scoring event bumps, falling back to scheduled_at. Nothing is dropped.
 */
import { sortMyLive } from '../utils/nextMatch';

describe('N-R7-S172 · your live matches, latest activity first', () => {
  test('the match scored a minute ago comes first, though it was scheduled yesterday', () => {
    const others = Array.from({ length: 297 }, (_, i) => ({
      id: `m-${String(i).padStart(3, '0')}`, relation: 'plays' as const,
      scheduled_at: '2026-11-18T08:00:00Z', updated_at: '2026-11-18T08:05:00Z',
    }));
    const scoring = { id: 'crm', relation: 'plays' as const, scheduled_at: '2026-11-17T10:00:00Z', updated_at: '2026-11-18T09:19:00Z' };
    const out = sortMyLive([...others, scoring]);
    expect(out[0].id).toBe('crm');
    expect(out).toHaveLength(298); // every one still there, no cap
  });
  test('the tie still leads: a followed match scored just now stays after the ones you play in', () => {
    const out = sortMyLive([
      { id: 'f', relation: 'follows' as const, scheduled_at: '2026-11-18T09:00:00Z', updated_at: '2026-11-18T09:30:00Z' },
      { id: 'p', relation: 'plays' as const, scheduled_at: '2026-11-17T09:00:00Z', updated_at: '2026-11-18T09:00:00Z' },
    ]);
    expect(out.map((r) => r.id)).toEqual(['p', 'f']);
  });
  test('no updated_at: scheduled_at as before; undated last', () => {
    const out = sortMyLive([
      { id: 'none', relation: 'plays' as const, scheduled_at: null },
      { id: 'old', relation: 'plays' as const, scheduled_at: '2026-11-01T09:00:00Z' },
      { id: 'new', relation: 'plays' as const, scheduled_at: '2026-11-10T08:00:00Z' },
    ]);
    expect(out.map((r) => r.id)).toEqual(['new', 'old', 'none']);
  });
});
