/**
 * Badminton gap 1 · what an event shares with its tournament: the organisers
 * (co-organisers are kept on the parent), the officials (a scorer works every
 * event) and the one chat (everyone in any event).
 */
type Q = string[];
let mockLog: Q[] = [];
let mockNext: (q: Q) => { data?: unknown; error?: unknown } = () => ({ data: null });
jest.mock('../utils/supabase', () => {
  const start = (t: string) => {
    const q: string[] = [`from:${t}`];
    mockLog.push(q);
    const chain: any = {};
    for (const m of ['select', 'in', 'eq', 'is', 'limit', 'maybeSingle', 'order', 'range']) {
      chain[m] = jest.fn((...a: unknown[]) => { q.push(`${m}:${JSON.stringify(a)}`); return chain; });
    }
    chain.then = (ok: (v: unknown) => unknown) => Promise.resolve(ok({ data: null, error: null, ...mockNext(q) }));
    return chain;
  };
  return { supabase: { from: jest.fn(start) } };
});
// eslint-disable-next-line import/first
import { isTournamentOrganiser, isTournamentScorer } from '../utils/tournamentAuth';
// eslint-disable-next-line import/first
import { tournamentChatAudience } from '../utils/tournamentChat';

const P = 'parent';
const E = 'event';
const arg = (q: Q, m: string) => JSON.parse(q.filter((c) => c.startsWith(`${m}:`)).pop()!.slice(m.length + 1));
beforeEach(() => { mockLog = []; });

test('a co-organiser of the tournament organises each event', async () => {
  mockNext = (q) => {
    if (q[0] === 'from:tournaments') return { data: { created_by: 'owner', parent_id: P } };
    if (q[0] === 'from:tournament_organisers') return { data: arg(q, 'in')[1].includes(P) ? [{ user_id: 'co' }] : [] };
    return { data: null };
  };
  expect(await isTournamentOrganiser(E, 'co')).toBe(true);
  expect(arg(mockLog.find((q) => q[0] === 'from:tournament_organisers')!, 'in')).toEqual(['tournament_id', [E, P]]);
  expect(await isTournamentOrganiser(E, 'owner')).toBe(true);
});

test('a plain tournament checks only its own co-organisers (as before)', async () => {
  mockNext = (q) => (q[0] === 'from:tournaments' ? { data: { created_by: 'owner', parent_id: null } } : { data: [] });
  expect(await isTournamentOrganiser('solo', 'someone')).toBe(false);
  expect(arg(mockLog.find((q) => q[0] === 'from:tournament_organisers')!, 'in')).toEqual(['tournament_id', ['solo']]);
});

test('the tournament’s scorer scores every event', async () => {
  mockNext = (q) => {
    if (q[0] === 'from:tournaments') return { data: { id: E, parent_id: P } };
    if (q[0] === 'from:tournament_officials') return { data: arg(q, 'in')[1].includes(P) ? [{ id: 'o' }] : [] };
    return { data: null };
  };
  expect(await isTournamentScorer(E, 'sc')).toBe(true);
});

test('one chat: the organisers and the players of every event', async () => {
  mockNext = (q) => {
    if (q[0] === 'from:tournaments' && q.some((c) => c.startsWith('select:["id, parent_id, is_parent"]'))) return { data: { id: E, parent_id: P, is_parent: false } };
    if (q[0] === 'from:tournaments' && arg(q, 'eq')[0] === 'parent_id') return { data: [{ id: E }, { id: 'event-2' }] };
    if (q[0] === 'from:tournaments') return { data: { created_by: 'owner' } };
    if (q[0] === 'from:tournament_organisers') return { data: [{ user_id: 'co' }] };
    if (q[0] === 'from:tournament_entries') return { data: [{ team_id: 't1' }, { team_id: 't2' }] };
    if (q[0] === 'from:team_members') return { data: [{ user_id: 'p1' }, { user_id: 'p2' }] };
    return { data: null };
  };
  const a = await tournamentChatAudience(E);
  expect([...a!.organisers].sort()).toEqual(['co', 'owner']);
  expect([...a!.players].sort()).toEqual(['p1', 'p2']);
  const entries = mockLog.find((q) => q[0] === 'from:tournament_entries')!;
  expect(arg(entries, 'in')).toEqual(['tournament_id', [P, E, 'event-2']]);
});
