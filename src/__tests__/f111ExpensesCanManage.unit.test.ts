/**
 * F111 (launch test plan): a captain's Edit / Delete on others' expenses came from the team page,
 * and when that read failed they silently lost them. The expense list says `can_manage` itself now.
 */
let mockRole: string | null = 'captain';
jest.mock('../utils/supabase', () => ({
  supabase: {
    from: jest.fn((t: string) => {
      const chain: any = {};
      for (const m of ['select', 'eq', 'order', 'range']) chain[m] = jest.fn(() => chain);
      chain.maybeSingle = jest.fn(async () => ({ data: t === 'team_members' ? { id: 'm1' } : null, error: null }));
      chain.then = (ok: (v: unknown) => unknown) => Promise.resolve(ok({ data: t === 'team_expenses' ? [{ id: 'e1', created_by: 'other' }] : [], error: null }));
      return chain;
    }),
  },
}));
jest.mock('../utils/teamAuth', () => ({
  ...jest.requireActual('../utils/teamAuth'),
  isTeamManager: jest.fn(async () => mockRole === 'captain' || mockRole === 'vice_captain'),
}));
// eslint-disable-next-line import/first
import { listExpenses } from '../controllers/teamExpenses.controller';

const call = async () => {
  const r: any = { statusCode: 200, body: null };
  r.status = (c: number) => { r.statusCode = c; return r; };
  r.json = (b: unknown) => { r.body = b; return r; };
  await listExpenses({ userId: 'me', params: { id: 't1' }, query: {}, body: {} } as never, r);
  return r;
};

test.each([['captain', true], ['vice_captain', true], ['player', false]])('a %s: can_manage %s', async (role, can) => {
  mockRole = role;
  const r = await call();
  expect(r.statusCode).toBe(200);
  expect(r.body).toEqual({ expenses: [{ id: 'e1', created_by: 'other' }], can_manage: can });
});
