/**
 * E-128 (Round 6): a tournament chat's admins are its organisers (D7), but the sync only ever
 * promoted. A removed co-organiser who still plays, the creator after a reassign, or a player made
 * admin when the only organiser left, stayed an admin for good.
 */
import { mock } from './r6Mock';
jest.mock('../utils/supabase', () => require('./r6Mock').supabaseStandIn());
jest.mock('../utils/chatMembership', () => ({ joinChat: jest.fn(async () => undefined), leaveChat: jest.fn(async () => undefined) }));
// eslint-disable-next-line import/first
import { planChatSync, syncTournamentChatMembers } from '../utils/tournamentChat';

const aud = (organisers: string[], players: string[]) => ({ organisers: new Set(organisers), players: new Set(players) });

test('an admin who is now only a player is made a member; organisers stay admins', () => {
  const p = planChatSync(aud(['org'], ['exco', 'heir', 'p']), [
    { user_id: 'org', role: 'admin' }, { user_id: 'exco', role: 'admin' }, { user_id: 'heir', role: 'admin' }, { user_id: 'p', role: 'member' },
  ]);
  expect(p.demote.sort()).toEqual(['exco', 'heir']);
  expect(p.remove).toEqual([]);
  expect(p.promote).toEqual([]);
});

test('the sync writes the demotion', async () => {
  const T = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'; const CHAT = 'cccccccc-cccc-4ccc-8ccc-cccccccccccc';
  mock.log = [];
  mock.next = (q) => {
    const has = (x: string) => q.some((c) => c.includes(x));
    if (q[0] === 'from:tournaments') {
      if (has('"parent_id",')) return { data: [] };
      if (has('sport_metadata')) return { data: has('id, sport_metadata') ? [{ id: T, sport_metadata: { _chat_id: CHAT } }] : { sport_metadata: { _chat_id: CHAT } } };
      if (has('id, parent_id, is_parent')) return { data: { id: T, parent_id: null, is_parent: false } };
      if (has('"parent_id"')) return { data: { parent_id: null } };
      return { data: { created_by: 'org' } };
    }
    if (q[0] === 'from:tournament_organisers') return { data: [] };
    if (q[0] === 'from:tournament_entries') return { data: [{ team_id: 'team' }] };
    if (q[0] === 'from:team_members') return { data: [{ user_id: 'exco' }] };
    if (q[0] === 'from:chat_participants') return { data: [{ user_id: 'org', role: 'admin' }, { user_id: 'exco', role: 'admin' }] };
    return { data: null };
  };
  await syncTournamentChatMembers(T);
  const demoted = mock.log.find((q) => q[0] === 'from:chat_participants' && q.some((c) => c === 'update:[{"role":"member"}]'));
  expect(demoted?.some((c) => c.includes('exco'))).toBe(true);
});
