/**
 * Round 6 · E-155: a venue's "Added by" contact (and its Message button) is hidden from someone
 * blocked either way. With a block from BOTH sides the lookup matched two rows, .maybeSingle()
 * errored with no data, and the contact was shown.
 */
import { mock, res } from './r6Mock';
jest.mock('../utils/supabase', () => require('./r6Mock').supabaseStandIn());
jest.mock('../middleware/admin.middleware', () => ({ isAdminUser: jest.fn(async () => false) }));
// eslint-disable-next-line import/first
import { getVenue } from '../controllers/venues.controller';

const VENUE = '44444444-4444-4444-8444-444444444444';
const ME = '11111111-1111-4111-8111-111111111111';
const OWNER = '22222222-2222-4222-8222-222222222222';
let blocks: unknown[] = [];
const pgrest = (q: string[], rows: unknown[]) => {
  const single = q.some((c) => c.startsWith('maybeSingle'));
  if (single && !q.some((c) => c.startsWith('limit')) && rows.length > 1) return { data: null, error: { code: 'PGRST116' } };
  return { data: single ? rows[0] ?? null : rows };
};
beforeEach(() => {
  mock.next = (q) => {
    if (q[0] === 'from:venues') return { data: { id: VENUE, name: 'Turf', created_by: OWNER, owner: { id: OWNER, name: 'Owner', username: 'own', profile_picture_url: null, deleted_at: null } } };
    if (q[0] === 'from:user_blocks') return pgrest(q, blocks);
    return { data: [] };
  };
});
const open = async () => { const r = res(); await getVenue({ userId: ME, params: { id: VENUE } } as any, r); return r; };

test('with a block from both sides, no contact is shown', async () => {
  blocks = [{ id: 'b1' }, { id: 'b2' }];
  expect((await open()).body.venue.contact).toBeNull();
});
test('with a block one way, no contact is shown', async () => {
  blocks = [{ id: 'b1' }];
  expect((await open()).body.venue.contact).toBeNull();
});
test('with no block, the contact is shown', async () => {
  blocks = [];
  expect((await open()).body.venue.contact).toMatchObject({ id: OWNER });
});
