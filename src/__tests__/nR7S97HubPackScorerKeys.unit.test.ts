/**
 * N-R7-S97 (Batch 3 A8 'seen, not recorded'): the hub's offline pack carries the signing keys of the
 * phones that may sign a result — but only the organisers' and the umpires'. A fixture's named Scorer
 * (who may score it: canOfficiateMatch) was left out, so a code from a Scorer-only phone was collected
 * as 'not yet checked' instead of verified at the venue. The scorers' keys travel too.
 */
import { mock, res } from './r6Mock';
jest.mock('../utils/supabase', () => require('./r6Mock').supabaseStandIn());
// eslint-disable-next-line import/first
import { getOfflinePack } from '../controllers/tournamentHub.controller';

const T = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const CREATOR = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
const UMPIRE = 'cccccccc-cccc-4ccc-8ccc-cccccccccccc';
const SCORER = 'dddddddd-dddd-4ddd-8ddd-dddddddddddd';
beforeEach(() => {
  mock.log = [];
  mock.next = (q) => {
    if (q[0] === 'from:tournaments') return { data: { id: T, created_by: CREATOR, parent_id: null } };
    if (q[0] === 'from:tournament_organisers') return { data: [] };
    if (q[0] === 'from:tournament_entries') return { data: [] };
    if (q[0] === 'from:matches') return { data: [{ id: 'm1', umpire_id: UMPIRE, scorer_id: SCORER }, { id: 'm2', umpire_id: null, scorer_id: null }] };
    if (q[0] === 'from:device_signing_keys') return { data: [] };
    return { data: null };
  };
});

test('the pack asks for the scorers’ keys as well as the organisers’ and umpires’', async () => {
  const r = res();
  await getOfflinePack({ userId: CREATOR, params: { id: T }, header: () => undefined } as any, r);
  expect(r.statusCode ?? 200).toBe(200);
  const keysQ = mock.log.find((q) => q[0] === 'from:device_signing_keys');
  const ids = JSON.parse(keysQ!.find((c) => c.startsWith('in:'))!.slice(3))[1] as string[];
  expect(ids.sort()).toEqual([CREATOR, SCORER, UMPIRE].sort());
  const matchesQ = mock.log.find((q) => q[0] === 'from:matches')!;
  expect(matchesQ.find((c) => c.startsWith('select:'))).toMatch(/scorer_id/);
});
