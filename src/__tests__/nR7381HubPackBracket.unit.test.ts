/**
 * N-R7-381 (Step 2 B13, SIDE-B13-1): the hub's offline pack carries each fixture's `bracket`
 * (a double elimination's 'back' / 'final' / 'reset'), so the hub names a DE fixture as the bracket does —
 * it counted rounds from the end ('Quarter-final' for the main final, 'Final' for the reset).
 */
import { mock, res } from './r6Mock';
jest.mock('../utils/supabase', () => require('./r6Mock').supabaseStandIn());
// eslint-disable-next-line import/first
import { getOfflinePack } from '../controllers/tournamentHub.controller';

const T = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const CREATOR = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
beforeEach(() => {
  mock.log = [];
  mock.next = (q) => {
    if (q[0] === 'from:tournaments') return { data: { id: T, created_by: CREATOR, parent_id: null } };
    if (q[0] === 'from:matches') return { data: [{ id: 'm1', round: 1, bracket: 'back' }] };
    if (q[0] === 'from:tournament_organisers' || q[0] === 'from:tournament_entries' || q[0] === 'from:device_signing_keys') return { data: [] };
    return { data: null };
  };
});

test('the pack’s fixtures say which part of a double elimination they are', async () => {
  const r = res();
  await getOfflinePack({ userId: CREATOR, params: { id: T }, header: () => undefined } as any, r);
  expect(r.statusCode ?? 200).toBe(200);
  const matchesQ = mock.log.find((q) => q[0] === 'from:matches')!;
  expect(matchesQ.find((c) => c.startsWith('select:'))).toMatch(/\bbracket\b/);
});
