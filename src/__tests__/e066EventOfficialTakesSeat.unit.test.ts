/**
 * E-066 / E-108 (Round 6): a tournament's officials are kept on the tournament (the parent), so on a
 * fixture of one of its EVENTS (a badminton Men's doubles) selfOfficiateMode looked them up on the
 * event, found none, and the official got 'none' (403 ORGANISER_NAMES_OFFICIALS).
 */
import { mock } from './r6Mock';
jest.mock('../utils/supabase', () => require('./r6Mock').supabaseStandIn());
// eslint-disable-next-line import/first
import { selfOfficiateMode } from '../controllers/matches.controller';

const ROOT = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const EVENT = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
const OFFICIAL = 'cccccccc-cccc-4ccc-8ccc-cccccccccccc';
const ORGANISER = 'dddddddd-dddd-4ddd-8ddd-dddddddddddd';

beforeEach(() => {
  mock.log = [];
  mock.next = (q) => {
    if (q[0] === 'from:tournaments') {
      const isEvent = q.some((c) => c.includes(EVENT));
      return { data: isEvent ? { id: EVENT, created_by: ORGANISER, parent_id: ROOT } : { id: ROOT, created_by: ORGANISER, parent_id: null } };
    }
    if (q[0] === 'from:tournament_organisers') return { data: [] };
    // The official's row is on the parent tournament only.
    if (q[0] === 'from:tournament_officials') return { data: q.some((c) => c.includes(ROOT)) && q.some((c) => c.includes(OFFICIAL)) ? [{ role: 'umpire' }] : [] };
    return { data: null };
  };
});

test('the tournament’s umpire may take the seat on a fixture of one of its events', async () => {
  expect(await selfOfficiateMode({ tournament_id: EVENT, created_by: ORGANISER }, OFFICIAL)).toBe('assign');
});
test('and still on a fixture of the tournament itself', async () => {
  expect(await selfOfficiateMode({ tournament_id: ROOT, created_by: ORGANISER }, OFFICIAL)).toBe('assign');
});
test('someone who is not its official still gets none', async () => {
  expect(await selfOfficiateMode({ tournament_id: EVENT, created_by: ORGANISER }, 'eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee')).toBe('none');
});
