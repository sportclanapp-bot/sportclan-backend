/**
 * Audit #52 (11 Oct 2026): the hourly sweep abandoned tournament fixtures that
 * ran late (scheduled 48 h+ ago, or live but idle 6 h+), with no bracket move —
 * the bracket was stuck. Tournament fixtures are now left to their organiser.
 */
import { fakeDb } from './helpers/fakeSupabase';

let db = fakeDb();
jest.mock('../utils/supabase', () => ({ get supabase() { return db.client; } }));
// eslint-disable-next-line import/first
import { sweepUnplayedScheduledMatches, sweepStaleLiveMatches } from '../controllers/matches.controller';

const ago = (h: number) => new Date(Date.now() - h * 3600_000).toISOString();
describe('audit #52: the sweeps leave tournament fixtures alone', () => {
  beforeEach(() => {
    db = fakeDb({ matches: [
      { id: 'casual-old', status: 'scheduled', scheduled_at: ago(72), tournament_id: null, updated_at: ago(72) },
      { id: 'ko-late', status: 'scheduled', scheduled_at: ago(72), tournament_id: 'T1', updated_at: ago(72) },
      { id: 'casual-idle', status: 'live', scheduled_at: ago(10), tournament_id: null, updated_at: ago(8) },
      { id: 'ko-idle', status: 'live', scheduled_at: ago(10), tournament_id: 'T1', updated_at: ago(8) },
    ] });
  });
  const st = (id: string) => db.t('matches').find((m) => m.id === id)!.status;
  it('a late tournament fixture stays scheduled; an old casual match is abandoned', async () => {
    await sweepUnplayedScheduledMatches();
    expect(st('ko-late')).toBe('scheduled');
    expect(st('casual-old')).toBe('abandoned');
  });
  it('an idle live tournament fixture stays live; an idle casual match is abandoned', async () => {
    await sweepStaleLiveMatches();
    expect(st('ko-idle')).toBe('live');
    expect(st('casual-idle')).toBe('abandoned');
  });
});
