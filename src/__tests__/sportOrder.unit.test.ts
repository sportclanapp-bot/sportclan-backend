/**
 * GET /sports returns sports in the app's one order (Home's, Cricket first),
 * not the drifted display_order (Cricket, Football, Basketball, …).
 */
const DB_ROWS = [
  ['cricket', 1], ['football', 2], ['basketball', 3], ['badminton', 4], ['tennis', 5], ['table-tennis', 6],
  ['volleyball', 7], ['hockey', 8], ['kabaddi', 9], ['chess', 10], ['athletics', 11], ['pickleball', 12], ['carrom', 13],
].map(([slug, display_order]) => ({ id: `s-${slug}`, slug, display_order, is_active: !['kabaddi', 'athletics'].includes(slug as string) }));

jest.mock('../utils/supabase', () => {
  const chain: any = {};
  chain.from = jest.fn(() => chain);
  chain.select = jest.fn(() => chain);
  chain.order = jest.fn(async () => ({ data: DB_ROWS, error: null }));
  return { supabase: chain };
});

import router from '../routes/sports.routes';
import { SPORT_ORDER, sortSports } from '../constants/sportOrder';

const handler = (router as any).stack[0].route.stack[0].handle;

test('GET /sports: the active sports in the one order', async () => {
  let body: any;
  const res: any = { status: () => res, json: (b: unknown) => { body = b; return res; } };
  await handler({}, res);
  expect(body.sports.map((s: { slug: string }) => s.slug)).toEqual([...SPORT_ORDER]);
});

test('sortSports: any spelling of a slug; unknown sports after, by display_order', () => {
  const out = sortSports([{ slug: 'kabaddi', display_order: 9 }, { slug: 'Table_Tennis', display_order: 6 }, { slug: 'zzz', display_order: 1 }, { slug: 'cricket', display_order: 5 }]);
  expect(out.map((r) => r.slug)).toEqual(['cricket', 'Table_Tennis', 'zzz', 'kabaddi']);
});

test('the order matches the app’s (src/utils/sportOrder.ts, theme sportSlugs)', () => {
  expect(SPORT_ORDER.map((s) => s.replace('-', ''))).toEqual(['cricket', 'badminton', 'football', 'tennis', 'tabletennis', 'pickleball', 'chess', 'carrom', 'volleyball', 'basketball', 'hockey']);
});
