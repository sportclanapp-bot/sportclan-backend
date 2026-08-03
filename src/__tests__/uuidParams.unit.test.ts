/**
 * SC-403 · the UUID param guard must not eat legitimate non-UUID path params.
 *
 * SC-397 added `sportId` to the guarded list on the assumption that a param
 * named `<thing>Id` holds a UUID. It does not: /users/:id/sport-profile/:sportId
 * takes a slug ('cricket', 'tabletennis') that resolveSportId maps server-side.
 * The guard turned every such call into 400 INVALID_ID in production and broke
 * the Sport Hub "your rank" card.
 */
import { ID_PARAMS } from '../middleware/uuidParams.middleware';

describe('ID_PARAMS', () => {
  it('does NOT guard sportId — that route legitimately takes a slug', () => {
    expect(ID_PARAMS as readonly string[]).not.toContain('sportId');
  });

  it('still guards the params that really are UUIDs', () => {
    for (const p of ['id', 'userId', 'matchId', 'teamId', 'messageId']) {
      expect(ID_PARAMS as readonly string[]).toContain(p);
    }
  });
});
