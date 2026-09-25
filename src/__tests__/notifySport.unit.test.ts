/** Match notifications carry their sport, so the app shows that sport's icon (it showed 🏏 for all). */
jest.mock('../utils/supabase', () => {
  const chain: any = {
    select: () => chain, eq: () => chain,
    maybeSingle: async () => ({ data: { sport_id: 'bb-id' } }),
  };
  return { supabase: { from: () => chain } };
});
jest.mock('../utils/sportCache', () => ({
  getSport: async (id: string) => (id === 'bb-id' ? { id, slug: 'basketball', name: 'Basketball', allows_draw: false } : null),
  normSportSlug: (s: string | null | undefined) => (s ?? '').toLowerCase().replace(/[-_\s]/g, ''),
}));
import fs from 'fs';
import path from 'path';
import { withSport } from '../utils/notify';

test('adds the match sport to a match notification', async () => {
  expect(await withSport({ matchId: 'm1', screen: 'MatchDetail' })).toEqual({ matchId: 'm1', screen: 'MatchDetail', sport: 'basketball' });
});
test('leaves non-match notifications alone, and never overrides a given sport', async () => {
  expect(await withSport({ screen: 'Wallet' })).toEqual({ screen: 'Wallet' });
  expect(await withSport({ matchId: 'm2', sport: 'tennis' })).toEqual({ matchId: 'm2', sport: 'tennis' });
});
test('both send paths use it', () => {
  const src = fs.readFileSync(path.join(__dirname, '../utils/notify.ts'), 'utf8');
  expect(src).toContain('args = { ...args, data: await withSport(args.data) };');
  expect(src).toContain('payload = { ...payload, data: await withSport(payload.data) };');
});
