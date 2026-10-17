/**
 * E-076 (Round 6): only chess's three desk roles were checked against the sport. The server took a
 * deputy for volleyball / basketball / hockey and an assistant for carrom, which the app says those
 * sports don't have.
 */
import { mock, res } from './r6Mock';
jest.mock('../utils/supabase', () => require('./r6Mock').supabaseStandIn());
jest.mock('../utils/notify', () => ({ notifyUnlessBlocked: jest.fn(async () => undefined) }));
let slug = 'volleyball';
jest.mock('../utils/sportCache', () => ({ ...jest.requireActual('../utils/sportCache'), getSport: jest.fn(async () => ({ slug })) }));
// eslint-disable-next-line import/first
import { addTournamentOfficial } from '../controllers/features.controller';

const T = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const ME = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
const PERSON = 'cccccccc-cccc-4ccc-8ccc-cccccccccccc';
beforeEach(() => {
  mock.log = [];
  mock.next = (q) => {
    if (q[0] === 'from:tournaments') return { data: { id: T, created_by: ME, sport_id: 's1', parent_id: null, name: 'Cup' } };
    if (q[0] === 'from:users') return { data: { id: PERSON } };
    if (q[0] === 'from:tournament_officials') return { data: { id: 'o1', role: 'x' } };
    return { data: [] };
  };
});
const add = async (sport: string, role: string) => {
  slug = sport;
  const r = res();
  await addTournamentOfficial({ userId: ME, params: { id: T }, body: { user_id: PERSON, role }, query: {} } as any, r);
  return r;
};
const inserted = () => mock.log.some((q) => q[0] === 'from:tournament_officials' && q.some((c) => c.startsWith('insert')));

test.each([['volleyball', 'deputy_referee'], ['basketball', 'deputy_referee'], ['hockey', 'deputy_referee'], ['football', 'deputy_referee'], ['carrom', 'assistant']])(
  '%s has no %s: 400 ROLE_NOT_IN_SPORT and nothing saved', async (sport, role) => {
    const r = await add(sport, role);
    expect(r.statusCode).toBe(400);
    expect(r.body.code).toBe('ROLE_NOT_IN_SPORT');
    expect(inserted()).toBe(false);
  });
test.each([['badminton', 'deputy_referee'], ['chess', 'deputy_referee'], ['carrom', 'deputy_referee'], ['volleyball', 'assistant'], ['tabletennis', 'assistant'], ['carrom', 'umpire'], ['chess', 'pairings']])(
  '%s has %s: it is added', async (sport, role) => {
    const r = await add(sport, role);
    expect(r.statusCode).toBe(200);
    expect(inserted()).toBe(true);
  });
test('a sport without desk roles still refuses them', async () => {
  expect((await add('tennis', 'pairings')).body.code).toBe('ROLE_NOT_IN_SPORT');
});
