/**
 * SC-403 · a filter spelled the other way must be APPLIED, not silently dropped.
 *
 * Live proof of the bug: GET /tournaments?sportId=<cricket> returned all 899
 * tournaments with a 200, instead of the 182 cricket ones, because the
 * controller reads `sport_id` and Express ignores params nobody reads. The
 * caller cannot tell a dropped filter from a genuinely large result set.
 */
import { queryAliases } from '../middleware/queryAliases.middleware';

function run(query: Record<string, unknown>) {
  const req: any = {};
  Object.defineProperty(req, 'query', { value: query, configurable: true, writable: true });
  const next = jest.fn();
  queryAliases(req, {} as any, next);
  expect(next).toHaveBeenCalled();
  return req.query as Record<string, unknown>;
}

describe('queryAliases', () => {
  it('exposes sport_id when the caller wrote sportId (the live bug)', () => {
    expect(run({ sportId: 'abc' }).sport_id).toBe('abc');
  });

  it('exposes sportId when the caller wrote sport_id', () => {
    expect(run({ sport_id: 'abc' }).sportId).toBe('abc');
  });

  it('keeps the original spelling intact', () => {
    const q = run({ sportId: 'abc' });
    expect(q.sportId).toBe('abc');
  });

  it('never overwrites an explicitly supplied twin', () => {
    const q = run({ sport_id: 'canonical', sportId: 'other' });
    expect(q.sport_id).toBe('canonical');
    expect(q.sportId).toBe('other');
  });

  it('handles multi-word keys in both directions', () => {
    expect(run({ tournamentId: 't1' }).tournament_id).toBe('t1');
    expect(run({ match_status_filter: 'live' }).matchStatusFilter).toBe('live');
  });

  it('leaves single-word params untouched', () => {
    const q = run({ limit: '20', offset: '40', q: 'pune' });
    expect(Object.keys(q).sort()).toEqual(['limit', 'offset', 'q']);
  });

  it('preserves camelCase params that are already canonical (userId, matchId)', () => {
    const q = run({ userId: 'u1', matchId: 'm1' });
    expect(q.userId).toBe('u1');
    expect(q.matchId).toBe('m1');
    expect(q.user_id).toBe('u1');
    expect(q.match_id).toBe('m1');
  });

  it('handles digits in keys without mangling them', () => {
    expect(run({ sport_id2: 'x' }).sportId2).toBe('x');
  });

  it('tolerates an empty query', () => {
    expect(run({})).toEqual({});
  });

  it('does not throw when query is missing entirely', () => {
    const req: any = {};
    const next = jest.fn();
    expect(() => queryAliases(req, {} as any, next)).not.toThrow();
    expect(next).toHaveBeenCalled();
  });
});
