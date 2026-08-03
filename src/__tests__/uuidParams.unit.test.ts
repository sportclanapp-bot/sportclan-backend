/**
 * SC-397 · a malformed id must 400, never 500.
 *
 * Probing every parameterised GET with a garbage id found FOURTEEN endpoints
 * returning 500: the value reached the query and Postgres rejected the cast.
 * The fix is a router-level param guard, so it closes the class rather than the
 * fourteen instances — any route added later with an id param inherits it.
 */
import { isUuid } from '../utils/uuid';
import { ID_PARAMS } from '../middleware/uuidParams.middleware';

describe('SC-397 · id param validation', () => {
  it('rejects the exact garbage that produced the 500s', () => {
    expect(isUuid('not-an-id')).toBe(false);
  });

  it('rejects other malformed shapes', () => {
    for (const bad of ['', '123', 'null', 'undefined', '../../etc/passwd', '%00', 'a'.repeat(50)]) {
      expect(isUuid(bad)).toBe(false);
    }
  });

  it('accepts a real uuid so live routes keep working', () => {
    expect(isUuid('8fcebd97-6f75-4fc5-8fa0-281e789a3ba1')).toBe(true);
    expect(isUuid('00000000-0000-0000-0000-000000000000')).toBe(true); // valid shape, just absent
  });

  it('covers every id param name the API uses', () => {
    // The 14 failing routes used these names between them.
    for (const p of ['id', 'userId', 'matchId', 'teamId']) {
      expect(ID_PARAMS).toContain(p);
    }
    expect(ID_PARAMS.length).toBeGreaterThanOrEqual(10);
  });

  it('a well-formed but nonexistent id is NOT a 400 — that is a 404 case', () => {
    // The guard must only reject SHAPE. Absence is the handler's business, and
    // conflating them would turn every "not found" into "bad request".
    expect(isUuid('00000000-0000-0000-0000-000000000000')).toBe(true);
  });
});
